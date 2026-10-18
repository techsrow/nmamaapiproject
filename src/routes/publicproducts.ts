import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import {
  mapProductListItem,
  groupVariantsByColor,
  getEffectivePrice,
} from "../mappers/product.mapper";

const router = Router();





/* =====================================================
   GET ALL PRODUCTS (PUBLIC SHOP + FILTERS)
   GET /api/publicproducts?category=skin-care&subCategory=face-wash&q=abc&minPrice=100&maxPrice=999&sort=price_asc
===================================================== */
router.get("/", async (req: Request, res: Response) => {
  try {
    const categorySlug = req.query.category ? String(req.query.category) : undefined;
    const subCategorySlug = req.query.subCategory ? String(req.query.subCategory) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    const minPrice = req.query.minPrice ? Number(req.query.minPrice) : undefined;
    const maxPrice = req.query.maxPrice ? Number(req.query.maxPrice) : undefined;

    const sort = req.query.sort ? String(req.query.sort) : "newest";

    // ✅ pagination
    const page = req.query.page ? Math.max(1, Number(req.query.page)) : 1;
    const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 15;

    // Product filters
    const productWhere: any = { isActive: true };

    if (categorySlug) {
      productWhere.category = {
        is: { slug: categorySlug, isActive: true },
      };
    }

    if (subCategorySlug) {
      productWhere.subCategory = {
        is: { slug: subCategorySlug, isActive: true },
      };
    }

    if (q) {
      productWhere.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    const productsRaw = await prisma.product.findMany({
      where: productWhere,
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        productTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
        brand: { select: { id: true, name: true, slug: true, isActive: true } },

        images: {
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, url: true, altText: true, isMain: true, sortOrder: true },
        },

        variants: {
          where: { isActive: true },
          orderBy: { price: "asc" },
          include: {
            images: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: { id: true, url: true, altText: true, sortOrder: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    let products = productsRaw;

    if (minPrice !== undefined || maxPrice !== undefined) {
      products = products.filter((p) => {
        const firstVariant = p.variants?.[0];
        if (!firstVariant) return false;

        const effective = getEffectivePrice(firstVariant);

        if (minPrice !== undefined && effective < minPrice) return false;
        if (maxPrice !== undefined && effective > maxPrice) return false;

        return true;
      });
    }

    if (sort === "price_asc" || sort === "price_desc") {
      products = products.sort((a, b) => {
        const aV = a.variants?.[0];
        const bV = b.variants?.[0];
        const aPrice = aV ? getEffectivePrice(aV) : Number.POSITIVE_INFINITY;
        const bPrice = bV ? getEffectivePrice(bV) : Number.POSITIVE_INFINITY;
        return sort === "price_asc" ? aPrice - bPrice : bPrice - aPrice;
      });
    }

    // ✅ pagination AFTER filters
    const totalItems = products.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const safePage = Math.min(page, totalPages);

    const start = (safePage - 1) * limit;
    const end = start + limit;

    const pageItems = products.slice(start, end);
return res.json({
  success: true,
  data: pageItems.map((p) =>
    mapProductListItem(p, groupVariantsByColor(p.variants))
  ),
  pagination: {
    page: safePage,
    limit,
    totalItems,
    totalPages,
  },
});

  } catch (error) {
    console.error("❌ GET PRODUCTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load products",
    });
  }
});


/* =====================================================
   GET SINGLE PRODUCT BY SLUG (PDP)
   GET /api/publicproducts/slug/:slug
===================================================== */
router.get("/slug/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);

    if (!slug) {
      return res.status(400).json({
        success: false,
        message: "Invalid product slug",
      });
    }

    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true, isActive: true } },

        images: {
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, url: true, altText: true, isMain: true, sortOrder: true },
        },

        variants: {
          where: { isActive: true },
          orderBy: { price: "asc" },
          include: {
            images: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: { id: true, url: true, altText: true, sortOrder: true },
            },
          },
        },

        productTags: {
          include: {
            tag: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const firstVariant = product.variants?.[0];
    const defaultPrice = firstVariant ? getEffectivePrice(firstVariant) : 0;
    const defaultDiscountPrice = firstVariant?.discountPrice
      ? Number(firstVariant.discountPrice)
      : null;

    const mainImage =
      product.images?.find((img) => img.isMain) ||
      product.images?.[0] ||
      (product.imageUrl ? { url: product.imageUrl } : null);

    return res.json({
      success: true,
      data: {
        id: product.id,
        slug: product.slug,

        name: product.name,
        description: product.description,
        shortDescriptionHtml: product.shortDescriptionHtml,
        apContentHtml: product.apContentHtml,
        apContentImageUrl: product.apContentImageUrl,
        apContentVideoUrl: product.apContentVideoUrl,

        productType: product.productType,

        category: product.category,
        subCategory: product.subCategory,

        imageUrl: product.imageUrl,
        mainImageUrl: (mainImage as any)?.url ?? null,
        images: product.images,

        price: defaultPrice,
        discountPrice: defaultDiscountPrice,

        tags: product.productTags.map((pt) => pt.tag),
        colors: groupVariantsByColor(product.variants || []),

        // variants: product.variants.map((v) => ({
        //   id: v.id,
        //   weight: v.weight,
        //   size: v.size,
        //   color: v.color,
        //   colorHex: v.colorHex,
        //   colorImageUrl: v.colorImageUrl,
        //   price: Number(v.price),
        //   discountPrice: v.discountPrice ? Number(v.discountPrice) : null,
        //   effectivePrice: getEffectivePrice(v),
        //   stockQuantity: v.stockQuantity,
        //   sku: v.sku,
        //   images: v.images,
        // })),
      },
    });
  } catch (error) {
    console.error("❌ GET PRODUCT BY SLUG ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load product",
    });
  }
});


