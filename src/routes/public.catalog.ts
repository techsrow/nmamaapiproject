// src/routes/public.catalog.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/* ---------------------------
   Helpers
---------------------------- */
function toBool(v: any): boolean | undefined {
  if (v === true || v === "true" || v === "1" || v === 1) return true;
  if (v === false || v === "false" || v === "0" || v === 0) return false;
  return undefined;
}

function toInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseIds(v: any): number[] | undefined {
  if (!v) return undefined;
  const parts = String(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
  return parts.length ? parts : undefined;
}

function parseInclude(v: any) {
  const s = String(v || "").toLowerCase();
  return new Set(
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

function safeSort(sort: any, allowed: string[], fallback: any) {
  const raw = String(sort || "").trim();
  if (!raw) return fallback;

  const [field, dirRaw] = raw.split(":");
  if (!allowed.includes(field)) return fallback;

  const dir = (dirRaw || "asc").toLowerCase() === "desc" ? "desc" : "asc";
  return { [field]: dir };
}

/* =========================================================
   GET /api/public/categories
   Query:
     q, slug, ids
     isActive=true|false
     featured=true|false (only if your Category has "featured" field — else remove)
     include=subcategories
     includeCounts=true
     hasProducts=true
     page, limit, sort=name:asc|createdAt:desc|updatedAt:desc
========================================================= */
router.get("/categories", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const slug = req.query.slug ? String(req.query.slug) : undefined;
    const ids = parseIds(req.query.ids);

    const isActive = toBool(req.query.isActive);
    const hasProducts = toBool(req.query.hasProducts);

    const include = parseInclude(req.query.include); // subcategories
    const includeCounts = toBool(req.query.includeCounts) === true;

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const orderBy = safeSort(req.query.sort, ["createdAt", "updatedAt", "name"], {
      createdAt: "desc",
    });

    const where: any = {
      ...(ids ? { id: { in: ids } } : {}),
      ...(slug ? { slug } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (hasProducts === true) {
      // Category has products relation in your schema ✅
      where.products = { some: {} };
    }

    const includeObj: any = {
      ...(include.has("subcategories")
        ? {
            subCategories: {
              where: {
                ...(isActive !== undefined ? { isActive } : {}),
              },
              orderBy: { createdAt: "desc" },
            },
          }
        : {}),
      ...(includeCounts
        ? {
            _count: {
              select: {
                subCategories: true,
                products: true,
              },
            },
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      prisma.category.count({ where }),
      prisma.category.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: includeObj,
      }),
    ]);

    return res.json({
      success: true,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
      data: items,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

/* =========================================================
   GET /api/public/categories/:slug
   Query:
     include=subcategories
     includeCounts=true
========================================================= */
router.get("/categories/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const include = parseInclude(req.query.include);
    const includeCounts = toBool(req.query.includeCounts) === true;
    const isActive = toBool(req.query.isActive); // optional filter for nested subcategories

    const item = await prisma.category.findFirst({
      where: { slug },
      include: {
        ...(include.has("subcategories")
          ? {
              subCategories: {
                where: {
                  ...(isActive !== undefined ? { isActive } : {}),
                },
                orderBy: { createdAt: "desc" },
              },
            }
          : {}),
        ...(includeCounts
          ? {
              _count: {
                select: {
                  subCategories: true,
                  products: true,
                },
              },
            }
          : {}),
      },
    });

    if (!item) return res.status(404).json({ success: false, message: "Category not found" });
    return res.json({ success: true, data: item });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

/* =========================================================
   GET /api/public/subcategories
   Query:
     q, slug, ids
     isActive=true|false
     categoryId=1
     categorySlug=mens
     includeCounts=true
     hasProducts=true
     page, limit, sort=name:asc|createdAt:desc|updatedAt:desc
========================================================= */
router.get("/subcategories", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const slug = req.query.slug ? String(req.query.slug) : undefined;
    const ids = parseIds(req.query.ids);

    const isActive = toBool(req.query.isActive);
    const hasProducts = toBool(req.query.hasProducts);

    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
    const categorySlug = req.query.categorySlug ? String(req.query.categorySlug) : undefined;

    const includeCounts = toBool(req.query.includeCounts) === true;

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const orderBy = safeSort(req.query.sort, ["createdAt", "updatedAt", "name"], {
      createdAt: "desc",
    });

    const where: any = {
      ...(ids ? { id: { in: ids } } : {}),
      ...(slug ? { slug } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(categorySlug ? { category: { slug: categorySlug } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (hasProducts === true) {
      where.products = { some: {} };
    }

    const [total, items] = await Promise.all([
      prisma.subCategory.count({ where }),
      prisma.subCategory.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          category: true,
          ...(includeCounts
            ? {
                _count: {
                  select: { products: true },
                },
              }
            : {}),
        },
      }),
    ]);

    return res.json({
      success: true,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
      data: items,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

/* =========================================================
   GET /api/public/subcategories/:slug
   Query:
     includeCounts=true
========================================================= */
router.get("/subcategories/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const includeCounts = toBool(req.query.includeCounts) === true;

    const item = await prisma.subCategory.findFirst({
      where: { slug },
      include: {
        category: true,
        ...(includeCounts ? { _count: { select: { products: true } } } : {}),
      },
    });

    if (!item) return res.status(404).json({ success: false, message: "SubCategory not found" });
    return res.json({ success: true, data: item });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

/* =========================================================
   TAGS (Public)
   NOTE:
   You didn't paste Tag model, so this section assumes:
     model Tag {
       id Int @id @default(autoincrement())
       name String
       slug String @unique
       isActive Boolean @default(true)
       popular Boolean @default(false) // optional
       createdAt DateTime @default(now())
       updatedAt DateTime @updatedAt
       products Product[] // many-to-many
     }
   If your relation names differ, tell me your Tag model and I’ll adjust.
========================================================= */

router.get("/tags", async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || "").trim();
    const slug = req.query.slug ? String(req.query.slug) : undefined;
    const ids = parseIds(req.query.ids);

    const isActive = toBool(req.query.isActive);
    const popular = toBool(req.query.popular);
    const hasProducts = toBool(req.query.hasProducts);
    const includeCounts = toBool(req.query.includeCounts) === true;

    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 20)));
    const skip = (page - 1) * limit;

    const orderBy = safeSort(req.query.sort, ["createdAt", "updatedAt", "name"], {
      createdAt: "desc",
    });

    const where: any = {
      ...(ids ? { id: { in: ids } } : {}),
      ...(slug ? { slug } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(popular !== undefined ? { popular } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    if (hasProducts === true) {
      // assumes Tag has products relation
      where.products = { some: {} };
    }

    const [total, items] = await Promise.all([
      prisma.tag.count({ where } as any),
      prisma.tag.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          ...(includeCounts ? { _count: { select: { products: true } } } : {}),
        },
      } as any),
    ]);

    return res.json({
      success: true,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
      },
      data: items,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

router.get("/tags/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const includeCounts = toBool(req.query.includeCounts) === true;

    const item = await prisma.tag.findFirst({
      where: { slug },
      include: {
        ...(includeCounts ? { _count: { select: { products: true } } } : {}),
      },
    } as any);

    if (!item) return res.status(404).json({ success: false, message: "Tag not found" });
    return res.json({ success: true, data: item });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

export default router;
