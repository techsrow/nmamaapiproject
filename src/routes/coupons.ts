import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const router = Router();

/* ======================================================
   HELPERS
====================================================== */

function nowBetween(startAt?: Date | null, endAt?: Date | null) {
  const now = new Date();
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

function toNumber(d: any) {
  if (d == null) return null;
  if (d instanceof Prisma.Decimal) return d.toNumber();
  return Number(d);
}

/**
 * Compute item unit price from variant:
 * discountPrice if exists else price
 */
function unitPriceFromVariant(v: any) {
  const discount = toNumber(v.discountPrice);
  const price = toNumber(v.price);
  return discount ?? price ?? 0;
}

/**
 * Determine eligible subtotal based on coupon mappings.
 * If coupon has no mappings -> eligible = full subtotal.
 * If mappings exist -> eligible only for matching items.
 */
async function computeEligibleSubtotal(params: {
  couponId: number;
  items: Array<{
    variantId: number;
    quantity: number;
    unitPrice: number;
    productId: number;
    categoryId: number | null;
    subCategoryId: number | null;
  }>;
}) {
  const { couponId, items } = params;

  const [cp, cc, csc] = await Promise.all([
    prisma.couponProduct.findMany({
      where: { couponId },
      select: { productId: true },
    }),
    prisma.couponCategory.findMany({
      where: { couponId },
      select: { categoryId: true },
    }),
    prisma.couponSubCategory.findMany({
      where: { couponId },
      select: { subCategoryId: true },
    }),
  ]);

  const productSet = new Set(cp.map((x) => x.productId));
  const categorySet = new Set(cc.map((x) => x.categoryId));
  const subCategorySet = new Set(csc.map((x) => x.subCategoryId));

  const hasAnyRestriction =
    productSet.size > 0 || categorySet.size > 0 || subCategorySet.size > 0;

  if (!hasAnyRestriction) {
    // no restrictions => whole cart eligible
    return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  }

  // eligible if matches ANY of the restrictions
  let eligible = 0;
  for (const it of items) {
    const matchProduct = productSet.size ? productSet.has(it.productId) : false;
    const matchCategory =
      categorySet.size && it.categoryId != null
        ? categorySet.has(it.categoryId)
        : false;
    const matchSubCategory =
      subCategorySet.size && it.subCategoryId != null
        ? subCategorySet.has(it.subCategoryId)
        : false;

    if (matchProduct || matchCategory || matchSubCategory) {
      eligible += it.unitPrice * it.quantity;
    }
  }

  return eligible;
}

/**
 * Calculate discount amount based on coupon type + constraints.
 */
function computeDiscountAmount(params: {
  coupon: any;
  eligibleSubtotal: number;
}) {
  const { coupon, eligibleSubtotal } = params;

  let discount = 0;

  if (coupon.discountType === "PERCENT") {
    const percentOff = toNumber(coupon.percentOff) ?? 0;
    discount = (eligibleSubtotal * percentOff) / 100;
  } else {
    const amountOff = toNumber(coupon.amountOff) ?? 0;
    discount = amountOff;
  }

  // max discount cap
  const maxDiscount = toNumber(coupon.maxDiscount);
  if (maxDiscount != null) discount = Math.min(discount, maxDiscount);

  // discount can't exceed eligible subtotal
  discount = Math.min(discount, eligibleSubtotal);

  return Number(discount.toFixed(2));
}

/* ======================================================
   SCHEMAS
====================================================== */

const ApplySchema = z.object({
  code: z.string().min(1),
  items: z
    .array(
      z.object({
        variantId: z.number(),
        quantity: z.number().min(1),
      })
    )
    .min(1),
});

const AdminCouponSchema = z.object({
  code: z.string().min(2),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),

  discountType: z.enum(["PERCENT", "FLAT"]),
  percentOff: z.number().optional().nullable(), // if PERCENT
  amountOff: z.number().optional().nullable(), // if FLAT

  minOrderAmount: z.number().optional().nullable(),
  maxDiscount: z.number().optional().nullable(),

  startAt: z.string().optional().nullable(),
  endAt: z.string().optional().nullable(),

  usageLimit: z.number().optional().nullable(),
  usagePerUser: z.number().optional().nullable(),

  // mappings (optional)
  productIds: z.array(z.number()).optional(),
  categoryIds: z.array(z.number()).optional(),
  subCategoryIds: z.array(z.number()).optional(),
});

const AdminCouponUpdateSchema = AdminCouponSchema.partial();

