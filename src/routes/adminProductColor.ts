import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

/**
 * ✅ 1. CREATE COLOR GROUP
 * POST /api/admin/product-colors
 */
router.post("/", async (req, res) => {
  try {
    const { productId, color, colorHex } = req.body;

    if (!productId || !color) {
      return res.status(400).json({
        success: false,
        message: "productId and color required",
      });
    }

    const colorGroup = await prisma.productColorGroup.create({
      data: {
        productId: Number(productId),
        color,
        colorHex,
      },
    });

    return res.json({
      success: true,
      data: colorGroup,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/**
 * ✅ 2. ADD IMAGES TO COLOR GROUP
 * POST /api/admin/product-colors/color-images
 */
router.post("/color-images", async (req, res) => {
  try {
    const { colorGroupId, images } = req.body;

    if (!colorGroupId || !images || !images.length) {
      return res.status(400).json({
        success: false,
        message: "colorGroupId and images required",
      });
    }

    const created = await prisma.productColorImage.createMany({
      data: images.map((img: any, index: number) => ({
        colorGroupId: Number(colorGroupId),
        url: img.url,
        altText: img.altText || null,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });

    return res.json({
      success: true,
      message: "Images added",
      data: created,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/**
 * ✅ 3. GET COLORS WITH IMAGES (FOR FRONTEND)
 * GET /api/admin/product-colors/:productId
 */
router.get("/:productId", async (req, res) => {
  try {
    const productId = Number(req.params.productId);

    const colors = await prisma.productColorGroup.findMany({
      where: { productId },
      include: {
        images: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return res.json({
      success: true,
      data: colors,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/**
 * ✅ 4. GET IMAGES BY COLOR GROUP
 * GET /api/admin/product-colors/color-images/:colorId
 */
router.get("/color-images/:colorId", async (req, res) => {
  try {
    const colorId = Number(req.params.colorId);

    if (!colorId) {
      return res.status(400).json({
        success: false,
        message: "Invalid colorId",
      });
    }

    const images = await prisma.productColorImage.findMany({
      where: { colorGroupId: colorId },
      orderBy: { sortOrder: "asc" },
    });

    return res.json({
      success: true,
      data: images,
    });
  } catch (error) {
    console.error("❌ GET COLOR IMAGES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;