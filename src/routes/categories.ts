import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { slugify } from "../utils/slugify";

const router = Router();

const CreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(), // ✅ ADD
  isActive: z.boolean().optional(),
});

const UpdateSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(), // ✅ ADD
  isActive: z.boolean().optional(),
});

async function generateUniqueCategorySlug(baseSlug: string) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const exists = await prisma.category.findUnique({ where: { slug } });
    if (!exists) return slug;

    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }
}

function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

/* ============================
   PUBLIC: LIST ACTIVE
   GET /api/categories
============================ */
router.get("/", async (_req, res) => {
  const data = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    include: {
      subCategories: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
    },
  });

  res.json({ success: true, data });
});

/* ============================
   PUBLIC: GET BY SLUG
   GET /api/categories/slug/:slug
============================ */
router.get("/slug/:slug", async (req, res) => {
  const slug = String(req.params.slug);

  const data = await prisma.category.findUnique({
    where: { slug },
    include: {
      subCategories: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
    },
  });

  if (!data || !data.isActive) {
    return res.status(404).json({ success: false, message: "Category not found" });
  }

  res.json({ success: true, data });
});

/* ============================
   ADMIN: LIST ALL (ACTIVE+INACTIVE)
   GET /api/categories/admin/all
============================ */
router.get("/admin/all", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const data = await prisma.category.findMany({
    orderBy: { createdAt: "desc" },
    include: { subCategories: { orderBy: { createdAt: "desc" } } },
  });

  res.json({ success: true, data });
});

/* ============================
   ADMIN: CREATE
   POST /api/categories
============================ */
router.post("/", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  try {
    const body = CreateSchema.parse(req.body);

    const baseSlug = body.slug?.trim() ? slugify(body.slug) : slugify(body.name);
    const uniqueSlug = await generateUniqueCategorySlug(baseSlug);

    const created = await prisma.category.create({
      data: {
        name: body.name.trim(),
        slug: uniqueSlug,
        imageUrl: body.imageUrl?.trim() || null, // ✅ ADD
        isActive: body.isActive ?? true,
      },
    });

    return res.json({ success: true, data: created });
  } catch (e: any) {
    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different name."
        : e?.message || "Failed to create category";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ============================
   ADMIN: UPDATE
   PUT /api/categories/:id
============================ */
router.put("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  try {
    const body = UpdateSchema.parse(req.body);

    const current = await prisma.category.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ success: false, message: "Category not found" });

    const dataToUpdate: any = {};

    if (body.name !== undefined) dataToUpdate.name = body.name.trim();
    if (body.imageUrl !== undefined) dataToUpdate.imageUrl = body.imageUrl?.trim() || null; // ✅ ADD
    if (body.isActive !== undefined) dataToUpdate.isActive = body.isActive;

    // ✅ slug update rules:
    // - if slug explicitly sent => use it
    // - else if name changed and slug not sent => auto update slug from name
    const shouldUpdateSlug =
      body.slug !== undefined || (body.name !== undefined && body.slug === undefined);

    if (shouldUpdateSlug) {
      const baseSlugRaw =
        body.slug !== undefined
          ? (body.slug || "").trim()
          : (body.name || current.name).trim();

      const baseSlug = baseSlugRaw ? slugify(baseSlugRaw) : current.slug;

      let finalSlug = baseSlug;

      // check conflict
      const exists = await prisma.category.findUnique({ where: { slug: baseSlug } });
      if (exists && exists.id !== id) {
        finalSlug = await generateUniqueCategorySlug(baseSlug);
      }

      dataToUpdate.slug = finalSlug;
    }

    const updated = await prisma.category.update({
      where: { id },
      data: dataToUpdate,
    });

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    const msg =
      e?.code === "P2002"
        ? "Slug already exists. Try a different slug."
        : e?.message || "Failed to update category";

    return res.status(400).json({ success: false, message: msg });
  }
});

/* ============================
   ADMIN: SOFT DELETE
   DELETE /api/categories/:id
============================ */
router.delete("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  await prisma.category.update({
    where: { id },
    data: { isActive: false },
  });

  res.json({ success: true, message: "Category disabled" });
});

/* ============================
   ADMIN: TOGGLE ACTIVE
   PATCH /api/categories/:id/active
============================ */
router.patch("/:id/active", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const schema = z.object({ isActive: z.boolean() });
  const { isActive } = schema.parse(req.body);

  const updated = await prisma.category.update({
    where: { id },
    data: { isActive },
  });

  return res.json({ success: true, data: updated });
});

export default router;
