import type { Response, NextFunction } from "express";
import { auth, type AuthRequest } from "./auth";
import { verifyGuestOrderAccess } from "../services/payments/orderAccess";

// A supplied account token must be valid; only absent Authorization uses guest access.
export function paymentIdentity(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.get("authorization")) return auth(req, res, next);
  next();
}
export function canAccessOrder(req: AuthRequest, order: { id: number; userId: number | null }): boolean {
  if (req.user) return req.user.role === "Admin" || (order.userId !== null && order.userId === req.user.userId);
  return order.userId === null && verifyGuestOrderAccess(req.get("x-order-access-token"), order.id);
}
