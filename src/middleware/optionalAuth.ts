import { Request, Response, NextFunction } from "express";
import { auth, JwtUser } from "./auth";
export interface OptionalAuthRequest extends Request { user?: JwtUser }
export function optionalAuth(req: OptionalAuthRequest, res: Response, next: NextFunction) {
  if (req.headers.authorization !== undefined) return auth(req, res, next);
  return next();
}
