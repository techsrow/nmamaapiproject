import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { slugify } from "../utils/slugify";

const router = Router();

const CreateSchema = z.object({
  categoryId: z.coerce.number(),
  name: z.string().min(1),
  slug: z.string().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(), // ✅ NEW
  isActive: z.boolean().optional(),
});

const UpdateSchema = z.object({
  categoryId: z.coerce.number().optional(),
  name: z.string().optional(),
  slug: z.string().optional().nullable(),
  imageUrl: z.string().url().optional().nullable(), // ✅ NEW
  isActive: z.boolean().optional(),
});

function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

async function generateUniqueSubCategorySlug(baseSlug: string) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const exists = await prisma.subCategory.findUnique({ where: { slug } });
    if (!exists) return slug;

    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

/* ============================
   PUBLIC: LIST ACTIVE
   GET /api/subcategories?categoryId=1
============================ */
router.get("/", async (req, res) => {
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;

  const data = await prisma.subCategory.findMany({
    where: {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      category: { isActive: true },
    },
    orderBy: { createdAt: "desc" },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });

  res.json({ success: true, data });
});

/* ============================
   PUBLIC: GET BY SLUG
   GET /api/subcategories/slug/:slug
============================ */
router.get("/slug/:slug", async (req, res) => {
  const slug = String(req.params.slug);

  const data = await prisma.subCategory.findUnique({
    where: { slug },
    include: { category: { select: { id: true, name: true, slug: true, isActive: true } } },
  });

  if (!data || !data.isActive || !data.category?.isActive) {
    return res.status(404).json({ success: false, message: "SubCategory not found" });
  }

  res.json({ success: true, data });
});

/* ============================
   ADMIN: LIST ALL
   GET /api/subcategories/admin/all
============================ */
router.get("/admin/all", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const data = await prisma.subCategory.findMany({
    orderBy: { createdAt: "desc" },
    include: { category: { select: { id: true, name: true, slug: true } } },
  });

  res.json({ success: true, data });
});

/* ============================
   ADMIN: CREATE
   POST /api/subcategories
============================ */
router.post("/", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const body = CreateSchema.parse(req.body);

    const cat = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!cat) return res.status(400).json({ success: false, message: "Invalid categoryId" });

    const baseSlug = body.slug?.trim() ? slugify(body.slug) : slugify(body.name);
    const uniqueSlug = await generateUniqueSubCategorySlug(baseSlug);

    const created = await prisma.subCategory.create({
      data: {
        categoryId: body.categoryId,
        name: body.name.trim(),
        slug: uniqueSlug,
        imageUrl: body.imageUrl ?? null, // ✅ NEW
        isActive: body.isActive ?? true,
      },
    });

    return res.json({ success: true, data: created });
  } catch (e: any) {
    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different name."
        : e?.message || "Failed to create subcategory";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ============================
   ADMIN: UPDATE
   PUT /api/subcategories/:id
============================ */
router.put("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const body = UpdateSchema.parse(req.body);

    const current = await prisma.subCategory.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "SubCategory not found" });

    if (body.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: body.categoryId } });
      if (!cat) return res.status(400).json({ success: false, message: "Invalid categoryId" });
    }

    const dataToUpdate: any = {};

    if (body.categoryId !== undefined) dataToUpdate.categoryId = body.categoryId;
    if (body.name !== undefined) dataToUpdate.name = body.name.trim();
    if (body.isActive !== undefined) dataToUpdate.isActive = body.isActive;

    // ✅ NEW
    if (body.imageUrl !== undefined) dataToUpdate.imageUrl = body.imageUrl;

    const shouldUpdateSlug =
      body.slug !== undefined || (body.name !== undefined && body.slug === undefined);

    if (shouldUpdateSlug) {
      const baseSlugRaw =
        body.slug !== undefined
          ? (body.slug || "").trim()
          : (body.name || current.name).trim();

      const baseSlug = baseSlugRaw ? slugify(baseSlugRaw) : current.slug;

      let finalSlug = baseSlug;

      const exists = await prisma.subCategory.findUnique({ where: { slug: baseSlug } });
      if (exists && exists.id !== id) {
        finalSlug = await generateUniqueSubCategorySlug(baseSlug);
      }

      dataToUpdate.slug = finalSlug;
    }

    const updated = await prisma.subCategory.update({
      where: { id },
      data: dataToUpdate,
    });

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different slug."
        : e?.message || "Failed to update subcategory";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ============================
   ADMIN: SOFT DELETE
   DELETE /api/subcategories/:id
============================ */
router.delete("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  await prisma.subCategory.update({
    where: { id },
    data: { isActive: false },
  });

  res.json({ success: true, message: "SubCategory disabled" });
});

/* ============================
   ADMIN: TOGGLE ACTIVE
   PATCH /api/subcategories/:id/active
============================ */
router.patch("/:id/active", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const schema = z.object({ isActive: z.boolean() });
  const { isActive } = schema.parse(req.body);

  const updated = await prisma.subCategory.update({
    where: { id },
    data: { isActive },
  });

  return res.json({ success: true, data: updated });
});

export default router;
