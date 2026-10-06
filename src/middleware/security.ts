import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

const buckets = new Map<string,{count:number,reset:number}>();
export function apiRateLimit(limit=180, windowMs=60_000){return (req:Request,res:Response,next:NextFunction)=>{const key=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown");const now=Date.now();let b=buckets.get(key);if(!b||b.reset<now)b={count:0,reset:now+windowMs};b.count++;buckets.set(key,b);res.setHeader("X-RateLimit-Limit",String(limit));res.setHeader("X-RateLimit-Remaining",String(Math.max(0,limit-b.count)));if(b.count>limit)return res.status(429).json({success:false,message:"Too many requests"});next();};}
export function requireHttps(req:Request,res:Response,next:NextFunction){if(process.env.NODE_ENV!=="production")return next();const proto=String(req.headers["x-forwarded-proto"]||req.protocol);if(proto!=="https")return res.status(426).json({success:false,message:"HTTPS required"});next();}
export function securityHeaders(_req:Request,res:Response,next:NextFunction){res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");res.setHeader("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");next();}
export async function logError(err:any,req:Request,res:Response,_next:NextFunction){try{await prisma.systemIncident.create({data:{level:"ERROR",source:req.path,message:String(err?.message||err),stack:process.env.NODE_ENV==="production"?undefined:err?.stack,meta:{method:req.method}}});}catch{}res.status(500).json({success:false,message:"Internal server error"});}
export const hashIp=(ip:string)=>crypto.createHash("sha256").update(ip).digest("hex");
