import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { slugify } from "../utils/slugify";
import { formatProduct } from "../utils/format";
import multer from "multer";
import * as XLSX from "xlsx";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

/* ------------------------------------------------------------------
   HELPERS
------------------------------------------------------------------ */

type ProductType = "weight" | "size" | "clothing" | "simple";

function isAdmin(req: any) {
  return req.user?.role === "Admin";
}

// Ensure slug unique: my-product, my-product-2, my-product-3...
async function generateUniqueProductSlug(baseSlug: string, ignoreId?: number) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const exists = await prisma.product.findUnique({ where: { slug } });
    if (!exists) return slug;
    if (ignoreId && exists.id === ignoreId) return slug;

    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

function normalizeVariantByType(productType: ProductType, v: any) {
  if (productType === "weight") {
    return {
      weight: v.weight ?? null,
      size: null,
      color: null,
      colorHex: null,
      colorImageUrl: null,
      price: v.price,
      discountPrice: v.discountPrice ?? null,
      stockQuantity: v.stockQuantity,
      sku: v.sku ?? null,
      isActive: v.isActive ?? true,
    };
  }

  if (productType === "size") {
    return {
      weight: null,
      size: v.size ?? null,
      color: null,
      colorHex: null,
      colorImageUrl: null,
      price: v.price,
      discountPrice: v.discountPrice ?? null,
      stockQuantity: v.stockQuantity,
      sku: v.sku ?? null,
      isActive: v.isActive ?? true,
    };
  }

  if (productType === "clothing") {
    return {
      weight: null,
      size: v.size ?? null,
      color: v.color ?? null,
      colorHex: v.colorHex ?? null,
      colorImageUrl: v.colorImageUrl ?? null,
      price: v.price,
      discountPrice: v.discountPrice ?? null,
      stockQuantity: v.stockQuantity,
      sku: v.sku ?? null,
      isActive: v.isActive ?? true,
    };
  }

  // simple (default)
  return {
    weight: v.weight ?? null,
    size: v.size ?? null,
    color: v.color ?? null,
    colorHex: v.colorHex ?? null,
    colorImageUrl: v.colorImageUrl ?? null,
    price: v.price,
    discountPrice: v.discountPrice ?? null,
    stockQuantity: v.stockQuantity,
    sku: v.sku ?? null,
    isActive: v.isActive ?? true,
  };
}

/* ------------------------------------------------------------------
   ZOD SCHEMAS
------------------------------------------------------------------ */

const VariantImageSchema = z.object({
  url: z.string().min(5),
  altText: z.string().optional().nullable(),
  sortOrder: z.number().optional().default(0),
});

const ProductImageSchema = z.object({
  url: z.string().min(5),
  altText: z.string().optional().nullable(),
  sortOrder: z.number().optional().default(0),
  isMain: z.boolean().optional().default(false),
});

const VariantSchema = z.object({
  weight: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  colorHex: z.string().optional().nullable(),
  colorImageUrl: z.string().optional().nullable(),

  price: z.number(),
  discountPrice: z.number().optional().nullable(),
  stockQuantity: z.number(),
  sku: z.string().optional().nullable(),

  images: z.array(VariantImageSchema).optional().default([]),
});

// ✅ Create
const CreateProductSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional().nullable(), // ✅ add slug support

  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),

  isActive: z.boolean().optional(), // allow setting at create

  productType: z.enum(["weight", "size", "clothing", "simple"]).default("simple"),

  categoryId: z.number().optional().nullable(),
  subCategoryId: z.number().optional().nullable(),

  // ✅ HTML editor fields
  shortDescriptionHtml: z.string().optional().nullable(),
  apContentHtml: z.string().optional().nullable(),
  apContentImageUrl: z.string().optional().nullable(),
  apContentVideoUrl: z.string().optional().nullable(),

  // ✅ SEO fields from Prisma model
  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  metaKeywords: z.string().optional().nullable(),
  canonicalUrl: z.string().optional().nullable(),
  ogImageUrl: z.string().optional().nullable(),

  variants: z.array(VariantSchema).min(1),

  images: z.array(ProductImageSchema).optional().default([]), // gallery
  tagIds: z.array(z.number()).optional().default([]), // tags
});

