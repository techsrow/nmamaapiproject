import { Router } from "express";
import { prisma } from "../lib/prisma";
import { Prisma, ReviewStatus } from "@prisma/client";

const router = Router();

/** ✅ Ping (debug) */
router.get("/ping", (req, res) => {
  return res.json({ success: true, message: "publicReviews mounted ✅" });
});

/** ✅ Public: Reviews by product slug */
router.get("/product/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const sort = String(req.query.sort || "latest"); // latest | top

    const product = await prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const where: Prisma.ReviewWhereInput = {
      productId: product.id,
      status: ReviewStatus.Approved,
      isActive: true,
    };

    const orderBy: Prisma.ReviewOrderByWithRelationInput[] =
      sort === "top"
        ? [{ rating: "desc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }];

    const [total, reviews, grouped] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          status: true,
          createdAt: true,
          user: { select: { firstName: true, lastName: true } },
          images: { select: { id: true, url: true, altText: true } },
        },
      }),
      prisma.review.groupBy({
        by: ["rating"],
        where,
        _count: { rating: true },
      }),
    ]);

    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of grouped) {
      const r = Number(g.rating);
      if (r >= 1 && r <= 5) counts[r] = g._count.rating;
    }

    const sum =
      1 * counts[1] + 2 * counts[2] + 3 * counts[3] + 4 * counts[4] + 5 * counts[5];
    const totalRatings = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    const avg = totalRatings ? Number((sum / totalRatings).toFixed(2)) : 0;

    return res.json({
      success: true,
      data: {
        page,
        limit,
        total,
        avgRating: avg,
        ratingCounts: counts,
        reviews,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