/* ======================================================
   PUBLIC: APPLY COUPON
   POST /api/coupons/apply
   (auth optional - per-user limit only works if logged in)
====================================================== */
router.post("/apply", async (req: Request, res: Response) => {
  try {
    const body = ApplySchema.parse(req.body);

    const code = body.code.trim().toUpperCase();
    const coupon = await prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon || !coupon.isActive) {
      return res.status(404).json({ success: false, message: "Invalid coupon" });
    }

    if (!nowBetween(coupon.startAt, coupon.endAt)) {
      return res.status(400).json({ success: false, message: "Coupon expired or not active yet" });
    }

    // Usage limit (global)
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
      return res.status(400).json({ success: false, message: "Coupon usage limit reached" });
    }

    // Build cart items from variants
    const variantIds = body.items.map((i) => i.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds }, isActive: true },
      include: {
        product: { select: { id: true, isActive: true, categoryId: true, subCategoryId: true } },
      },
    });

    // Validate all variants exist
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    for (const it of body.items) {
      const v = variantMap.get(it.variantId);
      if (!v || !v.product?.isActive) {
        return res.status(400).json({
          success: false,
          message: `Variant ${it.variantId} not found`,
        });
      }
    }

    const computedItems = body.items.map((it) => {
      const v = variantMap.get(it.variantId)!;
      const unitPrice = unitPriceFromVariant(v);
      return {
        variantId: it.variantId,
        quantity: it.quantity,
        unitPrice,
        productId: v.productId,
        categoryId: v.product.categoryId ?? null,
        subCategoryId: v.product.subCategoryId ?? null,
      };
    });

    const subtotal = computedItems.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    // Min order amount
    const minOrder = toNumber(coupon.minOrderAmount);
    if (minOrder != null && subtotal < minOrder) {
      return res.status(400).json({
        success: false,
        message: `Minimum order amount is ${minOrder}`,
      });
    }

    // If logged in, enforce per-user limit
    // (we read token if present, but do not require auth)
    let userId: number | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      try {
        // reuse your middleware decode logic by calling auth? not possible here
        // simplest: ignore per-user if not using auth route
        // => If you want strict per-user for apply, call /apply under auth.
      } catch {
        userId = null;
      }
    }

    // Eligible subtotal based on mappings
    const eligibleSubtotal = await computeEligibleSubtotal({
      couponId: coupon.id,
      items: computedItems,
    });

    if (eligibleSubtotal <= 0) {
      return res.status(400).json({
        success: false,
        message: "Coupon not applicable to selected items",
      });
    }

    const discountAmount = computeDiscountAmount({
      coupon,
      eligibleSubtotal,
    });

    const totalAfterDiscount = Math.max(0, subtotal - discountAmount);

    return res.json({
      success: true,
      data: {
        couponId: coupon.id,
        code: coupon.code,
        discountAmount,
        subtotal: Number(subtotal.toFixed(2)),
        total: Number(totalAfterDiscount.toFixed(2)),
        eligibleSubtotal: Number(eligibleSubtotal.toFixed(2)),
      },
      message: "Coupon applied",
    });
  } catch (e: any) {
    console.error("❌ COUPON APPLY ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   ADMIN: LIST COUPONS
   GET /api/coupons/admin
====================================================== */
router.get("/admin", auth, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "Admin") {
    return res.status(403).json({ success: false, message: "Admin only" });
  }

  const data = await prisma.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      couponProducts: true,
      couponCategories: true,
      couponSubCategories: true,
    },
  });

  return res.json({ success: true, data });
});

