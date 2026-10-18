import crypto from "crypto";
import Razorpay from "razorpay";
import { Payment, PaymentProvider, PaymentStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { decryptJson } from "./crypto";
import { lockOrder, finalizeCheckout, lifecycleKey, cancelReservedOrder } from "./orderLifecycle";
import { PaymentError, paise, jsonObject } from "./paymentError";

class GatewayRejected extends PaymentError {}
const offline = ["COD", "BankTransfer", "Manual"];
export function assertPaymentAdapter(provider: string): void {
  if (provider !== "Razorpay" && !offline.includes(provider)) throw new PaymentError(`${provider} transaction adapter is not available. Select another payment method.`);
}
async function config(provider: PaymentProvider, enabled = false) {
  const row = await prisma.paymentGatewayConfig.findUnique({ where: { provider } });
  if (!row || (enabled && !row.isEnabled)) throw new PaymentError("The selected payment provider is unavailable.", 503);
  return { ...row, credentials: decryptJson<Record<string, string>>(row.encryptedCredentials) };
}
async function razorpay(payment?: Payment, enabled = false) {
  const cfg = await config("Razorpay", enabled);
  if (!cfg.credentials.keyId || !cfg.credentials.keySecret) throw new PaymentError("Razorpay credentials are not configured.", 503);
  const originalKey = jsonObject(payment?.providerMeta).keyId;
  if (originalKey && originalKey !== cfg.credentials.keyId) throw new PaymentError("This order uses previous gateway credentials. Contact the store.", 409);
  return { cfg, rz: new Razorpay({ key_id: cfg.credentials.keyId, key_secret: cfg.credentials.keySecret }) };
}
// A timeout never means an external write failed; durable intents below are reconciled on retry.
async function remote<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PaymentError("The gateway is responding slowly. Retry this same order.", 503)), 12_000);
      timer.unref?.();
    })]);
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    if ([401, 403].includes(Number(jsonObject(error).statusCode))) throw new GatewayRejected("Gateway credentials were rejected. Contact the store.", 503);
    throw new PaymentError("The gateway request is being reconciled. Retry this same order.", 503);
  } finally { clearTimeout(timer!); }
}
async function sync(tx: Prisma.TransactionClient, orderId: number) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PaymentError("Order not found.", 404);
  const payments = await tx.payment.findMany({ where: { orderId, isCaptured: true, paymentStatus: { in: ["Paid", "PartiallyPaid", "PartiallyRefunded", "Refunded"] } } });
  const refunds = await tx.paymentRefund.findMany({ where: { orderId, status: { in: ["SUCCESS", "PROCESSED"] } } });
  const gross = payments.reduce((sum, p) => sum + paise(p.amount), 0);
  const refunded = refunds.reduce((sum, p) => sum + paise(p.amount), 0);
  const total = paise(order.totalAmount), net = Math.max(0, gross - refunded);
  const status: PaymentStatus = refunded >= gross && gross > 0 ? "Refunded" : refunded > 0 ? "PartiallyRefunded" : gross >= total ? "Paid" : gross > 0 ? "PartiallyPaid" : "Pending";
  let confirm = status === "Paid" && order.status === "Pending";
  const life = await tx.storeSetting.findUnique({ where: { key: lifecycleKey(orderId) } });
  // Pre-v2 prepaid checkout deducted stock at verification. Keep it once-only for legacy orders.
  if (confirm && !life && jsonObject(order.shippingMeta).inventoryReserved !== true && order.paymentMethod !== "COD") {
    const stockKey = `payment-stock:${orderId}`;
    const stockReceipt = await tx.storeSetting.findUnique({ where: { key: stockKey } });
    if (!stockReceipt) {
      const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { variantId: "asc" } });
      const grouped = new Map<number, number>();
      for (const item of items) grouped.set(item.variantId, (grouped.get(item.variantId) || 0) + item.quantity);
      const variants = [];
      for (const [variantId, quantity] of grouped) {
        await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
        const v = await tx.productVariant.findUnique({ where: { id: variantId } });
        if (v?.trackInventory && !v.allowBackorder && !v.preorderEnabled) variants.push({ v, quantity });
      }
      if (variants.some(({ v, quantity }) => v.stockQuantity < quantity)) {
        confirm = false;
        await tx.systemIncident.create({ data: { level: "ERROR", source: "payments", message: "Captured legacy order requires stock review", meta: { orderId } } });
      } else {
        for (const { v, quantity } of variants) await tx.productVariant.update({ where: { id: v.id }, data: { stockQuantity: { decrement: quantity } } });
        await tx.storeSetting.create({ data: { key: stockKey, value: { deducted: true } } });
      }
    }
  }
  const result = await tx.order.update({ where: { id: orderId }, data: {
    paidAmount: new Prisma.Decimal(net / 100), refundedAmount: new Prisma.Decimal(refunded / 100),
    // Refunds never reopen a debt and cause the same order to be charged again.
    paymentDue: new Prisma.Decimal(Math.max(0, total - gross) / 100), paymentStatus: status,
    ...(confirm ? { status: "Confirmed" } : {}),
  } });
  if (status === "Paid" && !["Cancelled", "Returned"].includes(order.status)) await finalizeCheckout(tx, orderId);
  return result;
}
export async function syncOrderPayment(orderId: number) {
  return prisma.$transaction(async tx => { await lockOrder(tx, orderId); return sync(tx, orderId); });
}
function validGatewayOrder(payment: Payment, value: any): void {
  if (!value?.id || paise(payment.amount) !== Number(value.amount) || value.currency !== payment.currency) throw new PaymentError("Gateway order details do not match the payment.", 409);
}
async function attachGatewayOrder(payment: Payment, value: any) {
  validGatewayOrder(payment, value);
  return prisma.$transaction(async tx => {
    await lockOrder(tx, payment.orderId);
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.providerOrderId && current.providerOrderId !== value.id) throw new PaymentError("Gateway order needs reconciliation.", 409);
    const updated = await tx.payment.update({ where: { id: payment.id }, data: {
      providerOrderId: value.id, razorpayOrderId: value.id,
      ...(current.isCaptured ? {} : { paymentStatus: "Created" }),
      providerMeta: { ...jsonObject(current.providerMeta), creationState: "CREATED" },
    } });
    await tx.order.update({ where: { id: payment.orderId }, data: { razorpayOrderId: value.id } });
    return updated;
  });
}
async function recoverGatewayOrder(payment: Payment): Promise<Payment> {
  if (payment.providerOrderId || payment.razorpayOrderId) return payment;
  const receipt = jsonObject(payment.providerMeta).receipt;
  if (!receipt) throw new PaymentError("Payment preparation is incomplete. Contact the store.", 409);
  const { rz } = await razorpay(payment);
  const result = await remote(rz.orders.all({ receipt, count: 100 }));
  const matches = result.items.filter(p => p.receipt === receipt);
  if (matches.length !== 1) throw new PaymentError("Payment preparation is being reconciled. Retry the same order or contact the store.", 409);
  return attachGatewayOrder(payment, matches[0]);
}
export async function createProviderPayment(orderId: number, provider: PaymentProvider) {
  assertPaymentAdapter(provider);
  const cfg = await config(provider, true);
  const online = provider === "Razorpay" ? await razorpay(undefined, true) : null;
  const claimed = await prisma.$transaction(async tx => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new PaymentError("Order not found.", 404);
    if (["Cancelled", "Returned"].includes(order.status)) throw new PaymentError("This order cannot accept payment.", 409);
    const lifecycle = await tx.storeSetting.findUnique({ where: { key: lifecycleKey(orderId) } });
    const state = jsonObject(lifecycle?.value);
    if (state.released || (!state.finalized && state.expiresAt && new Date(state.expiresAt).getTime() <= Date.now())) throw new PaymentError("This checkout reservation expired. Contact the store to start a new order.", 409);
    const selected = jsonObject(order.shippingMeta).paymentProvider;
    if (selected && selected !== provider) throw new PaymentError("The selected gateway does not match this order.", 409);
    const due = order.paymentDue ?? order.totalAmount;
    if (paise(due) <= 0 || ["Paid", "Refunded", "PartiallyRefunded"].includes(order.paymentStatus)) throw new PaymentError("This order has no payment due.", 409);
    if (order.currency !== "INR") throw new PaymentError("This checkout currently accepts INR orders only.");
    let payment = await tx.payment.findFirst({ where: { orderId, provider }, orderBy: { id: "desc" } });
    if (payment && paise(payment.amount) !== paise(due)) throw new PaymentError("The order balance changed. Contact the store before paying.", 409);
    if (!payment) payment = await tx.payment.create({ data: { orderId, provider, amount: due, currency: order.currency, paymentStatus: "Pending", paymentMethod: order.paymentMethod } });
    if (offline.includes(provider)) {
      await tx.order.update({ where: { id: orderId }, data: { status: "Confirmed" } });
      await finalizeCheckout(tx, orderId);
      return { payment, start: false };
    }
    const meta = jsonObject(payment.providerMeta);
    if (payment.providerOrderId || payment.razorpayOrderId || (meta.creationState && meta.creationState !== "REJECTED")) return { payment, start: false };
    payment = await tx.payment.update({ where: { id: payment.id }, data: { providerMeta: { ...meta, creationState: "STARTED", receipt: `nm_payment_${payment.id}`, keyId: cfg.credentials.keyId } } });
    return { payment, start: true };
  });
  let payment = claimed.payment;
  if (offline.includes(provider)) return { payment: publicPayment(payment), checkout: { type: provider, instructions: String(jsonObject(cfg.publicConfig).instructions || "") } };
  if (claimed.start) {
    try {
      const created = await remote(online!.rz.orders.create({
        receipt: jsonObject(payment.providerMeta).receipt, amount: paise(payment.amount), currency: payment.currency,
        notes: { orderId: String(orderId), paymentId: String(payment.id) },
      }));
      payment = await attachGatewayOrder(payment, created);
    } catch (error) {
      // 401/403 is a definite authentication rejection. Ambiguous errors remain STARTED.
      if (error instanceof GatewayRejected) await prisma.payment.update({ where: { id: payment.id }, data: { providerMeta: { ...jsonObject(payment.providerMeta), creationState: "REJECTED" } } });
      throw error;
    }
  } else payment = await recoverGatewayOrder(payment);
  await razorpay(payment); // Prevent mixing keys when config changes during an in-flight request.
  return { payment: publicPayment(payment), checkout: { type: "Razorpay", providerOrderId: payment.providerOrderId || payment.razorpayOrderId, keyId: cfg.credentials.keyId, amount: paise(payment.amount), currency: payment.currency } };
}
export function publicPayment(payment: Payment) {
  return { id: payment.id, orderId: payment.orderId, provider: payment.provider, amount: payment.amount, currency: payment.currency, paymentStatus: payment.paymentStatus, isCaptured: payment.isCaptured };
}
function validateEntity(payment: Payment, entity: any) {
  if (!entity || typeof entity.id !== "string" || entity.order_id !== (payment.providerOrderId || payment.razorpayOrderId) || Number(entity.amount) !== paise(payment.amount) || entity.currency !== payment.currency) throw new PaymentError("Payment details do not match this order.", 400);
}
async function applyEntity(payment: Payment, entity: any) {
  validateEntity(payment, entity);
  return prisma.$transaction(async tx => {
    await lockOrder(tx, payment.orderId);
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    if (entity.status === "captured" && entity.captured === true) {
      if (current.isCaptured && current.providerPaymentId && current.providerPaymentId !== entity.id) throw new PaymentError("Multiple captured payments require review.", 409);
      if (!current.isCaptured && ["Cancelled", "Returned"].includes(order.status)) {
        await tx.systemIncident.create({ data: { level: "ERROR", source: "payments", message: "Payment captured after order cancellation; refund review required", meta: { orderId: order.id, paymentId: current.id } } });
      }
      await tx.payment.update({ where: { id: current.id }, data: { providerPaymentId: entity.id, razorpayPaymentId: entity.id, isCaptured: true, paymentStatus: "Paid", failureReason: null } });
    } else if (!current.isCaptured && entity.status === "failed") {
      await tx.payment.update({ where: { id: current.id }, data: { paymentStatus: "Failed", failureReason: "The payment attempt failed." } });
    }
    // A delayed failure can never downgrade a captured payment.
    await sync(tx, payment.orderId);
    return tx.payment.findUniqueOrThrow({ where: { id: current.id } });
  });
}
export async function verifyRazorpay(input: { providerOrderId: string; providerPaymentId: string; signature: string }) {
  if (!/^[a-fA-F0-9]{64}$/.test(input.signature)) throw new PaymentError("Invalid payment signature.");
  const payment = await prisma.payment.findFirst({ where: { provider: "Razorpay", OR: [{ providerOrderId: input.providerOrderId }, { razorpayOrderId: input.providerOrderId }] } });
  if (!payment) throw new PaymentError("Payment not found.", 404);
  const { cfg, rz } = await razorpay(payment);
  const expected = crypto.createHmac("sha256", cfg.credentials.keySecret).update(`${payment.providerOrderId || payment.razorpayOrderId}|${input.providerPaymentId}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(input.signature, "hex"))) throw new PaymentError("Invalid payment signature.");
  let entity = await remote(rz.payments.fetch(input.providerPaymentId));
  validateEntity(payment, entity);
  // Manual capture, when needed; re-fetch resolves simultaneous automatic capture.
  const order = await prisma.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  if (entity.status === "authorized" && !["Cancelled", "Returned"].includes(order.status)) {
    try { entity = await remote(rz.payments.capture(entity.id, paise(payment.amount), payment.currency)); }
    catch { entity = await remote(rz.payments.fetch(entity.id)); }
  }
  return publicPayment(await applyEntity(payment, entity));
}
export async function reconcileOrderPayment(orderId: number): Promise<{ authorized: boolean }> {
  const payments = await prisma.payment.findMany({ where: { orderId, provider: "Razorpay", isCaptured: false } });
  let authorized = false;
  for (let p of payments) {
    // Do not create a new remote order during a status request.
    if (!p.providerOrderId && !p.razorpayOrderId) {
      if (!jsonObject(p.providerMeta).creationState || jsonObject(p.providerMeta).creationState === "REJECTED") continue;
      p = await recoverGatewayOrder(p);
    }
    const { rz } = await razorpay(p);
    const result = await remote(rz.orders.fetchPayments((p.providerOrderId || p.razorpayOrderId)!));
    for (const entity of result.items) {
      validateEntity(p, entity);
      if (entity.status === "authorized") authorized = true;
      if (entity.status === "captured" || entity.status === "failed") await applyEntity(p, entity);
    }
  }
  return { authorized };
}
export async function handleRazorpayEntity(entity: any) {
  if (!entity || typeof entity.order_id !== "string") throw new PaymentError("Invalid webhook payment.");
  const p = await prisma.payment.findFirst({ where: { provider: "Razorpay", OR: [{ providerOrderId: entity.order_id }, { razorpayOrderId: entity.order_id }] } });
  if (!p) throw new PaymentError("Payment is not recorded yet. Retry webhook delivery.", 503);
  const { rz } = await razorpay(p);
  let current = await remote(rz.payments.fetch(entity.id));
  validateEntity(p, current);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
  if (current.status === "authorized" && !["Cancelled", "Returned"].includes(order.status)) {
    try { current = await remote(rz.payments.capture(current.id, paise(p.amount), p.currency)); }
    catch { current = await remote(rz.payments.fetch(current.id)); }
  }
  return applyEntity(p, current);
}
export async function cancelOrder(orderId: number, reason: string, admin = false) {
  const state = await reconcileOrderPayment(orderId);
  if (state.authorized) throw new PaymentError("Payment is authorized and awaiting settlement. Retry cancellation later.", 409);
  return cancelReservedOrder(orderId, reason, admin);
}

export async function recordManualPayment(input: { orderId: number; amount: number; provider: PaymentProvider; reference?: string; method?: any; status?: string }) {
  if (input.method !== undefined && !Object.values(PaymentMethod).includes(input.method)) throw new PaymentError("Invalid payment method.");
  if (input.reference !== undefined && (typeof input.reference !== "string" || input.reference.length > 200)) throw new PaymentError("Invalid payment reference.");
  if (!offline.includes(input.provider)) throw new PaymentError("Choose COD, BankTransfer or Manual.");
  if (!["Paid", "Pending"].includes(input.status || "Paid") || paise(input.amount) <= 0) throw new PaymentError("Invalid manual payment status or amount.");
  return prisma.$transaction(async tx => {
    await lockOrder(tx, input.orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
    if (["Cancelled", "Returned"].includes(order.status)) throw new PaymentError("This order cannot accept payment.");
    if (input.reference) {
      const old = await tx.payment.findFirst({ where: { orderId: input.orderId, provider: input.provider, providerPaymentId: input.reference } });
      if (old) {
        if (paise(old.amount) !== paise(input.amount)) throw new PaymentError("This reference was already used for another amount.", 409);
        return { payment: publicPayment(old), order: await sync(tx, order.id) };
      }
    }
    const current = await sync(tx, order.id);
    if (paise(input.amount) > paise(current.paymentDue)) throw new PaymentError("Payment exceeds the remaining order balance.");
    const p = await tx.payment.create({ data: { orderId: order.id, provider: input.provider, amount: new Prisma.Decimal(input.amount), currency: order.currency, providerPaymentId: input.reference || null, paymentStatus: input.status === "Pending" ? "Pending" : "Paid", isCaptured: input.status !== "Pending", paymentMethod: input.method } });
    return { payment: publicPayment(p), order: await sync(tx, order.id) };
  });
}

export async function refundPayment(paymentId: number, amount: number, reason: string | undefined, createdById?: number, requestKey?: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || !payment.isCaptured || paise(amount) <= 0) throw new PaymentError("Only a captured payment can be refunded.");
  const refundOrder = await prisma.order.findUnique({where:{id:payment.orderId}});
  if (refundOrder?.salesChannel === "POS") throw new PaymentError("Use the POS return endpoint for this bill.");
  assertPaymentAdapter(payment.provider);
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 300)) throw new PaymentError("Invalid refund reason.");
  if (requestKey !== undefined && (typeof requestKey !== "string" || requestKey.length < 8 || requestKey.length > 128)) throw new PaymentError("Invalid refund request key.");
  const key = requestKey || crypto.createHash("sha256").update(`${paymentId}:${paise(amount)}:${reason || ""}`).digest("hex");
  const claimed = await prisma.$transaction(async tx => {
    await lockOrder(tx, payment.orderId);
    const all = await tx.paymentRefund.findMany({ where: { paymentId } });
    const old = all.find(r => jsonObject(r.meta).requestKey === key);
    if (old) {
      if (paise(old.amount) !== paise(amount)) throw new PaymentError("Refund request key was already used.", 409);
      return { row: old, start: false };
    }
    const reserved = all.filter(r => r.status !== "FAILED").reduce((n, r) => n + paise(r.amount), 0);
    if (reserved + paise(amount) > paise(payment.amount)) throw new PaymentError("Refund exceeds the refundable balance.");
    return { row: await tx.paymentRefund.create({ data: { orderId: payment.orderId, paymentId, amount: new Prisma.Decimal(amount), provider: payment.provider, status: "PENDING", reason: reason?.slice(0, 300), createdById, meta: { requestKey: key } } }), start: true };
  });
  let refund = claimed.row;
  if (payment.provider === "Razorpay") {
    const external = payment.providerPaymentId || payment.razorpayPaymentId;
    if (!external) throw new PaymentError("Provider payment ID is missing.", 409);
    const { rz } = await razorpay(payment);
    let remoteRefund;
    if (claimed.start) remoteRefund = await remote(rz.payments.refund(external, { amount: paise(amount), notes: { localRefundId: String(refund.id) } }));
    else if (refund.providerRefundId) remoteRefund = await remote(rz.payments.fetchRefund(external, refund.providerRefundId));
    else {
      const results = await remote(rz.payments.fetchMultipleRefund(external, { count: 100 }));
      remoteRefund = results.items.find(r => String(jsonObject(r.notes).localRefundId) === String(refund.id));
      if (!remoteRefund) throw new PaymentError("Refund is being reconciled. Retry the same refund request.", 409);
    }
    if (Number(remoteRefund.amount) !== paise(refund.amount) || remoteRefund.payment_id !== external) throw new PaymentError("Refund details need review.", 409);
    return prisma.$transaction(async tx => {
      await lockOrder(tx, payment.orderId);
      const current = await tx.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
      const status = current.status === "SUCCESS" ? "SUCCESS" : remoteRefund.status === "processed" ? "SUCCESS" : remoteRefund.status === "failed" ? "FAILED" : "PENDING";
      const updated = await tx.paymentRefund.update({ where: { id: refund.id }, data: { providerRefundId: remoteRefund.id, status } });
      await sync(tx, payment.orderId);
      return updated;
    });
  }
  return prisma.$transaction(async tx => {
    await lockOrder(tx, payment.orderId);
    const updated = await tx.paymentRefund.update({ where: { id: refund.id }, data: { status: "PROCESSED" } });
    await sync(tx, payment.orderId);
    return updated;
  });
}
export async function reconcileRefundEvent(entity: any) {
  if (typeof entity?.id !== "string" || typeof entity.payment_id !== "string") throw new PaymentError("Invalid refund event.");
  const payment = await prisma.payment.findFirst({ where: { provider: "Razorpay", OR: [{ providerPaymentId: entity.payment_id }, { razorpayPaymentId: entity.payment_id }] } });
  if (!payment) throw new PaymentError("Refund payment is not recorded yet.", 503);
  const { rz } = await razorpay(payment);
  const remoteRefund = await remote(rz.payments.fetchRefund(entity.payment_id, entity.id));
  if (!remoteRefund || remoteRefund.payment_id !== entity.payment_id || !Number.isSafeInteger(Number(remoteRefund.amount)) || Number(remoteRefund.amount) <= 0 || Number(remoteRefund.amount) > paise(payment.amount)) throw new PaymentError("Refund details do not match the payment.");
  const localId = Number(jsonObject(remoteRefund.notes).localRefundId);
  return prisma.$transaction(async tx => {
    await lockOrder(tx, payment.orderId);
    const row = await tx.paymentRefund.findFirst({ where: { provider: "Razorpay", paymentId: payment.id, OR: [{ providerRefundId: entity.id }, ...(Number.isSafeInteger(localId) && localId > 0 ? [{ id: localId }] : [])] } });
    if (row && paise(row.amount) !== Number(remoteRefund.amount)) throw new PaymentError("Refund amount requires review.", 409);
    const status = row?.status === "SUCCESS" ? "SUCCESS" : remoteRefund.status === "processed" ? "SUCCESS" : remoteRefund.status === "failed" ? "FAILED" : "PENDING";
    const result = row
      ? await tx.paymentRefund.update({ where: { id: row.id }, data: { providerRefundId: entity.id, status } })
      : await tx.paymentRefund.create({ data: { orderId: payment.orderId, paymentId: payment.id, provider: "Razorpay", providerRefundId: entity.id, amount: new Prisma.Decimal(Number(remoteRefund.amount) / 100), status, meta: { source: "gateway" } } });
    await sync(tx, payment.orderId);
    return result;
  });
}
