import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";

const router = Router();

// 🇮🇳 Indian phone regex
const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

// ===============================
// GET ALL USERS (ADMIN ONLY)
// ===============================
router.get("/", auth, async (req: any, res) => {
  if (req.user.role !== "Admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,           // ✅ added
      role: true,
      createdAt: true,
      isActive: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return res.json({
    success: true,
    data: users,
  });
});

export default router;
