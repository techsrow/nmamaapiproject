import { Prisma } from "@prisma/client";

export function formatVariant(v: any) {
  return {
    ...v,
    price:
      v.price instanceof Prisma.Decimal
        ? v.price.toNumber()
        : Number(v.price),

    discountPrice:
      v.discountPrice instanceof Prisma.Decimal
        ? v.discountPrice.toNumber()
        : v.discountPrice
        ? Number(v.discountPrice)
        : null,
  };
}

export function formatProduct(p: any) {
  return {
    ...p,
    variants: p.variants?.map(formatVariant) || [],
  };
}