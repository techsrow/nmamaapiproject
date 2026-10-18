import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

export type JwtUser = {
  userId: number;
  tokenVersion?: number;
  email: string;
  role: string;
};

export interface AuthRequest extends Request {
  user?: JwtUser;
}

export const auth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Invalid token format" });
  }

  let decoded: JwtUser;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as JwtUser;
    if (!decoded || !Number.isSafeInteger(decoded.userId) || decoded.userId < 1) throw new Error("Invalid subject");
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
  try {
    const account = await prisma.user.findUnique({
      where: { id: decoded.userId }, select: { email: true, role: true, isActive: true, tokenVersion: true },
    });
    if (!account?.isActive) return res.status(401).json({ success: false, message: "Account is unavailable" });
    if ((decoded.tokenVersion ?? 0) !== (account.tokenVersion ?? 0)) return res.status(401).json({ success: false, message: "Session expired. Please sign in again." });
    req.user = { userId: decoded.userId, email: account.email, role: account.role };
  } catch {
    return res.status(503).json({ success: false, message: "Authentication is temporarily unavailable" });
  }
  return next();
};