// ✅ Update
const UpdateProductSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional().nullable(), // ✅ allow slug update

  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),

  productType: z.enum(["weight", "size", "clothing", "simple"]).optional(),

  categoryId: z.number().optional().nullable(),
  subCategoryId: z.number().optional().nullable(),

  shortDescriptionHtml: z.string().optional().nullable(),
  apContentHtml: z.string().optional().nullable(),
  apContentImageUrl: z.string().optional().nullable(),
  apContentVideoUrl: z.string().optional().nullable(),

  metaTitle: z.string().optional().nullable(),
  metaDescription: z.string().optional().nullable(),
  metaKeywords: z.string().optional().nullable(),
  canonicalUrl: z.string().optional().nullable(),
  ogImageUrl: z.string().optional().nullable(),

  // Replace images/tags fully if provided
  images: z.array(ProductImageSchema).optional(),
  tagIds: z.array(z.number()).optional(),
});

const UpdateVariantSchema = VariantSchema.partial();

/* ------------------------------------------------------------------
   ADMIN: GET ALL PRODUCTS
   GET /api/products
------------------------------------------------------------------ */
router.get("/", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const products = await prisma.product.findMany({
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
        variants: {
          where: { isActive: true },
          orderBy: { price: "asc" },
          include: { images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
        },
        productTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    // return res.json({ success: true, data: products });
    return res.json({
  success: true,
  data: products.map(formatProduct),
});
  } catch (e) {
    console.error("❌ ADMIN GET PRODUCTS ERROR:", e);
    return res.status(500).json({ success: false, message: "Failed to load products" });
  }
});

/* ------------------------------------------------------------------
   ADMIN: GET SINGLE PRODUCT
   GET /api/products/:id
------------------------------------------------------------------ */
router.get("/:id", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid product id" });

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
        variants: {
          orderBy: { price: "asc" },
          include: { images: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
        },
        productTags: { include: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    });

    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    return res.json({ success: true, data: product });
  } catch (e) {
    console.error("❌ ADMIN GET PRODUCT ERROR:", e);
    return res.status(500).json({ success: false, message: "Failed to load product" });
  }
});

router.get(
  "/export",
  auth,
  async (
    req: AuthRequest,
    res: Response
  ) => {
    try {
      if (!isAdmin(req)) {
        return res
          .status(403)
          .json({
            success: false,
            message:
              "Unauthorized",
          });
      }

      const products =
        await prisma.product.findMany({
          include: {
            category: true,
            subCategory:
              true,

            images: {
              orderBy: {
                sortOrder:
                  "asc",
              },
            },

            variants: {
              include:
                {
                  images:
                    true,
                },
            },
          },
        });

      const rows: any[] =
        [];

      for (const product of products) {
        // no variants
        if (
          !product
            .variants
            .length
        ) {
          rows.push({
            name:
              product.name,

            slug:
              product.slug,

            description:
              product.description,

            category:
              product
                .category
                ?.name ||
              "",

            subCategory:
              product
                .subCategory
                ?.name ||
              "",

            productType:
              product.productType,

            imageUrl:
              product.imageUrl,

            galleryImages:
              product.images
                .map(
                  (
                    x
                  ) =>
                    x.url
                )
                .join(
                  "|"
                ),
          });

          continue;
        }

        for (const variant of product.variants) {
          rows.push({
            name:
              product.name,

            slug:
              product.slug,

            description:
              product.description,

            category:
              product
                .category
                ?.name ||
              "",

            subCategory:
              product
                .subCategory
                ?.name ||
              "",

            productType:
              product.productType,

            imageUrl:
              product.imageUrl,

            galleryImages:
              product.images
                .map(
                  (
                    x
                  ) =>
                    x.url
                )
                .join(
                  "|"
                ),

            color:
              variant.color,

            size:
              variant.size,

            weight:
              variant.weight,

            sku:
              variant.sku,

            stock:
              variant.stockQuantity,

            price:
              Number(
                variant.price
              ),

            discountPrice:
              variant.discountPrice
                ? Number(
                    variant.discountPrice
                  )
                : "",

            colorHex:
              variant.colorHex,

            variantImages:
              variant.images
                .map(
                  (
                    x
                  ) =>
                    x.url
                )
                .join(
                  "|"
                ),
          });
        }
      }

      const worksheet =
        XLSX.utils.json_to_sheet(
          rows
        );

      const workbook =
        XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Products"
      );

      const buffer =
        XLSX.write(
          workbook,
          {
            type:
              "buffer",
            bookType:
              "xlsx",
          }
        );

      res.setHeader(
        "Content-Disposition",
        "attachment; filename=products.xlsx"
      );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      return res.send(
        buffer
      );
    } catch (
      error
    ) {
      console.error(
        "EXPORT ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,
          message:
            "Export failed",
        });
    }
  }
);

