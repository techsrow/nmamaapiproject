import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

function toNumber(d: any) {
  if (d == null) return null;
  if (d instanceof Prisma.Decimal) return d.toNumber();
  return Number(d);
}

function nowBetween(startAt?: Date | null, endAt?: Date | null) {
  const now = new Date();
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

async function computeEligibleSubtotal(couponId: number, items: any[]) {
  const [cp, cc, csc] = await Promise.all([
    prisma.couponProduct.findMany({ where: { couponId }, select: { productId: true } }),
    prisma.couponCategory.findMany({ where: { couponId }, select: { categoryId: true } }),
    prisma.couponSubCategory.findMany({ where: { couponId }, select: { subCategoryId: true } }),
  ]);

  const productSet = new Set(cp.map((x) => x.productId));
  const categorySet = new Set(cc.map((x) => x.categoryId));
  const subCategorySet = new Set(csc.map((x) => x.subCategoryId));

  const hasRestriction = productSet.size > 0 || categorySet.size > 0 || subCategorySet.size > 0;

  if (!hasRestriction) return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  let eligible = 0;
  for (const it of items) {
    const matchProduct = productSet.size ? productSet.has(it.productId) : false;
    const matchCategory = categorySet.size && it.categoryId != null ? categorySet.has(it.categoryId) : false;
    const matchSubCategory = subCategorySet.size && it.subCategoryId != null ? subCategorySet.has(it.subCategoryId) : false;
    if (matchProduct || matchCategory || matchSubCategory) eligible += it.unitPrice * it.quantity;
  }
  return eligible;
}

function computeDiscountAmount(coupon: any, eligibleSubtotal: number) {
  let discount = 0;

  if (coupon.discountType === "PERCENT") {
    const percentOff = toNumber(coupon.percentOff) ?? 0;
    discount = (eligibleSubtotal * percentOff) / 100;
  } else {
    const amountOff = toNumber(coupon.amountOff) ?? 0;
    discount = amountOff;
  }

  const maxDiscount = toNumber(coupon.maxDiscount);
  if (maxDiscount != null) discount = Math.min(discount, maxDiscount);

  discount = Math.min(discount, eligibleSubtotal);
  return Number(discount.toFixed(2));
}

export async function validateAndComputeCoupon(params: {
  couponCode?: string | null;
  userId?: number | null;
  subtotal: number;
  computedItems: any[];
}) {
  const { couponCode, userId, subtotal, computedItems } = params;

  if (!couponCode) return { coupon: null as any, discount: 0 };

  const code = couponCode.trim().toUpperCase();
  const coupon = await prisma.coupon.findUnique({ where: { code } });

  if (!coupon || !coupon.isActive) throw new Error("Invalid coupon");
  if (!nowBetween(coupon.startAt, coupon.endAt)) throw new Error("Coupon expired or not active yet");
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) throw new Error("Coupon usage limit reached");

  const minOrder = toNumber(coupon.minOrderAmount);
  if (minOrder != null && subtotal < minOrder) throw new Error(`Minimum order amount is ${minOrder}`);

  if (userId && coupon.usagePerUser != null) {
    const usedByUser = await prisma.order.count({
      where: { userId, couponId: coupon.id, status: { not: "Cancelled" } },
    });
    if (usedByUser >= coupon.usagePerUser) throw new Error("Coupon usage limit per user reached");
  }

  const eligibleSubtotal = await computeEligibleSubtotal(coupon.id, computedItems);
  if (eligibleSubtotal <= 0) throw new Error("Coupon not applicable to selected items");

  const discount = computeDiscountAmount(coupon, eligibleSubtotal);
  return { coupon, discount };
}
