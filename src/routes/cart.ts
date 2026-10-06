import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";

const router = Router();
router.use(auth);

function effectivePrice(variant: any) {
  const dp = variant.discountPrice ? Number(variant.discountPrice) : null;
  const p = Number(variant.price);
  return dp !== null ? dp : p;
}

/* -----------------------------------
   CART COUNT  (keep before /:variantId routes)
----------------------------------- */
router.get("/count", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;

  const totalItems = await prisma.cartItem.aggregate({
    where: { userId },
    _sum: { quantity: true },
  });

  return res.json({
    success: true,
    data: { totalItems: totalItems._sum.quantity ?? 0 },
  });
});

/* -----------------------------------
   CLEAR CART (keep before /:variantId routes)
----------------------------------- */
router.delete("/clear", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;

  await prisma.cartItem.deleteMany({ where: { userId } });

  return res.json({ success: true, message: "Cart cleared" });
});

/* -----------------------------------
   GET FULL CART
----------------------------------- */
router.get("/", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;

  const items = await prisma.cartItem.findMany({
    where: { userId },
    include: {
      variant: {
        include: {
          images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
          product: {
            include: {
              category: { select: { id: true, name: true, slug: true } },
              subCategory: { select: { id: true, name: true, slug: true } },
              images: {
                orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
                select: { id: true, url: true, altText: true, isMain: true, sortOrder: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const mapped = items.map((ci) => {
    const product = ci.variant.product;

    const mainImage =
      product.images?.find((i) => i.isMain) ||
      product.images?.[0] ||
      (product.imageUrl ? { url: product.imageUrl } : null);

    const unitPrice = effectivePrice(ci.variant);
    const lineTotal = unitPrice * ci.quantity;

    const variantLabel = [
      ci.variant.weight ? `Weight: ${ci.variant.weight}` : null,
      ci.variant.size ? `Size: ${ci.variant.size}` : null,
      ci.variant.color ? `Color: ${ci.variant.color}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      id: ci.id,
      variantId: ci.variantId,
      quantity: ci.quantity,

      product: {
        id: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        mainImageUrl: (mainImage as any)?.url ?? null,
        category: product.category,
        subCategory: product.subCategory,
      },

      variant: {
        id: ci.variant.id,
        weight: ci.variant.weight,
        size: ci.variant.size,
        color: ci.variant.color,
        colorHex: ci.variant.colorHex,
        colorImageUrl: ci.variant.colorImageUrl,
        sku: ci.variant.sku,
        stockQuantity: ci.variant.stockQuantity,
        price: Number(ci.variant.price),
        discountPrice: ci.variant.discountPrice ? Number(ci.variant.discountPrice) : null,
        effectivePrice: unitPrice,
        label: variantLabel || null,
        images: ci.variant.images,
      },

      lineTotal,
    };
  });

  const subtotal = mapped.reduce((s, i) => s + i.lineTotal, 0);
  const shipping = subtotal >= 500 ? 0 : 50;
  const tax = subtotal * 0.08;
  const total = subtotal + shipping + tax;

  return res.json({
    success: true,
    data: {
      items: mapped,
      summary: { subtotal, shipping, tax, total },
    },
  });
});

/* -----------------------------------
   ADD TO CART
----------------------------------- */
const AddSchema = z.object({
  variantId: z.number(),
  quantity: z.number().min(1),
});

router.post("/", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const { variantId, quantity } = AddSchema.parse(req.body);

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant || !variant.isActive || !variant.product.isActive) {
    return res.status(404).json({ success: false, message: "Variant not found" });
  }

  const existing = await prisma.cartItem.findUnique({
    where: { userId_variantId: { userId, variantId } },
  });

  const nextQty = (existing?.quantity ?? 0) + quantity;

  if (variant.stockQuantity < nextQty) {
    return res.status(400).json({
      success: false,
      message: `Only ${variant.stockQuantity} items available`,
    });
  }

  if (existing) {
    await prisma.cartItem.update({
      where: { userId_variantId: { userId, variantId } },
      data: { quantity: nextQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { userId, variantId, quantity },
    });
  }

  return res.json({ success: true, message: "Item added to cart" });
});

/* -----------------------------------
   UPDATE CART ITEM QUANTITY
   PUT /api/cart/:variantId  body: { quantity }
----------------------------------- */
router.put("/:variantId", async (req: AuthRequest, res: Response) => {
  const userId = req.user!.userId;
  const variantId = Number(req.params.variantId);

  const { quantity } = z.object({ quantity: z.number() }).parse(req.body);

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant || !variant.isActive || !variant.product.isActive) {
    return res.status(404).json({ success: false, message: "Variant not found" });
  }

  if (quantity <= 0) {
    await prisma.cartItem.delete({
      where: { userId_variantId: { userId, variantId } },
    });
    return res.json({ success: true, message: "Item removed" });
  }

  if (variant.stockQuantity < quantity) {
    return res.status(400).json({
      success: false,
      message: `Only ${variant.stockQuantity} items available`,
    });
  }

  await prisma.cartItem.update({
    where: { userId_variantId: { userId, variantId } },
    data: { quantity },
  });

  return res.json({ success: true, message: "Cart updated" });
});

/* -----------------------------------
   REMOVE ITEM
   DELETE /api/cart/:variantId
----------------------------------- */
 router.delete("/:variantId", async (req: AuthRequest, res: Response) => {
 const userId = req.user!.userId;
  const variantId = Number(req.params.variantId);

   await prisma.cartItem.delete({
    where: { userId_variantId: { userId, variantId } },
  });

  return res.json({ success: true, message: "Item removed" });
 });

export default router;



