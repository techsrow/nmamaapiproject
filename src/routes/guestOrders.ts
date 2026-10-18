import { Router } from "express";
import { prisma } from "../lib/prisma";
import { verifyGuestTrackingAccess } from "../services/payments/orderAccess";
import { paymentMessage, paymentStatusCode } from "../services/payments/paymentError";

const router = Router();
function safeLink(value: string | null) {
  try { const url = new URL(value || ""); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
router.get("/:orderId", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const id = Number(req.params.orderId);
    if (!verifyGuestTrackingAccess(req.get("x-order-tracking-token"), id)) {
      return res.status(403).json({ success: false, message: "This tracking link is invalid or expired. Contact the store for help." });
    }
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || order.userId !== null) return res.status(404).json({ success: false, message: "Order not found." });
    const shipments = await prisma.shipment.findMany({ where: { orderId: id }, orderBy: { createdAt: "desc" }, take: 20 });
    const items = await prisma.orderItem.findMany({ where: { orderId: id }, select: { id: true, productName: true, variantLabel: true, quantity: true, unitPrice: true } });
    // Deliberately omit addresses, email, phone, admin notes and raw provider payloads.
    return res.json({ success: true, data: {
      order: { id, orderNumber: `NM-${id}`, status: order.status, paymentStatus: order.paymentStatus, paymentMethod: order.paymentMethod,
        total: order.totalAmount, currency: order.currency, placedAt: order.orderDate, refundedAmount: order.refundedAmount,
        shipmentStatus: order.shipmentStatus, trackingCode: order.trackingCode || order.awbNumber, trackingUrl: safeLink(order.trackingUrl),
        shippedAt: order.shippedAt, deliveredAt: order.deliveredAt },
      items,
      shipments: shipments.map(s => ({ id: s.id, courierName: s.courierName || s.provider, status: s.status, awb: s.awb,
        trackingUrl: safeLink(s.trackingUrl), estimatedDelivery: s.estimatedDelivery, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt })),
    } });
  } catch (error) { return res.status(paymentStatusCode(error)).json({ success: false, message: paymentMessage(error) }); }
});
export default router;
