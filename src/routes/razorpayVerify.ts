// src/routes/razorpayVerify.ts
import { Router, Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";

const router = Router();

const VerifySchema = z.object({
  razorpay_order_id: z.string().min(5),
  razorpay_payment_id: z.string().min(5),
  razorpay_signature: z.string().min(5),
});

const keySecret = process.env.RAZORPAY_KEY_SECRET;

function ensureConfigured(res: Response) {
  if (!keySecret) {
    res.status(500).json({
      success: false,
      message: "Razorpay is not configured. Set RAZORPAY_KEY_SECRET in .env",
    });
    return false;
  }
  return true;
}


export default router;
