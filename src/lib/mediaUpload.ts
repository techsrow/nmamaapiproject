// src/lib/mediaUpload.ts
import multer from "multer";

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});
