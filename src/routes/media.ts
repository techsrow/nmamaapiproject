// src/routes/media.ts
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { z } from "zod";
import { cloudinary } from "../lib/cloudinary";
import { mediaUpload } from "../lib/mediaUpload";
import { MediaType } from "@prisma/client";

const router = Router();

/**
 * Helper: detect type & cloudinary resource_type
 */
function detectType(mime: string) {
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isPdf = mime === "application/pdf";

  const resourceType: "image" | "video" | "raw" = isVideo ? "video" : isPdf ? "raw" : "image";
  const type: MediaType =
    isImage ? MediaType.IMAGE : isVideo ? MediaType.VIDEO : isPdf ? MediaType.PDF : MediaType.OTHER;

  return { type, resourceType };
}

/**
 * Helper: upload buffer to cloudinary
 */
async function uploadToCloudinary(params: {
  buffer: Buffer;
  folder: string;
  resourceType: "image" | "video" | "raw";
  originalName?: string;
}) {
  const { buffer, folder, resourceType, originalName } = params;

  return await new Promise<any>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: originalName ? originalName.replace(/\.[^/.]+$/, "") : undefined,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    stream.end(buffer);
  });
}

/**
 * POST /api/media/upload
 * form-data:
 *  - file: single
 *  - folder?: string
 */
router.post("/upload", auth, mediaUpload.single("file"), async (req: any, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "file is required" });

    const folder = String(req.body.folder || process.env.CLOUDINARY_FOLDER || "ecommerce");

    const mime = req.file.mimetype;
    const { type, resourceType } = detectType(mime);

    const uploaded = await uploadToCloudinary({
      buffer: req.file.buffer,
      folder,
      resourceType,
      originalName: req.file.originalname,
    });

    const created = await prisma.mediaAsset.create({
      data: {
        publicId: uploaded.public_id,
        url: uploaded.url,
        secureUrl: uploaded.secure_url ?? null,
        type,
        format: uploaded.format ?? null,
        bytes: uploaded.bytes ?? null,
        width: uploaded.width ?? null,
        height: uploaded.height ?? null,
        folder,
        originalName: req.file.originalname,
        uploadedByUserId: req.user?.userId ?? null,
      },
      include: {
        uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return res.json({ success: true, data: created });
  } catch (e: any) {
    console.error("MEDIA UPLOAD ERROR:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /api/media
 * query:
 *  - type?: IMAGE|PDF|VIDEO|OTHER
 *  - folder?: string
 *  - q?: string
 *  - page?: number
 *  - limit?: number
 */
router.get("/", auth, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      type: z.nativeEnum(MediaType).optional(),
      folder: z.string().optional(),
      q: z.string().optional(),
      page: z.coerce.number().min(1).default(1),
      limit: z.coerce.number().min(1).max(100).default(24),
    });

    const { type, folder, q, page, limit } = schema.parse(req.query);

    const where: any = {};
    if (type) where.type = type;
    if (folder) where.folder = folder;

    if (q) {
      where.OR = [
        { originalName: { contains: q, mode: "insensitive" } },
        { publicId: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.mediaAsset.count({ where }),
      prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          uploadedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
    ]);

    return res.json({
      success: true,
      data: items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * GET /api/media/folders
 */
router.get("/folders", auth, async (_req, res: Response) => {
  const rows = await prisma.mediaAsset.findMany({
    select: { folder: true },
    distinct: ["folder"],
    orderBy: { folder: "asc" },
  });

  return res.json({
    success: true,
    data: rows.map((r) => r.folder).filter(Boolean),
  });
});

/**
 * PATCH /api/media/:id  (Admin only)
 * body: { folder?: string, originalName?: string }
 */
router.patch("/:id", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);

    const schema = z.object({
      folder: z.string().optional(),
      originalName: z.string().optional(),
    });

    const body = schema.parse(req.body);

    const updated = await prisma.mediaAsset.update({
      where: { id },
      data: {
        folder: body.folder,
        originalName: body.originalName,
      },
    });

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

/**
 * DELETE /api/media/:id (Admin only)
 * Deletes from cloudinary + DB
 */
router.delete("/:id", auth, async (req: any, res: Response) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const id = Number(req.params.id);

    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) return res.status(404).json({ success: false, message: "Media not found" });

    const resourceType =
      asset.type === MediaType.VIDEO ? "video" : asset.type === MediaType.PDF ? "raw" : "image";

    await cloudinary.uploader.destroy(asset.publicId, { resource_type: resourceType });

    await prisma.mediaAsset.delete({ where: { id } });

    return res.json({ success: true, message: "Deleted" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

export default router;
