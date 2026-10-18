import { Router } from "express";
import { prisma } from "../lib/prisma";
import { type AuthRequest } from "../middleware/auth";
import { paymentIdentity, canAccessOrder } from "../middleware/paymentAccess";
import { createProviderPayment, verifyRazorpay } from "../services/payments/paymentService";
import { PaymentError, paymentMessage, paymentStatusCode } from "../services/payments/paymentError";
const router = Router();
router.use(paymentIdentity);
router.post("/create-order", async (req: AuthRequest, res) => {
  try {
    const id = Number(req.body?.orderId);
    if (!Number.isSafeInteger(id) || id < 1) throw new PaymentError("Invalid order ID.");
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order || !canAccessOrder(req, order)) throw new PaymentError("Order access denied.", 403);
    const result = await createProviderPayment(id, "Razorpay");
    const checkout = result.checkout as { providerOrderId: string; keyId: string; amount: number; currency: string };
    return res.json({ success: true, data: { razorpayOrderId: checkout.providerOrderId, key: checkout.keyId, amount: checkout.amount, currency: checkout.currency } });
  } catch (error) { return res.status(paymentStatusCode(error)).json({ success: false, message: paymentMessage(error) }); }
});
router.post("/verify-payment", async (req: AuthRequest, res) => {
  try {
    const b = req.body || {};
    if (typeof b.razorpay_order_id !== "string" || typeof b.razorpay_payment_id !== "string" || typeof b.razorpay_signature !== "string") throw new PaymentError("Invalid verification details.");
    const payment = await prisma.payment.findFirst({ where: { provider: "Razorpay", OR: [{ providerOrderId: b.razorpay_order_id }, { razorpayOrderId: b.razorpay_order_id }] }, include: { order: true } });
    if (!payment || !canAccessOrder(req, payment.order)) throw new PaymentError("Order access denied.", 403);
    const data = await verifyRazorpay({ providerOrderId: b.razorpay_order_id, providerPaymentId: b.razorpay_payment_id, signature: b.razorpay_signature });
    return res.json({ success: true, data, message: data.isCaptured ? "Payment verified." : "Payment is awaiting confirmation." });
  } catch (error) { return res.status(paymentStatusCode(error)).json({ success: false, message: paymentMessage(error) }); }
});
export default router;
