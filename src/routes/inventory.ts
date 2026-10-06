// src/routes/inventory.ts
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { z } from "zod";

const router = Router();

// Admin check helper
function requireAdmin(req: any, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

/**
 * GET /api/inventory/low-stock
 */
router.get("/low-stock", auth, async (req: any, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const items = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      stockQuantity: { lte: 5 }, // default fallback if lowStockAlertAt is null
    },
    include: { product: { select: { id: true, name: true } } },
    orderBy: { stockQuantity: "asc" },
    take: 200,
  });

  // Better: use per-variant threshold
  const filtered = items.filter((v) => v.stockQuantity <= (v.lowStockAlertAt ?? 5));

  res.json({ success: true, data: filtered });
});

/**
 * POST /api/inventory/:variantId/threshold
 * body: { lowStockAlertAt: number }
 */
router.post("/:variantId/threshold", auth, async (req: any, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const variantId = Number(req.params.variantId);
  const schema = z.object({ lowStockAlertAt: z.coerce.number().min(0).max(999) });
  const body = schema.parse(req.body);

  const updated = await prisma.productVariant.update({
    where: { id: variantId },
    data: { lowStockAlertAt: body.lowStockAlertAt },
  });

  res.json({ success: true, data: updated });
});

export default router;
