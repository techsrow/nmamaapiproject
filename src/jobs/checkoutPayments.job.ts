import { prisma } from "../lib/prisma";
import { cancelOrder, reconcileOrderPayment, refundPayment } from "../services/payments/paymentService";
import { jsonObject } from "../services/payments/paymentError";
let running = false;
let lastKey: string | undefined;
export async function runCheckoutMaintenance() {
  if (running) return;
  running = true;
  try {
    const records = await prisma.storeSetting.findMany({ where: { key: { startsWith: "checkout-lifecycle:" } }, orderBy: { key: "asc" }, take: 100, ...(lastKey ? { cursor: { key: lastKey }, skip: 1 } : {}) });
    lastKey = records.length === 100 ? records[records.length - 1].key : undefined;
    for (const record of records) {
      const state = jsonObject(record.value);
      if (state.released || state.finalized) continue;
      const id = Number(record.key.slice("checkout-lifecycle:".length));
      try {
        const order = await prisma.order.findUnique({ where: { id } });
        if (!order) continue;
        if (order.status === "Pending") await reconcileOrderPayment(id);
        const current = await prisma.order.findUniqueOrThrow({ where: { id } });
        if (current.status === "Pending" && Number(current.paidAmount || 0) === 0 && new Date(state.expiresAt).getTime() <= Date.now()) {
          await cancelOrder(id, "Checkout reservation expired");
        }
      } catch { /* Keep ambiguous/authorized payments reserved for reconciliation. Never create a replacement charge. */ }
    }
    const refunds = await prisma.paymentRefund.findMany({ where: { provider: "Razorpay", status: "PENDING" }, take: 25, orderBy: { updatedAt: "asc" } });
    for (const refund of refunds) {
      const key = jsonObject(refund.meta).requestKey;
      if (!refund.paymentId || typeof key !== "string") continue;
      try { await refundPayment(refund.paymentId, Number(refund.amount), refund.reason || undefined, refund.createdById || undefined, key); } catch { /* webhook/retry will reconcile */ }
    }
  } finally { running = false; }
}
export function startCheckoutMaintenance() {
  const run = () => { void runCheckoutMaintenance().catch(() => console.error("Checkout maintenance could not complete.")); };
  const timer = setInterval(run, 120_000);
  timer.unref();
  run();
  return timer;
}
