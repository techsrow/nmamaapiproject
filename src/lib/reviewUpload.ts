// src/lib/reviewUpload.ts
import multer, { FileFilterCallback } from "multer";
import type { Request } from "express";

export const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WEBP images allowed"));
    }

    cb(null, true);
  },
});
