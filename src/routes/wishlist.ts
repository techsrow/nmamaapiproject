// src/routes/wishlist.ts
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { z } from "zod";

const router = Router();

/**
 * GET /api/wishlist
 * Returns wishlist items for logged in user
 */
router.get("/", auth, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;

    const items = await prisma.wishlistItem.findMany({
      where: { userId },
      include: {
        product: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: items });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /api/wishlist
 * body: { productId }
 * Adds product to wishlist (idempotent)
 */
router.post("/", auth, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;

    const schema = z.object({ productId: z.coerce.number() });
    const { productId } = schema.parse(req.body);

    // (recommended) ensure product exists + active
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
    });

    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const created = await prisma.wishlistItem.upsert({
      where: { userId_productId: { userId, productId } },
      update: {}, // nothing to update, just keep it
      create: { userId, productId },
      include: { product: true },
    });

    return res.json({ success: true, data: created });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * POST /api/wishlist/toggle
 * body: { productId }
 * Toggles wishlist add/remove
 */
router.post("/toggle", auth, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;

    const schema = z.object({ productId: z.coerce.number() });
    const { productId } = schema.parse(req.body);

    const existing = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.wishlistItem.delete({
        where: { userId_productId: { userId, productId } },
      });
      return res.json({ success: true, data: { inWishlist: false } });
    }

    // (recommended) ensure product exists + active
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true },
    });

    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    await prisma.wishlistItem.create({
      data: { userId, productId },
    });

    return res.json({ success: true, data: { inWishlist: true } });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * DELETE /api/wishlist/:productId
 * Removes a product from wishlist
 */
router.delete("/:productId", auth, async (req: any, res: Response) => {
  try {
    const userId = req.user.userId;
    const productId = Number(req.params.productId);

    await prisma.wishlistItem.delete({
      where: { userId_productId: { userId, productId } },
    });

    return res.json({ success: true, message: "Removed" });
  } catch (e: any) {
    // if already removed (record not found)
    if (e?.code === "P2025") {
      return res.json({ success: true, message: "Already removed" });
    }
    return res.status(400).json({ success: false, message: e.message });
  }
});

export default router;
