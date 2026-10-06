import { Router, Response } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

import {
  prisma
} from "../lib/prisma";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
});

/* =====================================================
   EXPORT PRODUCTS
===================================================== */
router.get(
  "/export",
  async (_req, res: Response) => {
    try {
      const products =
        await prisma.product.findMany({
          include: {
            category: true,
            subCategory: true,

            images: true,

            variants: {
              include: {
                images: true,
              },
            },
          },
        });

      const rows: any[] = [];

      for (const product of products) {
        // Simple product
        if (
          !product.variants ||
          product.variants.length === 0
        ) {
          rows.push({
            name: product.name,
            slug: product.slug,
            description:
              product.description,

            category:
              product.category
                ?.name || "",

            subCategory:
              product
                .subCategory
                ?.name || "",

            imageUrl:
              product.imageUrl,

            galleryImages:
              product.images
                .map(
                  (img) =>
                    img.url
                )
                .join("|"),
          });

          continue;
        }

        // Variable product
        for (const variant of product.variants) {
          rows.push({
            name:
              product.name,

            slug:
              product.slug,

            description:
              product.description,

            category:
              product.category
                ?.name || "",

            subCategory:
              product
                .subCategory
                ?.name || "",

            imageUrl:
              product.imageUrl,

            galleryImages:
  product.images
    .map(
      (
        img: any
      ) => img.url
    )
    .join("|"),

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

           variantImages:
  variant.images
    .map(
      (
        img: any
      ) => img.url
    )
    .join("|"),
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
    } catch (error) {
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

/* =====================================================
   IMPORT PRODUCTS
===================================================== */
router.post(
  "/import",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "Excel file required",
          });
      }

      const workbook =
        XLSX.read(
          req.file.buffer,
          {
            type:
              "buffer",
          }
        );

      const sheetName =
        workbook.SheetNames[0];

      const sheet =
        workbook.Sheets[
          sheetName
        ];

      const rows =
        XLSX.utils.sheet_to_json<
          Record<
            string,
            any
          >
        >(sheet);

      if (
        !rows.length
      ) {
        return res
          .status(400)
          .json({
            success:
              false,
            message:
              "Excel is empty",
          });
      }

      const safeValue =
        (
          value: any
        ) => {
          if (
            value ===
              undefined ||
            value ===
              null ||
            value ===
              "" ||
            value ===
              "NaN"
          ) {
            return null;
          }

          return String(
            value
          ).trim();
        };

      const groupedProducts:
        Record<
          string,
          any
        > = {};

      // Group rows by slug
      for (const row of rows) {
        const slug =
          safeValue(
            row.slug
          );

        if (!slug)
          continue;

        if (
          !groupedProducts[
            slug
          ]
        ) {
          groupedProducts[
            slug
          ] = {
            product: {
              name:
                safeValue(
                  row.name
                ),

              slug,

              description:
                safeValue(
                  row.description
                ),

              category:
                safeValue(
                  row.category
                ),

              subCategory:
                safeValue(
                  row.subCategory
                ),

              imageUrl:
                safeValue(
                  row.imageUrl
                ),
            },

            galleryImages:
              [],

            variants:
              [],
          };
        }

        // gallery images
        const gallery =
          safeValue(
            row.galleryImages
          );

        if (
          gallery
        ) {
          const images =
            gallery
              .split("|")
              .map(
                (
                  img: string
                ) =>
                  img.trim()
              )
              .filter(
                Boolean
              );

          groupedProducts[
            slug
          ].galleryImages.push(
            ...images
          );
        }

        // variant
        groupedProducts[
          slug
        ].variants.push({
          color:
            safeValue(
              row.color
            ),

          size:
            safeValue(
              row.size
            ),

          weight:
            row.weight
              ? Number(
                  row.weight
                )
              : null,

          sku:
            safeValue(
              row.sku
            ),

          stockQuantity:
            Number(
              row.stock
            ) || 0,

          price:
            Number(
              row.price
            ) || 0,

          discountPrice:
  row.discountPrice
    ? Number(
        row.discountPrice
      )
    : null,

        variantImages:
  safeValue(
    row.variantImages
  )
    ? safeValue(
        row.variantImages
      )
        ?.split("|")
        .map(
          (
            img: string
          ) =>
            img.trim()
        )
    : [],
        });
      }

      const products =
        Object.values(
          groupedProducts
        );

      const imported =
        [];
for (const item of products) {
  const product =
    item.product;

  // category lookup
  const category =
    await prisma.category.findFirst({
      where: {
        name:
          product.category,
      },
    });

  // subcategory lookup
  let subCategory =
    null;

  if (
    product.subCategory
  ) {
    subCategory =
      await prisma.subCategory.findFirst({
        where: {
          name:
            product.subCategory,
        },
      });
  }

  // check existing product
  const existing =
    await prisma.product.findUnique({
      where: {
        slug:
          product.slug,
      },
    });

  /* ==========================
     UPDATE PRODUCT
  ========================== */

  if (existing) {
    const updated =
      await prisma.product.update({
        where: {
          id:
            existing.id,
        },

        data: {
          name:
            product.name,

          description:
            product.description,

          imageUrl:
            product.imageUrl,

          categoryId:
            category?.id ??
            null,

          subCategoryId:
            subCategory?.id ??
            null,

          isActive:
            true,
        },
      });

    // Delete old variants
    await prisma.productVariant.deleteMany({
      where: {
        productId:
          updated.id,
      },
    });

    // Create variants
    for (const variant of item.variants) {

  // remove duplicate sku
  if (variant.sku) {
    await prisma.productVariant.deleteMany({
      where: {
        sku: variant.sku,
      },
    });
  }

  await prisma.productVariant.create({
    data: {
      productId:
        updated.id,

      color:
        variant.color,

      size:
        variant.size,

      weight:
        variant.weight,

      sku:
        variant.sku,

      stockQuantity:
        variant.stockQuantity,

      price:
        variant.price,

      discountPrice:
        variant.discountPrice ||
        null,
    },
  });
}

    imported.push({
      action:
        "updated",

      id:
        updated.id,

      slug:
        updated.slug,
    });
  }

  /* ==========================
     CREATE PRODUCT
  ========================== */

  else {
    const created =
      await prisma.product.create({
        data: {
          name:
            product.name,

          slug:
            product.slug,

          description:
            product.description,

          imageUrl:
            product.imageUrl,

          categoryId:
            category?.id ??
            null,

          subCategoryId:
            subCategory?.id ??
            null,

          isActive:
            true,

          productType:
            "clothing",
        },
      });

    // Create variants
    for (const variant of item.variants) {
      await prisma.productVariant.create({
        data: {
          productId:
            created.id,

          color:
            variant.color,

          size:
            variant.size,

          weight:
            variant.weight,

          sku:
            variant.sku,

          stockQuantity:
            variant.stockQuantity,

          price:
            variant.price,

          discountPrice:
            variant.discountPrice ||
            null,
        },
      });
    }

    imported.push({
      action:
        "created",

      id:
        created.id,

      slug:
        created.slug,
    });
  }
}

/* ==========================
   FINAL RESPONSE
========================== */

return res.json({
  success: true,

  totalImported:
    imported.length,

  results:
    imported,
});
 
    } catch (error: any) {
      console.error(
        "IMPORT ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            error.message,
        });
    }
  }
);

export default router;