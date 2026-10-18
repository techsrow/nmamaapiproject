import { ZodError } from "zod";
import { PaymentError } from "../services/payments/paymentError";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

const buckets = new Map<string,{count:number,reset:number}>();
export function apiRateLimit(limit = 180, windowMs = 60_000) {
  const maximum = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 180;
  let cleanupAt = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now >= cleanupAt) {
      for (const [key, bucket] of buckets) if (bucket.reset <= now) buckets.delete(key);
      cleanupAt = now + windowMs;
    }
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) bucket = { count: 0, reset: now + windowMs };
    bucket.count++; buckets.set(key, bucket);
    res.setHeader("X-RateLimit-Limit", maximum);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maximum - bucket.count));
    if (bucket.count > maximum) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.reset - now) / 1000)));
      return res.status(429).json({ success: false, message: "Too many requests" });
    }
    next();
  };
}
export function requireHttps(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV !== "production" || req.secure) return next();
  return res.status(426).json({ success: false, message: "HTTPS required" });
}
export function securityHeaders(_req:Request,res:Response,next:NextFunction){res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");res.setHeader("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");next();}
export async function logError(err:any,req:Request,res:Response,_next:NextFunction){
if(res.headersSent)return _next(err);
if(err instanceof PaymentError)return res.status(err.status).json({success:false,message:err.message});
if(err instanceof ZodError)return res.status(400).json({success:false,message:"Invalid request fields."});
if(err?.type==="entity.parse.failed")return res.status(400).json({success:false,message:"Invalid JSON request."});
try{await prisma.systemIncident.create({data:{level:"ERROR",source:req.path,message:String(err?.message||err),stack:process.env.NODE_ENV==="production"?undefined:err?.stack,meta:{method:req.method}}});}catch{}res.status(500).json({success:false,message:"Internal server error"});}
export const hashIp=(ip:string)=>crypto.createHash("sha256").update(ip).digest("hex");
