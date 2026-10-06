import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";

const router = Router();

function requireAdmin(req: any, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

/**
 * GET /api/analytics/summary
 */
router.get("/summary", auth, async (req: any, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const [ordersCount, paidRevenue, byStatus] = await Promise.all([
    prisma.order.count(),
    prisma.order.aggregate({
      where: { paymentStatus: "Paid" },
      _sum: { paidAmount: true },
    }),
    prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  res.json({
    success: true,
    data: {
      ordersCount,
      paidRevenue: paidRevenue._sum.paidAmount ?? 0,
      byStatus,
    },
  });
});

/**
 * GET /api/analytics/top-products
 */
router.get("/top-products", auth, async (req: any, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const top = await prisma.orderItem.groupBy({
    by: ["productId", "productName"],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 10,
  });

  res.json({ success: true, data: top });
});

export default router;
