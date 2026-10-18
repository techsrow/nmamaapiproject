import { stockContext, clearStockContext, changeStock } from "../inventory/stock.service";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { PaymentError, jsonObject } from "./paymentError";

export const lifecycleKey = (id: number) => `checkout-lifecycle:${id}`;
export async function lockOrder(tx: Prisma.TransactionClient, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`;
}
export function reservationHours(): number {
  const value = Number(process.env.CHECKOUT_RESERVATION_HOURS || 24);
  return Number.isFinite(value) && value >= 1 && value <= 168 ? value : 24;
}
// Caller holds the Order row lock. This record survives shippingMeta changes.
export async function finalizeCheckout(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
  const saved = await tx.storeSetting.findUnique({ where: { key: lifecycleKey(orderId) } });
  if (!saved) return; // Older orders have no checkout-v2 reservation receipt.
  const state = jsonObject(saved.value);
  if (state.finalized || state.released) return;
  for (const row of state.cartItems || []) {
    const where = { id: row.id, quantity: row.quantity, updatedAt: new Date(row.updatedAt) };
    // Do not delete quantities the customer edited/added after placing the order.
    if (state.userId) await tx.cartItem.deleteMany({ where: { ...where, userId: state.userId } });
    else if (state.guestCartId) await tx.guestCartItem.deleteMany({ where: { ...where, cartId: state.guestCartId } });
  }
  await tx.storeSetting.update({ where: { key: saved.key }, data: { value: { ...state, finalized: true, finalizedAt: new Date().toISOString() } } });
}
export async function releaseCheckout(tx: Prisma.TransactionClient, orderId: number): Promise<void> {
  const saved = await tx.storeSetting.findUnique({ where: { key: lifecycleKey(orderId) } });
  if (!saved) return;
  const state = jsonObject(saved.value);
  if (state.released) return;
  await stockContext(tx, {type:"RELEASE", referenceType:"WEB_ORDER", referenceId:String(orderId)});
  for (const row of state.reservations || []) {
    if (state.stockReference) {
      const allocations = await tx.inventoryMovement.findMany({where:{variantId:row.variantId,type:"RESERVATION",referenceId:state.stockReference},orderBy:{warehouseId:"asc"}});
      if (allocations.reduce((sum,x)=>sum+x.quantity,0)!==row.quantity || allocations.some(x=>!x.warehouseId)) throw new PaymentError("Stock reservation allocation requires review.",409);
      for (const allocation of allocations) await changeStock(tx,{variantId:row.variantId,warehouseId:allocation.warehouseId!,delta:allocation.quantity,type:"RELEASE",referenceType:"WEB_ORDER",referenceId:String(orderId)});
    } else {
      await tx.productVariant.update({ where: { id: row.variantId }, data: { stockQuantity: { increment: row.quantity } } });
    }
  }
  await clearStockContext(tx);
  if (state.couponId) {
    await tx.coupon.updateMany({ where: { id: state.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
  }
  await tx.storeSetting.update({ where: { key: saved.key }, data: { value: { ...state, released: true, releasedAt: new Date().toISOString() } } });
}
export async function cancelReservedOrder(orderId: number, reason: string, admin = false) {
  return prisma.$transaction(async tx => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order) throw new PaymentError("Order not found.", 404);
    if (order.status === "Cancelled") {
      if (!admin && (Number(order.paidAmount) > 0 || order.payments.some(p => p.isCaptured))) throw new PaymentError("Payment was received for this cancelled order. Contact the store for a refund.", 409);
      await releaseCheckout(tx, orderId); return order;
    }
    for(const key of [`shadowfax-booking:${orderId}`,`shiprocket-booking:${orderId}`])if(await tx.storeSetting.findUnique({where:{key}}))throw new PaymentError('Reconcile existing carrier booking before cancelling this order.',409);
    if (!["Pending", "Confirmed"].includes(order.status)) throw new PaymentError("This order can no longer be cancelled.", 409);
    if (!admin && (Number(order.paidAmount) > 0 || order.payments.some(p => p.isCaptured))) throw new PaymentError("Contact the store to cancel a paid order.", 409);
    // The caller reconciles online payments first. Unknown remote creation cannot be assumed unpaid.
    if (order.payments.some(p => p.provider === "Razorpay" && !p.providerOrderId && !p.razorpayOrderId && jsonObject(p.providerMeta).creationState && jsonObject(p.providerMeta).creationState !== "REJECTED")) throw new PaymentError("Payment is being reconciled. Retry cancellation later.", 409);
    await releaseCheckout(tx, orderId);
    const result = await tx.order.update({ where: { id: orderId }, data: { status: "Cancelled", cancelledAt: new Date(), cancellationReason: reason.slice(0, 300) } });
    await tx.orderStatusHistory.create({ data: { orderId, fromStatus: order.status, toStatus: "Cancelled", note: reason.slice(0, 300) } });
    return result;
  });
}
