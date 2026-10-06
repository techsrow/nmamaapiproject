import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

export type JwtUser = {
  userId: number;
  email: string;
  role: string;
};

export interface AuthRequest extends Request {
  user?: JwtUser;
}

export const auth = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Missing token" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Invalid token format" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtUser;
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
};
