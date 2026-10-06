import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

const router = Router();

// Decimal helper (keeps Prisma happy)
const D = (v: any) => new Prisma.Decimal(v ?? 0);

/**
 * 🛍️ BUY NOW – Variant Based
 * POST /api/buy-now
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { userId, productId, variantId, quantity } = req.body;

    const qty = Number(quantity);

    if (!productId || !variantId || !qty || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: "productId, variantId and quantity are required",
      });
    }

    // 🔍 Find variant
    const variant = await prisma.productVariant.findUnique({
      where: { id: Number(variantId) },
      include: { product: true },
    });

    if (!variant || !variant.isActive) {
      return res.status(404).json({
        success: false,
        message: "Variant not found",
      });
    }

    if (variant.stockQuantity < qty) {
      return res.status(400).json({
        success: false,
        message: `Only ${variant.stockQuantity} items available`,
      });
    }

    const unitPriceNum = Number(variant.discountPrice ?? variant.price);
    const totalAmountNum = unitPriceNum * qty;

    // Build snapshot values (OrderItem requires productName)
    const productName = variant.product?.name ?? "Unknown Product";
    const variantLabel =
      `${variant.weight ?? ""} ${variant.size ?? ""} ${variant.color ?? ""}`.trim() || null;

    // 🧾 CREATE ORDER
    const order = await prisma.order.create({
      data: {
        userId: userId ? Number(userId) : null,
        totalAmount: D(totalAmountNum),
        status: "Pending",
        paymentStatus: "Pending",

        orderItems: {
          create: [
            {
              productId: variant.productId,
              variantId: variant.id,
              quantity: qty,
              unitPrice: D(unitPriceNum),

              // ✅ REQUIRED snapshot fields per schema
              productName,
              variantLabel,
              sku: variant.sku ?? null,
              imageUrl: variant.product?.imageUrl ?? null,
            },
          ],
        },
      },
      include: {
        orderItems: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Buy Now order created successfully",
      data: {
        orderId: order.id,
        orderNumber: `ORD-${String(order.id).padStart(6, "0")}`,
        totalAmount: order.totalAmount,
        status: order.status,
        items: order.orderItems.map((item) => ({
          productName: item.product?.name ?? item.productName,
          variant: {
            weight: item.variant?.weight ?? null,
            size: item.variant?.size ?? null,
            color: item.variant?.color ?? null,
          },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    });
  } catch (error) {
    console.error("❌ Buy Now Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create Buy Now order",
    });
  }
});

/**
 * 📦 GET Buy Now Order
 * GET /api/buy-now/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const orderId = Number(req.params.id);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: true,
            variant: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: `ORD-${String(order.id).padStart(6, "0")}`,
        totalAmount: order.totalAmount,
        status: order.status,
        items: order.orderItems.map((item) => ({
          productName: item.product?.name ?? item.productName,
          variant: {
            weight: item.variant?.weight ?? null,
            size: item.variant?.size ?? null,
            color: item.variant?.color ?? null,
          },
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    });
  } catch (error) {
    console.error("❌ Fetch Buy Now Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/**
 * ✅ CONFIRM BUY NOW ORDER
 * POST /api/buy-now/confirm
 */
router.post("/confirm", async (req: Request, res: Response) => {
  try {
    const { orderId, name, phone, address, city, postal, country } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Missing orderId",
      });
    }

    const existing = await prisma.order.findUnique({
      where: { id: Number(orderId) },
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // ✅ OrderStatus enum DOES NOT include "Processing"
    // Use Confirmed (or Pending if you want to confirm later after payment)
    const updated = await prisma.order.update({
      where: { id: Number(orderId) },
      data: {
        customerName: name ?? null,
        guestPhone: phone ?? null,
        shippingAddress: address ?? null,
        shippingCity: city ?? null,
        shippingPostalCode: postal ?? null,
        shippingCountry: country ?? null,
        status: "Confirmed",
      },
      include: {
        orderItems: {
          include: { product: true, variant: true },
        },
      },
    });

    return res.json({
      success: true,
      message: "Order confirmed successfully",
      data: {
        orderId: updated.id,
        orderNumber: `ORD-${String(updated.id).padStart(6, "0")}`,
        totalAmount: updated.totalAmount,
        status: updated.status,
        items: updated.orderItems.map((item) => ({
          productName: item.product?.name ?? item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          variant: {
            weight: item.variant?.weight ?? null,
            size: item.variant?.size ?? null,
            color: item.variant?.color ?? null,
          },
        })),
      },
    });
  } catch (error) {
    console.error("❌ Confirm Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;