/* ------------------------------------------------------------------
   ADMIN: CREATE PRODUCT
   POST /api/products
------------------------------------------------------------------ */
router.post("/", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const data = CreateProductSchema.parse(req.body);

    // validate category/subcategory if provided
    if (data.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!cat) return res.status(400).json({ success: false, message: "Invalid categoryId" });
    }
    if (data.subCategoryId) {
      const sub = await prisma.subCategory.findUnique({ where: { id: data.subCategoryId } });
      if (!sub) return res.status(400).json({ success: false, message: "Invalid subCategoryId" });
    }

    // ✅ slug generation
    const baseSlugRaw = data.slug?.trim() ? data.slug.trim() : data.name.trim();
    const baseSlug = slugify(baseSlugRaw);
    const uniqueSlug = await generateUniqueProductSlug(baseSlug);

    const product = await prisma.product.create({
      data: {
        name: data.name.trim(),
        slug: uniqueSlug,

        description: data.description ?? null,
        imageUrl: data.imageUrl ?? null,
        isActive: data.isActive ?? true,

        productType: data.productType,

        categoryId: data.categoryId ?? null,
        subCategoryId: data.subCategoryId ?? null,

        shortDescriptionHtml: data.shortDescriptionHtml ?? null,
        apContentHtml: data.apContentHtml ?? null,
        apContentImageUrl: data.apContentImageUrl ?? null,
        apContentVideoUrl: data.apContentVideoUrl ?? null,

        metaTitle: data.metaTitle ?? null,
        metaDescription: data.metaDescription ?? null,
        metaKeywords: data.metaKeywords ?? null,
        canonicalUrl: data.canonicalUrl ?? null,
        ogImageUrl: data.ogImageUrl ?? null,

        images: data.images.length
          ? {
              create: data.images.map((img) => ({
                url: img.url,
                altText: img.altText ?? null,
                sortOrder: img.sortOrder ?? 0,
                isMain: img.isMain ?? false,
              })),
            }
          : undefined,

        variants: {
          create: data.variants.map((v) => ({
            ...normalizeVariantByType(data.productType, v),
            images: v.images?.length
              ? {
                  create: v.images.map((vi) => ({
                    url: vi.url,
                    altText: vi.altText ?? null,
                    sortOrder: vi.sortOrder ?? 0,
                  })),
                }
              : undefined,
          })),
        },

        productTags: data.tagIds.length
          ? {
              create: data.tagIds.map((tagId) => ({
                tag: { connect: { id: tagId } },
              })),
            }
          : undefined,
      },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        images: true,
        variants: { include: { images: true } },
        productTags: { include: { tag: true } },
      },
    });

    return res.json({ success: true, data: product });
  } catch (e: any) {
    console.error("❌ CREATE PRODUCT ERROR:", e);

    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different name."
        : e?.message || "Failed to create product";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ------------------------------------------------------------------
   ADMIN: ADD VARIANT
   POST /api/products/:id/variants
------------------------------------------------------------------ */
router.post("/:id/variants", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const productId = Number(req.params.id);
    if (!productId) return res.status(400).json({ success: false, message: "Invalid product id" });

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const variant = VariantSchema.parse(req.body);

    const created = await prisma.productVariant.create({
      data: {
        productId,
        ...normalizeVariantByType(product.productType as ProductType, variant),
        images: variant.images?.length
          ? {
              create: variant.images.map((vi) => ({
                url: vi.url,
                altText: vi.altText ?? null,
                sortOrder: vi.sortOrder ?? 0,
              })),
            }
          : undefined,
      },
      include: { images: true },
    });

    return res.json({ success: true, data: created });
  } catch (e: any) {
    console.error("❌ ADD VARIANT ERROR:", e);
    return res.status(400).json({ success: false, message: e.message || "Failed to add variant" });
  }
});

