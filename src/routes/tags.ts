import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { slugify } from "../utils/slugify";

const router = Router();

const CreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional().nullable(),
});

const UpdateSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

/* ============================
   PUBLIC: LIST ACTIVE
   GET /api/tags
============================ */
router.get("/", async (_req, res) => {
  const data = await prisma.tag.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ success: true, data });
});

/* ============================
   PUBLIC: GET BY SLUG
   GET /api/tags/slug/:slug
============================ */
router.get("/slug/:slug", async (req, res) => {
  const slug = String(req.params.slug);
  const data = await prisma.tag.findUnique({ where: { slug } });

  if (!data || !data.isActive) {
    return res.status(404).json({ success: false, message: "Tag not found" });
  }

  res.json({ success: true, data });
});

/* ============================
   ADMIN: LIST ALL
   GET /api/tags/admin/all
============================ */
router.get("/admin/all", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const data = await prisma.tag.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ success: true, data });
});

/* ============================
   ADMIN: CREATE
   POST /api/tags
============================ */
router.post("/", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const body = CreateSchema.parse(req.body);
  const slug = body.slug?.trim() ? slugify(body.slug) : slugify(body.name);

  try {
    const created = await prisma.tag.create({
      data: { name: body.name, slug },
    });
    res.json({ success: true, data: created });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/* ============================
   ADMIN: UPDATE
   PUT /api/tags/:id
============================ */
router.put("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const body = UpdateSchema.parse(req.body);

  const dataToUpdate: any = {};
  if (body.name !== undefined) dataToUpdate.name = body.name;
  if (body.slug !== undefined) dataToUpdate.slug = body.slug ? slugify(body.slug) : undefined;
  if (body.isActive !== undefined) dataToUpdate.isActive = body.isActive;

  try {
    const updated = await prisma.tag.update({ where: { id }, data: dataToUpdate });
    res.json({ success: true, data: updated });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/* ============================
   ADMIN: SOFT DELETE
   DELETE /api/tags/:id
============================ */
router.delete("/:id", auth, async (req: AuthRequest, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  await prisma.tag.update({ where: { id }, data: { isActive: false } });
  res.json({ success: true, message: "Tag disabled" });
});


/* ============================
   PUBLIC: PRODUCTS BY TAG SLUG
   GET /api/tags/slug/:slug/products
============================ */
router.get("/slug/:slug/products", async (req, res) => {
  try {
    const slug = String(req.params.slug);

    // 1) find the tag
    const tag = await prisma.tag.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });

    if (!tag || !tag.isActive) {
      return res.status(404).json({ success: false, message: "Tag not found" });
    }

    // 2) fetch products via join table ProductTag
    const rows = await prisma.productTag.findMany({
      where: { tagId: tag.id },
      orderBy: { createdAt: "desc" },
      select: {
        product: {
          include: {
            category: true,
            subCategory: true,
            variants: true,
          },
        },
      },
    });

    // 3) flatten
    const products = rows.map((r) => r.product);

    return res.json({ success: true, data: products });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
});

export default router;
