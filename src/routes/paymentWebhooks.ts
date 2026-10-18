import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { decryptJson } from "../services/payments/crypto";
import { handleRazorpayEntity, reconcileRefundEvent, reconcileOrderPayment } from "../services/payments/paymentService";
import { PaymentError, paymentMessage, paymentStatusCode } from "../services/payments/paymentError";

export async function razorpayWebhook(req: Request, res: Response) {
  try {
    if (!Buffer.isBuffer(req.body)) throw new PaymentError("Webhook requires its original raw body.");
    const signature = req.get("x-razorpay-signature") || "";
    if (!/^[a-fA-F0-9]{64}$/.test(signature)) throw new PaymentError("Invalid webhook signature.");
    const cfg = await prisma.paymentGatewayConfig.findUnique({ where: { provider: "Razorpay" } });
    const credentials = decryptJson<Record<string, string>>(cfg?.encryptedCredentials);
    const secrets = [credentials.webhookSecret, process.env.RAZORPAY_WEBHOOK_SECRET].filter((s): s is string => !!s);
    if (!secrets.length) throw new PaymentError("Webhook configuration is unavailable.", 503);
    const valid = secrets.some(secret => crypto.timingSafeEqual(crypto.createHmac("sha256", secret).update(req.body).digest(), Buffer.from(signature, "hex")));
    if (!valid) throw new PaymentError("Invalid webhook signature.");
    const payload = JSON.parse(req.body.toString("utf8"));
    if (["payment.captured", "payment.failed", "payment.authorized"].includes(payload.event)) {
      await handleRazorpayEntity(payload.payload?.payment?.entity);
    } else if (["refund.processed", "refund.failed", "refund.created"].includes(payload.event)) {
      await reconcileRefundEvent(payload.payload?.refund?.entity);
    } else if (payload.event === "order.paid") {
      const id = payload.payload?.order?.entity?.id;
      if (typeof id !== "string") throw new PaymentError("Invalid order event.");
      const payment = await prisma.payment.findFirst({ where: { provider: "Razorpay", OR: [{ providerOrderId: id }, { razorpayOrderId: id }] } });
      if (!payment) throw new PaymentError("Order is not recorded yet.", 503);
      await reconcileOrderPayment(payment.orderId);
    }
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof SyntaxError) return res.status(400).json({ success: false, message: "Invalid webhook JSON." });
    return res.status(paymentStatusCode(error)).json({ success: false, message: paymentMessage(error) });
  }
}
const router = Router();
router.post("/razorpay", razorpayWebhook);
export default router;
