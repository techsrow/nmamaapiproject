import { Router, Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { autoCreateShipmentForPaidOrder } from "../services/shipmentAutomation";


const router = Router();

// NOTE:
// Razorpay requires raw body for signature verification.
// Make sure in server.ts you use:
// app.use("/api/razorpay/webhook", express.raw({ type: "application/json" }), razorpayWebhooksRoutes);
// (If you are using express.json globally, Razorpay signature may fail)

function verifyWebhookSignature(req: Request, secret: string) {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  if (!signature) return false;

  // If you mounted express.raw(), req.body will be Buffer
  const rawBody =
    Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return expectedSignature === signature;
}

/**
 * POST /api/razorpay/webhook
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(500).json({
        success: false,
        message: "Missing RAZORPAY_WEBHOOK_SECRET in .env",
      });
    }

    const ok = verifyWebhookSignature(req, secret);
    if (!ok) {
      return res.status(400).json({ success: false, message: "Invalid webhook signature" });
    }

    const payload =
      Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;

    const eventType: string = payload.event;

    // Razorpay common shape
    const paymentEntity = payload?.payload?.payment?.entity;

   // ----------------------------
// payment.captured
// ----------------------------
if (eventType === "payment.captured" && paymentEntity) {
  const razorpayOrderId = paymentEntity.order_id as string;
  const razorpayPaymentId = paymentEntity.id as string;

  // amount is in paise
  const paidAmount = Number(paymentEntity.amount) / 100;

  // ✅ Find order first so we have order.id for automation
  const order = await prisma.order.findFirst({
    where: { razorpayOrderId },
  });

  if (order) {
    // Update payment record
    await prisma.payment.updateMany({
      where: { razorpayOrderId },
      data: {
        paymentStatus: "Paid",
        razorpayPaymentId,
        isCaptured: true,
      },
    });

    // Update order
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: "Paid",
        status: "Confirmed", // ✅ valid enum
        paidAmount: new Prisma.Decimal(paidAmount),
      },
    });

    // ✅ THE MISSING STEP: auto create shipment (idempotent)
    await autoCreateShipmentForPaidOrder(order.id);
  }

  return res.json({ success: true });
}

if (eventType === "order.paid") {
  const orderEntity = payload?.payload?.order?.entity;
  if (orderEntity?.id) {
    const razorpayOrderId = orderEntity.id as string;

    const order = await prisma.order.findFirst({ where: { razorpayOrderId } });
    if (order) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentStatus: "Paid", status: "Confirmed" },
      });

      await autoCreateShipmentForPaidOrder(order.id);
    }
  }
  return res.json({ success: true });
}



    // ----------------------------
    // payment.failed
    // ----------------------------
    if (eventType === "payment.failed" && paymentEntity) {
      const razorpayOrderId = paymentEntity.order_id as string;
      const razorpayPaymentId = paymentEntity.id as string;

      const reason =
        paymentEntity?.error_reason ||
        paymentEntity?.error_description ||
        paymentEntity?.error_code ||
        "Payment failed";

      await prisma.payment.updateMany({
        where: { razorpayOrderId },
        data: {
          paymentStatus: "Failed",
          razorpayPaymentId,
          isCaptured: false,
          failureReason: String(reason),
        },
      });

      await prisma.order.updateMany({
        where: { razorpayOrderId },
        data: {
          paymentStatus: "Failed",
        },
      });

      return res.json({ success: true });
    }

    // ----------------------------
    // order.paid (optional)
    // ----------------------------
    if (eventType === "order.paid") {
      const orderEntity = payload?.payload?.order?.entity;
      if (orderEntity?.id) {
        const razorpayOrderId = orderEntity.id as string;

        await prisma.order.updateMany({
          where: { razorpayOrderId },
          data: {
            paymentStatus: "Paid",
            status: "Confirmed",
          },
        });
      }
      return res.json({ success: true });
    }

    // For any other event, acknowledge
    return res.json({ success: true, ignored: true, event: eventType });
  } catch (err) {
    console.error("❌ Razorpay webhook error:", err);
    return res.status(500).json({ success: false, message: "Webhook handler error" });
  }
});

export default router;
