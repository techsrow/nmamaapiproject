import { Router } from "express";
import { prisma } from "../lib/prisma";
import { optionalAuth } from "../middleware/optionalAuth";
import { z } from "zod";
const r = Router();
r.use(optionalAuth);
const address = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(8),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(4),
  country: z.string().default("IN"),
});
r.post("/validate-address", (req, res) => {
  try {
    const a = address.parse(req.body);
    res.json({
      success: true,
      data: {
        valid: true,
        normalized: {
          ...a,
          postalCode: a.postalCode.trim().toUpperCase(),
          country: a.country.toUpperCase(),
        },
      },
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
r.post("/delivery-options", async (req, res) => {
  const a = address.parse(req.body);
  const zones = await prisma.shippingZone.findMany({
    where: { isActive: true },
  });
  res.json({
    success: true,
    data: zones.map((z) => ({
      id: z.id,
      name: z.name,
      rates: z.rates,
      freeShippingRule: z.freeShippingRule,
      shipTo: { country: a.country, state: a.state, postalCode: a.postalCode },
    })),
  });
});
r.post("/prepare", async (req: any, res) => {
  try {
    const b = z
      .object({
        cartToken: z.string().optional(),
        email: z.string().email().optional(),
        shippingAddress: address,
        billingSameAsShipping: z.boolean().default(true),
        billingAddress: address.optional(),
        deliveryOption: z.string().optional(),
        orderNotes: z.string().max(1000).optional(),
        giftMessage: z.string().max(500).optional(),
        couponCode: z.string().optional(),
        paymentMethod: z.enum(["COD", "Prepaid"]).default("COD"),
        expressCheckout: z.boolean().default(false),
      })
      .parse(req.body);
    let items: any[] = [];
    if (req.user)
      items = await prisma.cartItem.findMany({
        where: { userId: req.user.userId },
        include: { variant: { include: { product: true } } },
      });
    else {
      if (!b.cartToken)
        throw new Error("cartToken required for guest checkout");
      const c = await prisma.guestCart.findUnique({
        where: { token: b.cartToken },
      });
      if (!c) throw new Error("Cart not found");
      items = await prisma.guestCartItem.findMany({
        where: { cartId: c.id },
        include: { variant: { include: { product: true } } },
      });
    }
    if (!items.length) throw new Error("Cart is empty");
    let subtotal = 0;
    for (const i of items) {
      const v = i.variant;
      if (
        v.trackInventory &&
        v.stockQuantity < i.quantity &&
        !v.allowBackorder &&
        !v.preorderEnabled
      )
        throw new Error(`${v.product.name} has insufficient stock`);
      subtotal += Number(v.discountPrice ?? v.price) * i.quantity;
    }
    res.json({
      success: true,
      data: {
        customerType: req.user ? "ACCOUNT" : "GUEST",
        items: items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          name: i.variant.product.name,
          unitPrice: Number(i.variant.discountPrice ?? i.variant.price),
        })),
        subtotal: Number(subtotal.toFixed(2)),
        shippingAddress: b.shippingAddress,
        billingAddress: b.billingSameAsShipping
          ? b.shippingAddress
          : b.billingAddress,
        deliveryOption: b.deliveryOption,
        orderNotes: b.orderNotes,
        giftMessage: b.giftMessage,
        couponCode: b.couponCode,
        paymentMethod: b.paymentMethod,
        expressCheckout: b.expressCheckout,
      },
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
export default r;
