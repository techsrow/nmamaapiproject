import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";

const router = Router();

/**
 * GET /api/admin/dashboard/stats
 */
router.get("/stats", auth, async (_req, res) => {
  try {
    // ---------------- Orders totals ----------------
    const totalOrders = await prisma.order.count();

    // ✅ correct enum values
    const pendingOrders = await prisma.order.count({ where: { status: "Pending" } });
    const confirmedOrders = await prisma.order.count({ where: { status: "Confirmed" } });
    const shippedOrders = await prisma.order.count({ where: { status: "Shipped" } });
    const deliveredOrders = await prisma.order.count({ where: { status: "Delivered" } });
    const cancelledOrders = await prisma.order.count({ where: { status: "Cancelled" } });

    // ---------------- Status breakdowns (optional but best) ----------------
    const orderStatusGroup = await prisma.order.groupBy({
      by: ["status"],
      _count: { _all: true },
    });

    const orderStatusCounts = orderStatusGroup.reduce((acc: any, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {});

    const paymentStatusGroup = await prisma.order.groupBy({
      by: ["paymentStatus"],
      _count: { _all: true },
    });

    const paymentStatusCounts = paymentStatusGroup.reduce((acc: any, row) => {
      acc[row.paymentStatus] = row._count._all;
      return acc;
    }, {});

    const shipmentStatusGroup = await prisma.order.groupBy({
      by: ["shipmentStatus"],
      _count: { _all: true },
    });

    const shipmentStatusCounts = shipmentStatusGroup.reduce((acc: any, row) => {
      acc[row.shipmentStatus] = row._count._all;
      return acc;
    }, {});

    // ---------------- Revenue (Paid) ----------------
    // preferred: use Order.paidAmount when paymentStatus=Paid
    const revenueAgg = await prisma.order.aggregate({
      where: { paymentStatus: "Paid" },
      _sum: { paidAmount: true },
    });

    const totalRevenue = revenueAgg._sum.paidAmount ?? 0;

    // ---------------- Catalog ----------------
    const totalProducts = await prisma.product.count();
    const activeProducts = await prisma.product.count({ where: { isActive: true } });

    const totalVariants = await prisma.productVariant.count();
    const outOfStockVariants = await prisma.productVariant.count({
      where: { stockQuantity: 0 },
    });

    // low stock: stockQuantity <= lowStockAlertAt (Prisma supports field compare)
    const lowStockVariants = await prisma.productVariant.count({
      where: { stockQuantity: { lte: prisma.productVariant.fields.lowStockAlertAt } as any },
    });

    // If above line gives TS error, use this fallback:
    // const lowStockVariants = await prisma.productVariant.count({
    //   where: { stockQuantity: { lte: 5 } }, // fallback threshold
    // });

    const totalCategories = await prisma.category.count();
    const totalSubCategories = await prisma.subCategory.count();
    const totalTags = await prisma.tag.count();

    // ---------------- Users / Reviews / Coupons / Media ----------------
    const totalUsers = await prisma.user.count();
    const pendingReviews = await prisma.review.count({ where: { status: "Pending" } });
    const activeCoupons = await prisma.coupon.count({ where: { isActive: true } });
    const totalMediaAssets = await prisma.mediaAsset.count();

    return res.json({
      success: true,
      data: {
        totalOrders,
        pendingOrders,
        confirmedOrders,
        shippedOrders,
        deliveredOrders,
        cancelledOrders,

        totalRevenue,

        orderStatusCounts,
        paymentStatusCounts,
        shipmentStatusCounts,

        totalProducts,
        activeProducts,
        totalVariants,
        outOfStockVariants,
        lowStockVariants,

        totalCategories,
        totalSubCategories,
        totalTags,

        totalUsers,
        pendingReviews,
        activeCoupons,
        totalMediaAssets,
      },
    });
  } catch (err: any) {
    console.error("Dashboard API Error:", err);
    return res.status(500).json({
      success: false,
      message: "Dashboard stats failed",
      error: err?.message,
    });
  }
});

export default router;