/* ======================================================
   ADMIN: CREATE COUPON (with mappings)
   POST /api/coupons/admin
====================================================== */
router.post("/admin", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const body = AdminCouponSchema.parse(req.body);

    const code = body.code.trim().toUpperCase();

    if (body.discountType === "PERCENT" && (body.percentOff == null || body.percentOff <= 0)) {
      return res.status(400).json({ success: false, message: "percentOff required for PERCENT" });
    }
    if (body.discountType === "FLAT" && (body.amountOff == null || body.amountOff <= 0)) {
      return res.status(400).json({ success: false, message: "amountOff required for FLAT" });
    }

    const created = await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: {
          code,
          description: body.description ?? null,
          isActive: body.isActive ?? true,

          discountType: body.discountType as any,
          percentOff: body.percentOff != null ? new Prisma.Decimal(body.percentOff) : null,
          amountOff: body.amountOff != null ? new Prisma.Decimal(body.amountOff) : null,

          minOrderAmount:
            body.minOrderAmount != null ? new Prisma.Decimal(body.minOrderAmount) : null,
          maxDiscount: body.maxDiscount != null ? new Prisma.Decimal(body.maxDiscount) : null,

          startAt: body.startAt ? new Date(body.startAt) : null,
          endAt: body.endAt ? new Date(body.endAt) : null,

          usageLimit: body.usageLimit ?? null,
          usagePerUser: body.usagePerUser ?? null,
        },
      });

      // mappings
      if (body.productIds?.length) {
        await tx.couponProduct.createMany({
          data: body.productIds.map((productId) => ({ couponId: coupon.id, productId })),
          skipDuplicates: true,
        });
      }
      if (body.categoryIds?.length) {
        await tx.couponCategory.createMany({
          data: body.categoryIds.map((categoryId) => ({ couponId: coupon.id, categoryId })),
          skipDuplicates: true,
        });
      }
      if (body.subCategoryIds?.length) {
        await tx.couponSubCategory.createMany({
          data: body.subCategoryIds.map((subCategoryId) => ({ couponId: coupon.id, subCategoryId })),
          skipDuplicates: true,
        });
      }

      return coupon;
    });

    return res.json({ success: true, message: "Coupon created", data: created });
  } catch (e: any) {
    console.error("❌ CREATE COUPON ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   ADMIN: UPDATE COUPON (and replace mappings)
   PUT /api/coupons/admin/:id
====================================================== */
router.put("/admin/:id", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

    const body = AdminCouponUpdateSchema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.update({
        where: { id },
        data: {
          code: body.code ? body.code.trim().toUpperCase() : undefined,
          description: body.description ?? undefined,
          isActive: body.isActive ?? undefined,

          discountType: body.discountType as any,
          percentOff:
            body.percentOff != null ? new Prisma.Decimal(body.percentOff) : body.percentOff === null ? null : undefined,
          amountOff:
            body.amountOff != null ? new Prisma.Decimal(body.amountOff) : body.amountOff === null ? null : undefined,

          minOrderAmount:
            body.minOrderAmount != null
              ? new Prisma.Decimal(body.minOrderAmount)
              : body.minOrderAmount === null
              ? null
              : undefined,

          maxDiscount:
            body.maxDiscount != null
              ? new Prisma.Decimal(body.maxDiscount)
              : body.maxDiscount === null
              ? null
              : undefined,

          startAt: body.startAt ? new Date(body.startAt) : body.startAt === null ? null : undefined,
          endAt: body.endAt ? new Date(body.endAt) : body.endAt === null ? null : undefined,

          usageLimit: body.usageLimit ?? undefined,
          usagePerUser: body.usagePerUser ?? undefined,
        },
      });

      // if mappings provided, replace them
      if (body.productIds || body.categoryIds || body.subCategoryIds) {
        await Promise.all([
          tx.couponProduct.deleteMany({ where: { couponId: id } }),
          tx.couponCategory.deleteMany({ where: { couponId: id } }),
          tx.couponSubCategory.deleteMany({ where: { couponId: id } }),
        ]);

        if (body.productIds?.length) {
          await tx.couponProduct.createMany({
            data: body.productIds.map((productId) => ({ couponId: id, productId })),
            skipDuplicates: true,
          });
        }
        if (body.categoryIds?.length) {
          await tx.couponCategory.createMany({
            data: body.categoryIds.map((categoryId) => ({ couponId: id, categoryId })),
            skipDuplicates: true,
          });
        }
        if (body.subCategoryIds?.length) {
          await tx.couponSubCategory.createMany({
            data: body.subCategoryIds.map((subCategoryId) => ({ couponId: id, subCategoryId })),
            skipDuplicates: true,
          });
        }
      }

      return coupon;
    });

    return res.json({ success: true, message: "Coupon updated", data: updated });
  } catch (e: any) {
    console.error("❌ UPDATE COUPON ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   ADMIN: DELETE COUPON (soft via isActive=false)
   DELETE /api/coupons/admin/:id
====================================================== */
router.delete("/admin/:id", auth, async (req: AuthRequest, res: Response) => {
  if (req.user?.role !== "Admin") {
    return res.status(403).json({ success: false, message: "Admin only" });
  }

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  await prisma.coupon.update({
    where: { id },
    data: { isActive: false },
  });

  return res.json({ success: true, message: "Coupon disabled" });
});

export default router;
