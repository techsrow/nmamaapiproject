import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { JwtUser } from "./auth";
export interface OptionalAuthRequest extends Request { user?: JwtUser }
export function optionalAuth(req: OptionalAuthRequest, _res: Response, next: NextFunction) {
  const h=req.headers.authorization;
  if(h?.startsWith("Bearer ")) { try { req.user=jwt.verify(h.slice(7), process.env.JWT_SECRET!) as JwtUser; } catch {} }
  next();
}