/* ------------------------------------------------------------------
   ADMIN: UPDATE VARIANT
   PUT /api/products/variants/:variantId
------------------------------------------------------------------ */
router.put("/:productId/variants/:variantId", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const productId = Number(req.params.productId);
    const variantId = Number(req.params.variantId);

    if (!productId || !variantId) {
      return res.status(400).json({ success: false, message: "Invalid ids" });
    }

    const existing = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true, images: true },
    });

    if (!existing || existing.productId !== productId) {
      return res.status(404).json({ success: false, message: "Variant not found" });
    }

    const data = UpdateVariantSchema.parse(req.body);

    const merged = {
      weight: data.weight ?? existing.weight,
      size: data.size ?? existing.size,
      color: data.color ?? existing.color,
      colorHex: data.colorHex ?? existing.colorHex,
      colorImageUrl: data.colorImageUrl ?? existing.colorImageUrl,
      price:
        data.price ??
        (existing.price instanceof Prisma.Decimal
          ? existing.price.toNumber()
          : Number(existing.price)),
      discountPrice:
        data.discountPrice ??
        (existing.discountPrice instanceof Prisma.Decimal
          ? existing.discountPrice.toNumber()
          : existing.discountPrice),
      stockQuantity: data.stockQuantity ?? existing.stockQuantity,
      sku: data.sku ?? existing.sku,
      isActive: true,
    };

    await prisma.productVariant.update({
      where: { id: variantId },
      data: normalizeVariantByType(existing.product.productType as ProductType, merged),
    });

    if (data.images) {
      await prisma.productVariantImage.deleteMany({ where: { variantId } });

      if (data.images.length) {
        await prisma.productVariantImage.createMany({
          data: data.images.map((img) => ({
            variantId,
            url: img.url,
            altText: img.altText ?? null,
            sortOrder: img.sortOrder ?? 0,
          })),
        });
      }
    }

    const final = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { images: true },
    });

    return res.json({ success: true, data: final });
  } catch (e: any) {
    console.error("❌ UPDATE VARIANT ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});


/* ------------------------------------------------------------------
   ADMIN: GET VARIANTS BY PRODUCT
   GET /api/products/:id/variants
------------------------------------------------------------------ */
router.get("/:id/variants", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const productId = Number(req.params.id);
    if (!productId) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const variants = await prisma.productVariant.findMany({
      where: {
        productId,
        isActive: true,
      },
      include: {
        images: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        },
      },
      orderBy: { price: "asc" },
    });

    return res.json({ success: true, data: variants });
  } catch (e) {
    console.error("❌ GET VARIANTS ERROR:", e);
    return res.status(500).json({ success: false, message: "Failed to fetch variants" });
  }
});

