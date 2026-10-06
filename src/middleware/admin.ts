import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "Admin") return res.status(403).json({ success:false, message:"Admin access required" });
  next();
}
