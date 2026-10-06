import { Router } from "express";
import { prisma } from "../lib/prisma";
import { z } from "zod";

const router = Router();

const BannerGridSchema = z.object({
  banner1ImageUrl: z.string().url(),
  banner1CtaUrl: z.string().url(),
  banner2ImageUrl: z.string().url(),
  banner2CtaUrl: z.string().url(),
});

// GET /api/banner-grid
router.get("/", async (req, res) => {
  try {
    const data = await prisma.bannerGrid.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    res.status(200).json({
      success: true,
      data,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Failed to fetch banner grid.",
    });
  }
});

// PUT /api/banner-grid
router.put("/", async (req, res) => {
  try {
    const parsed = BannerGridSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.flatten(),
      });
    }

    const existing = await prisma.bannerGrid.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    const data = existing
      ? await prisma.bannerGrid.update({
          where: { id: existing.id },
          data: parsed.data,
        })
      : await prisma.bannerGrid.create({
          data: parsed.data,
        });

    res.status(200).json({
      success: true,
      data,
    });
  } catch {
    res.status(500).json({
      success: false,
      message: "Failed to save banner grid.",
    });
  }
});

export default router;
