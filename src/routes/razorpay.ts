import { Router, Response } from "express";
import Razorpay from "razorpay";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import crypto from "crypto";
import { Prisma } from "@prisma/client";

const router = Router();

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

// ✅ IMPORTANT: don't crash server if env missing
const razorpay =
  key_id && key_secret ? new Razorpay({ key_id, key_secret }) : null;

function ensureRazorpayConfigured(res: Response) {
  if (!razorpay || !key_id || !key_secret) {
    res.status(500).json({
      success: false,
      message:
        "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env",
    });
    return false;
  }
  return true;
}

/**
 * POST /api/razorpay/create-order
 * body: { orderId }
 */
router.post(
  "/create-order",
  auth,
  async (req: AuthRequest, res: Response) => {
    try {
      console.log("===== CREATE ORDER DEBUG =====");
      console.log("REQ BODY:", req.body);
      console.log("USER:", req.user);

      if (!ensureRazorpayConfigured(res)) return;

      const { orderId } = req.body;

      console.log("ORDER ID:", orderId);

      if (!orderId) {
        return res.status(400).json({
          success: false,
          message: "orderId required",
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: Number(orderId) },
      });

      console.log("DB ORDER:", order);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Debug ownership
      console.log("order.userId:", order.userId);
      console.log("req.user.userId:", req.user?.userId);
      console.log("req.user.role:", req.user?.role);

      // TEMP: disable ownership check
      /*
      if (
        req.user?.role !== "Admin" &&
        order.userId !== req.user?.userId
      ) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized",
        });
      }
      */

      if (order.razorpayOrderId) {
        return res.json({
          success: true,
          data: {
            razorpayOrderId: order.razorpayOrderId,
            amount: Math.round(Number(order.totalAmount) * 100),
            currency: order.currency,
            key: key_id,
          },
        });
      }

      const amountPaise =
        Math.round(Number(order.totalAmount) * 100);

      console.log("AMOUNT PAISE:", amountPaise);

      const razorpayOrder =
        await razorpay!.orders.create({
          amount: amountPaise,
          currency: order.currency || "INR",
          receipt: `order_${order.id}`,
        });

      console.log("RAZORPAY ORDER:", razorpayOrder);

      const latestPayment =
        await prisma.payment.findFirst({
          where: { orderId: order.id },
          orderBy: { id: "desc" },
        });

      console.log("LATEST PAYMENT:", latestPayment);

      if (latestPayment) {
        await prisma.payment.update({
          where: { id: latestPayment.id },
          data: {
            provider: "Razorpay",
            paymentStatus: "Created",
            razorpayOrderId: razorpayOrder.id,
            currency: order.currency || "INR",
          },
        });
      }

      await prisma.order.update({
        where: { id: order.id },
        data: {
          razorpayOrderId: razorpayOrder.id,
          paymentStatus: "Created",
        },
      });

      return res.json({
        success: true,
        data: {
          razorpayOrderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          key: key_id,
        },
      });
    } catch (error: any) {
      console.error(
        "❌ Razorpay create order error FULL:",
        error
      );

      return res.status(500).json({
        success: false,
        message: error?.message,
        stack: error?.stack,
      });
    }
  }
);

/**
 * POST /api/razorpay/verify-payment
 * body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 */
/**
 * POST /api/razorpay/verify-payment
 * body: {
 *   razorpay_order_id,
 *   razorpay_payment_id,
 *   razorpay_signature
 * }
 */
router.post(
  "/verify-payment",
  auth,
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      if (
        !ensureRazorpayConfigured(
          res
        )
      )
        return;

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
      } = req.body;

      // Validate fields
      if (
        !razorpay_order_id ||
        !razorpay_payment_id ||
        !razorpay_signature
      ) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Missing Razorpay fields",
          });
      }

      // Verify signature
      const body =
        razorpay_order_id +
        "|" +
        razorpay_payment_id;

      const expectedSignature =
        crypto
          .createHmac(
            "sha256",
            key_secret!
          )
          .update(body)
          .digest("hex");

      // Invalid signature
      if (
        expectedSignature !==
        razorpay_signature
      ) {
        await prisma.payment.updateMany(
          {
            where: {
              razorpayOrderId:
                razorpay_order_id,
            },
            data: {
              paymentStatus:
                "Failed",
              failureReason:
                "Invalid signature",
            },
          }
        );

        return res
          .status(400)
          .json({
            success: false,
            message:
              "Invalid signature",
          });
      }

      // Find order with items
      const order =
        await prisma.order.findFirst(
          {
            where: {
              razorpayOrderId:
                razorpay_order_id,
            },
            include: {
              orderItems: true,
            },
          }
        );

      if (!order) {
        return res
          .status(404)
          .json({
            success: false,
            message:
              "Order not found for this Razorpay order id",
          });
      }

      // Owner/Admin check
      if (
        req.user?.role !==
          "Admin" &&
        order.userId !==
          req.user?.userId
      ) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Unauthorized",
          });
      }

      // Prevent duplicate verification
      if (
        order.paymentStatus ===
        "Paid"
      ) {
        return res.json({
          success: true,
          message:
            "Payment already verified",
        });
      }

      // Update payment record
      await prisma.payment.updateMany(
        {
          where: {
            razorpayOrderId:
              razorpay_order_id,
          },
          data: {
            paymentStatus:
              "Paid",
            razorpayPaymentId:
              razorpay_payment_id,
            razorpaySignature:
              razorpay_signature,
            isCaptured:
              true,
          },
        }
      );

      // Deduct stock only after payment success
      for (const item of order.orderItems) {
        if (!item.variantId)
          continue;

        await prisma.productVariant.update(
          {
            where: {
              id:
                item.variantId,
            },
            data: {
              stockQuantity:
                {
                  decrement:
                    item.quantity,
                },
            },
          }
        );
      }

      // Update order
      await prisma.order.update(
        {
          where: {
            id: order.id,
          },
          data: {
            paymentStatus:
              "Paid",

            paidAmount:
              order.totalAmount,

            status:
              "Confirmed",
          },
        }
      );

      return res.json({
        success: true,
        message:
          "Payment verified successfully",
      });
    } catch (error) {
      console.error(
        "❌ Razorpay verify payment error:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          message:
            "Failed to verify payment",
        });
    }
  }
);

export default router;