// GET /api/Publicproducts/related/:slug?limit=8
// ✅ GET /api/publicproducts/related/:slug?limit=8
router.get("/related/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const limit = Math.min(Number(req.query.limit || 8), 20);

    const current = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, categoryId: true, subCategoryId: true },
    });

    if (!current) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const pickQuery = async (where: any, take: number) => {
      if (take <= 0) return [];
      return prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          subCategory: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true, isActive: true } },
          images: {
            orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
            select: { id: true, url: true, altText: true, isMain: true, sortOrder: true },
          },
          variants: {
            where: { isActive: true },
            orderBy: { price: "asc" },
            include: {
              images: {
                orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                select: { id: true, url: true, altText: true, sortOrder: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
      });
    };

    const usedIds = new Set<number>([current.id]);
    const pushUnique = (arr: any[], out: any[], max: number) => {
      for (const p of arr) {
        if (out.length >= max) break;
        if (usedIds.has(p.id)) continue;
        usedIds.add(p.id);
        out.push(p);
      }
    };

    const collected: any[] = [];

    // 1) same subCategory
    if (current.subCategoryId) {
      const items = await pickQuery(
        { isActive: true, id: { not: current.id }, subCategoryId: current.subCategoryId },
        limit
      );
      pushUnique(items, collected, limit);
    }

    // 2) fill same category
    if (collected.length < limit && current.categoryId) {
      const items = await pickQuery(
        { isActive: true, categoryId: current.categoryId, id: { notIn: Array.from(usedIds) } },
        limit - collected.length
      );
      pushUnique(items, collected, limit);
    }

    // 3) fallback latest
    if (collected.length < limit) {
      const items = await pickQuery(
        { isActive: true, id: { notIn: Array.from(usedIds) } },
        limit - collected.length
      );
      pushUnique(items, collected, limit);
    }

    // ✅ Return SAME shape as list API
    return res.json({
      success: true,
      data: collected.map((p: any) => {
        const firstVariant = p.variants?.[0];

        const defaultPrice = firstVariant ? getEffectivePrice(firstVariant) : 0;
        const defaultDiscountPrice = firstVariant?.discountPrice
          ? Number(firstVariant.discountPrice)
          : null;

        const mainImage =
          p.images?.find((img: any) => img.isMain) ||
          p.images?.[0] ||
          (p.imageUrl ? { url: p.imageUrl } : null);

        return {
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: p.description,
          productType: p.productType,
          isActive: p.isActive,

          category: p.category,
          subCategory: p.subCategory,

          imageUrl: p.imageUrl,
          mainImageUrl: (mainImage as any)?.url ?? null,

          images: p.images,

          price: defaultPrice,
          discountPrice: defaultDiscountPrice,
          colors: groupVariantsByColor(p.variants),

          //           variants: p.variants.map((v: any) => ({

          //   id: v.id,
          //   weight: v.weight,
          //   size: v.size,
          //   color: v.color,
          //   colorHex: v.colorHex,
          //   colorImageUrl: v.colorImageUrl,
          //   price: Number(v.price),
          //   discountPrice: v.discountPrice ? Number(v.discountPrice) : null,
          //   effectivePrice: getEffectivePrice(v),
          //   stockQuantity: v.stockQuantity,
          //   sku: v.sku,
          //   images: v.images,
          // })),
        };
      }),
    });
  } catch (err) {
    console.error("Related products error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



/* =====================================================
   GET SINGLE PRODUCT (PRODUCT DETAILS PAGE)
   GET /api/publicproducts/:id
===================================================== */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true, isActive: true } },

        images: {
          orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }],
          select: { id: true, url: true, altText: true, isMain: true, sortOrder: true },
        },

        variants: {
          where: { isActive: true },
          orderBy: { price: "asc" },
          include: {
            images: {
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
              select: { id: true, url: true, altText: true, sortOrder: true },
            },
          },
        },

        productTags: {
          include: {
            tag: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!product || !product.isActive) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const firstVariant = product.variants?.[0];
    const defaultPrice = firstVariant ? getEffectivePrice(firstVariant) : 0;
    const defaultDiscountPrice = firstVariant?.discountPrice ? Number(firstVariant.discountPrice) : null;

    const mainImage =
      product.images?.find((img) => img.isMain) ||
      product.images?.[0] ||
      (product.imageUrl ? { url: product.imageUrl } : null);

    return res.json({
      success: true,
      data: {
        id: product.id,
        name: product.name,
        description: product.description,
        shortDescriptionHtml: product.shortDescriptionHtml,
        apContentHtml: product.apContentHtml,
        apContentImageUrl: product.apContentImageUrl,
        apContentVideoUrl: product.apContentVideoUrl,

        productType: product.productType,
        isActive: product.isActive,

        category: product.category,
        subCategory: product.subCategory,

        imageUrl: product.imageUrl,
        mainImageUrl: (mainImage as any)?.url ?? null,

        images: product.images,

        price: defaultPrice,
        discountPrice: defaultDiscountPrice,

        tags: product.productTags.map((pt) => pt.tag),
        colors: groupVariantsByColor(product.variants || []),

        // variants: product.variants.map((v) => ({
        //   id: v.id,
        //   weight: v.weight,
        //   size: v.size,
        //   color: v.color,
        //   colorHex: v.colorHex,
        //   colorImageUrl: v.colorImageUrl,
        //   price: Number(v.price),
        //   discountPrice: v.discountPrice ? Number(v.discountPrice) : null,
        //   effectivePrice: getEffectivePrice(v),
        //   stockQuantity: v.stockQuantity,
        //   sku: v.sku,
        //   images: v.images,
        // })),
      },
    });
  } catch (error) {
    console.error("❌ GET PRODUCT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load product",
    });
  }
});


  

export default router;
  