/* ------------------------------------------------------------------
   ADMIN: UPDATE PRODUCT
   PUT /api/products/:id
------------------------------------------------------------------ */
router.put("/:id", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid product id" });

    const parsed = UpdateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: parsed.error.flatten(),
      });
    }

    const data = parsed.data;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Product not found" });

    if (data.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
      if (!cat) return res.status(400).json({ success: false, message: "Invalid categoryId" });
    }
    if (data.subCategoryId) {
      const sub = await prisma.subCategory.findUnique({ where: { id: data.subCategoryId } });
      if (!sub) return res.status(400).json({ success: false, message: "Invalid subCategoryId" });
    }

    // ✅ slug update logic
    const shouldUpdateSlug =
      data.slug !== undefined || (data.name !== undefined && data.slug === undefined);

    let finalSlug: string | undefined = undefined;
    if (shouldUpdateSlug) {
      const baseSlugRaw =
        data.slug !== undefined ? (data.slug || "").trim() : (data.name || existing.name).trim();

      const baseSlug = baseSlugRaw ? slugify(baseSlugRaw) : existing.slug;
      finalSlug = await generateUniqueProductSlug(baseSlug, id);
    }

    await prisma.product.update({
      where: { id },
      data: {
        name: data.name?.trim(),
        slug: finalSlug,

        description: data.description ?? undefined,
        imageUrl: data.imageUrl ?? undefined,
        isActive: data.isActive,

        productType: data.productType,

        categoryId: data.categoryId ?? undefined,
        subCategoryId: data.subCategoryId ?? undefined,

        shortDescriptionHtml: data.shortDescriptionHtml ?? undefined,
        apContentHtml: data.apContentHtml ?? undefined,
        apContentImageUrl: data.apContentImageUrl ?? undefined,
        apContentVideoUrl: data.apContentVideoUrl ?? undefined,

        metaTitle: data.metaTitle ?? undefined,
        metaDescription: data.metaDescription ?? undefined,
        metaKeywords: data.metaKeywords ?? undefined,
        canonicalUrl: data.canonicalUrl ?? undefined,
        ogImageUrl: data.ogImageUrl ?? undefined,
      },
    });

    if (data.images) {
      await prisma.productImage.deleteMany({ where: { productId: id } });
      if (data.images.length) {
        await prisma.productImage.createMany({
          data: data.images.map((img) => ({
            productId: id,
            url: img.url,
            altText: img.altText ?? null,
            sortOrder: img.sortOrder ?? 0,
            isMain: img.isMain ?? false,
          })),
        });
      }
    }

    if (data.tagIds) {
      await prisma.productTag.deleteMany({ where: { productId: id } });
      if (data.tagIds.length) {
        await prisma.productTag.createMany({
          data: data.tagIds.map((tagId) => ({
            productId: id,
            tagId,
          })),
        });
      }
    }

    const final = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        subCategory: { select: { id: true, name: true, slug: true } },
        images: { orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { id: "asc" }] },
        variants: { include: { images: true }, orderBy: { price: "asc" } },
        productTags: { include: { tag: true } },
      },
    });

    return res.json({ success: true, data: final });
  } catch (e: any) {
    console.error("❌ UPDATE PRODUCT ERROR:", e);

    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different slug."
        : e?.message || "Failed to update product";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ------------------------------------------------------------------
   ADMIN: TOGGLE ACTIVE
   PATCH /api/products/:id/active
------------------------------------------------------------------ */
router.patch("/:id/active", auth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Unauthorized" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid product id" });

  const schema = z.object({ isActive: z.boolean() });
  const { isActive } = schema.parse(req.body);

  const updated = await prisma.product.update({
    where: { id },
    data: { isActive },
  });

  return res.json({ success: true, data: updated });
});

/* ------------------------------------------------------------------
   ADMIN: DELETE PRODUCT (SOFT)
   DELETE /api/products/:id
------------------------------------------------------------------ */
router.delete("/:id", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid product id" });

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ DELETE PRODUCT ERROR:", e);
    return res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

/* ------------------------------------------------------------------
   ADMIN: DELETE VARIANT (SOFT)
   DELETE /api/products/variants/:variantId
------------------------------------------------------------------ */
router.delete("/variants/:variantId", auth, async (req: any, res: Response) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const variantId = Number(req.params.variantId);
    if (!variantId) return res.status(400).json({ success: false, message: "Invalid variant id" });

    await prisma.productVariant.update({
      where: { id: variantId },
      data: { isActive: false },
    });

    return res.json({ success: true });
  } catch (e) {
    console.error("❌ DELETE VARIANT ERROR:", e);
    return res.status(500).json({ success: false, message: "Failed to delete variant" });
  }
});

/* ------------------------------------------------------------------
   ADMIN: EXPORT PRODUCTS
   GET /api/products/export
------------------------------------------------------------------ */



export default router;
