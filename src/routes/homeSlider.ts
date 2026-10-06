import { Router } from "express";
import { prisma } from "../lib/prisma";
import {
  CreateSliderItemSchema,
  UpdateSliderItemSchema,
  ReorderItemsSchema,
} from "../lib/validators/homeSlider";

const router = Router();

/**
 * Ensures the single HomeSlider row exists (key="home")
 */
async function ensureHomeSlider() {
  const existing = await prisma.homeSlider.findUnique({
    where: { key: "home" },
  });

  if (existing) return existing;

  return prisma.homeSlider.create({
    data: { key: "home" },
  });
}

/**
 * GET /api/home-slider
 * Returns:
 * {
 *   desktop: [...items],
 *   mobile: [...items]
 * }
 *
 * Optional: ?active=true|false (default: all)
 */
router.get("/", async (req, res) => {
  try {
    const active = req.query.active as string | undefined;
    const whereActive =
      active === undefined ? {} : { isActive: active === "true" };

    const slider = await ensureHomeSlider();

    const items = await prisma.homeSliderItem.findMany({
      where: { sliderId: slider.id, ...whereActive },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    const desktop = items.filter((i) => i.device === "DESKTOP");
    const mobile = items.filter((i) => i.device === "MOBILE");

    return res.json({ success: true, data: { desktop, mobile } });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * POST /api/home-slider/items
 * Create one item (desktop or mobile)
 */
router.post("/items", async (req, res) => {
  const parsed = CreateSliderItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: parsed.error.flatten(),
    });
  }

  try {
    const slider = await ensureHomeSlider();
    const p = parsed.data;

    const created = await prisma.homeSliderItem.create({
      data: {
        sliderId: slider.id,
        device: p.device,
        imageUrl: p.imageUrl,

        heading: p.heading ?? null,
        subHeading: p.subHeading ?? null,
        ctaText: p.ctaText ?? null,
        ctaHref: p.ctaHref ?? null,

        isActive: p.isActive ?? true,
        sortOrder: p.sortOrder ?? 0,
      },
    });

    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * PATCH /api/home-slider/items/:id
 */
router.patch("/items/:id", async (req, res) => {
  const parsed = UpdateSliderItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: parsed.error.flatten(),
    });
  }

  try {
    const exists = await prisma.homeSliderItem.findUnique({
      where: { id: req.params.id },
    });

    if (!exists) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    const p = parsed.data;

    const updated = await prisma.homeSliderItem.update({
      where: { id: req.params.id },
      data: {
        device: p.device ?? undefined,
        imageUrl: p.imageUrl ?? undefined,

        // allow explicit null
        heading: p.heading === undefined ? undefined : p.heading,
        subHeading: p.subHeading === undefined ? undefined : p.subHeading,
        ctaText: p.ctaText === undefined ? undefined : p.ctaText,
        ctaHref: p.ctaHref === undefined ? undefined : p.ctaHref,

        isActive: p.isActive ?? undefined,
        sortOrder: p.sortOrder ?? undefined,
      },
    });

    return res.json({ success: true, data: updated });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * DELETE /api/home-slider/items/:id
 */
router.delete("/items/:id", async (req, res) => {
  try {
    const exists = await prisma.homeSliderItem.findUnique({
      where: { id: req.params.id },
    });

    if (!exists) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    await prisma.homeSliderItem.delete({ where: { id: req.params.id } });

    return res.json({ success: true, message: "Deleted" });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * POST /api/home-slider/reorder
 * Reorder separately for desktop OR mobile
 * Body: { device: "DESKTOP", items: [{id, sortOrder}, ...] }
 */
router.post("/reorder", async (req, res) => {
  const parsed = ReorderItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: parsed.error.flatten(),
    });
  }

  try {
    const { device, items } = parsed.data;

    // update in transaction
    await prisma.$transaction(
      items.map((it) =>
        prisma.homeSliderItem.update({
          where: { id: it.id },
          data: { sortOrder: it.sortOrder },
        })
      )
    );

    // optional: ensure those ids belong to same device (skip for simplicity)
    return res.json({ success: true, message: `${device} reordered` });
  } catch (e) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
