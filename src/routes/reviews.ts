import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { z } from "zod";
import { reviewUpload } from "../lib/reviewUpload";
import { ReviewStatus } from "@prisma/client";

const router = Router();

/**
 * PUBLIC: Get approved reviews for a product
 * GET /api/reviews/product/:productId
 */
router.get("/product/:productId", async (req: Request, res: Response) => {
  try {
    const productId = Number(req.params.productId);

    if (!Number.isFinite(productId)) {
      return res.status(400).json({ success: false, message: "Invalid productId" });
    }

    const reviews = await prisma.review.findMany({
      where: {
        productId,
        status: ReviewStatus.Approved,
        isActive: true,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        images: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      success: true,
      data: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        createdAt: r.createdAt,
        user: r.user
          ? { id: r.user.id, name: `${r.user.firstName} ${r.user.lastName}` }
          : { id: null, name: "Guest" },
        images: r.images.map((img) => img.url),
      })),
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * CUSTOMER: Create review with images
 * POST /api/reviews
 * multipart/form-data
 * fields: productId OR productSlug, rating, title?, comment?
 * files: images[] (optional)
 */
const CreateReviewSchema = z
  .object({
    productId: z.coerce.number().optional(),
    productSlug: z.string().trim().optional(),
    rating: z.coerce.number().min(1).max(5),
    title: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((d) => !!d.productId || !!d.productSlug, {
    message: "productId or productSlug is required",
  });

router.post("/", auth, reviewUpload.array("images", 5), async (req: any, res: Response) => {
  try {
    // ✅ token middleware puts userId here in your app
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const body = CreateReviewSchema.parse(req.body);

    // ✅ require something meaningful
    if (!body.title && !body.comment) {
      return res.status(400).json({
        success: false,
        message: "title or comment is required",
      });
    }

    // ✅ find product by id or slug
    const product = body.productId
      ? await prisma.product.findUnique({
          where: { id: body.productId },
          select: { id: true, isActive: true },
        })
      : await prisma.product.findUnique({
          where: { slug: body.productSlug! },
          select: { id: true, isActive: true },
        });

    if (!product || !product.isActive) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    // ✅ prevent duplicate review per user per product
    const already = await prisma.review.findFirst({
      where: { productId: product.id, userId, isActive: true },
      select: { id: true },
    });

    if (already) {
      return res.status(409).json({
        success: false,
        message: "You already submitted a review for this product.",
      });
    }

    // ✅ cloudinary files (multer storage returns .path as hosted URL)
    const files = (req.files || []) as any[];

    // ✅ FIX: filter bad uploads to prevent url: undefined
    const imagesToCreate = files
      .map((f: any) => ({
        url: typeof f?.path === "string" ? f.path.trim() : "",
        altText: null,
      }))
      .filter((img: any) => img.url.length > 0);

    // ✅ build prisma data safely (do not pass undefined relational objects)
    const data: any = {
      productId: product.id,
      userId,
      rating: body.rating,
      title: body.title ?? null,
      comment: body.comment ?? null,
      status: ReviewStatus.Pending,
      isActive: true, // safe because PUBLIC GET requires Approved
    };

    if (imagesToCreate.length > 0) {
      data.images = { create: imagesToCreate };
    }

    const created = await prisma.review.create({
      data,
      include: { images: true },
    });

    return res.json({
      success: true,
      message: "Review submitted. Waiting for approval.",
      data: {
        id: created.id,
        status: created.status,
        images: created.images.map((i) => i.url),
      },
    });
  } catch (e: any) {
    // ✅ nicer zod error message
    if (e?.name === "ZodError") {
      return res.status(400).json({
        success: false,
        message: e.errors?.[0]?.message || "Invalid input",
      });
    }
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * ADMIN: list pending reviews
 * GET /api/reviews/admin/pending
 */
router.get("/admin/pending", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const reviews = await prisma.review.findMany({
      where: { status: ReviewStatus.Pending, isActive: true },
      include: {
        product: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        images: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: reviews });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * ADMIN: approve review
 * PUT /api/reviews/admin/:id/approve
 */
router.put("/admin/:id/approve", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid review id" });
    }

    const updated = await prisma.review.update({
      where: { id },
      data: { status: ReviewStatus.Approved, isActive: true },
    });

    return res.json({ success: true, message: "Review approved", data: updated });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * ADMIN: reject review
 * PUT /api/reviews/admin/:id/reject
 */
router.put("/admin/:id/reject", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid review id" });
    }

    const updated = await prisma.review.update({
      where: { id },
      data: { status: ReviewStatus.Rejected },
    });

    return res.json({ success: true, message: "Review rejected", data: updated });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * ADMIN: soft delete review (hide from public)
 * DELETE /api/reviews/admin/:id
 */
router.delete("/admin/:id", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, message: "Invalid review id" });
    }

    const review = await prisma.review.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!review) {
      return res.status(404).json({ success: false, message: "Review not found" });
    }

    await prisma.review.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json({ success: true, message: "Review removed" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

export default router;
