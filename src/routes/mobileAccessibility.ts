import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
import { z } from "zod";
import axios from "axios";

const r=Router();
const admin=[auth as any,adminOnly as any];
const id=(v:any)=>Number(v);

// Public bootstrap consumed by responsive web/PWA/native Android/iOS clients.
r.get("/mobile/bootstrap",async(_req,res)=>{
  const rows=await prisma.mobileAppSetting.findMany({where:{isPublic:true}});
  const settings=Object.fromEntries(rows.map(x=>[x.key,x.value]));
  res.json({success:true,data:{apiVersion:"1",features:{pwa:true,push:true,accessibility:true},settings}});
});
r.get("/mobile/settings",...admin,async(_req,res)=>res.json({success:true,data:await prisma.mobileAppSetting.findMany({orderBy:{key:"asc"}})}));
r.put("/mobile/settings/:key",...admin,async(req,res)=>res.json({success:true,data:await prisma.mobileAppSetting.upsert({where:{key:req.params.key},create:{key:req.params.key,value:req.body.value??req.body,isPublic:req.body.isPublic!==false},update:{value:req.body.value??req.body,isPublic:req.body.isPublic!==false}})}));

// Dynamic web-app manifest. Icons/start URL/theme are configurable by admin.
r.get("/mobile/manifest.webmanifest",async(_req,res)=>{
  const row=await prisma.mobileAppSetting.findUnique({where:{key:"pwa.manifest"}});
  const m:any=row?.value||{};
  res.type("application/manifest+json").json({name:m.name||"Namama",short_name:m.short_name||"Namama",description:m.description||"Little things, thoughtfully made",start_url:m.start_url||"/",display:m.display||"standalone",background_color:m.background_color||"#FAF7F2",theme_color:m.theme_color||"#FAF7F2",icons:m.icons||[]});
});

const deviceSchema=z.object({token:z.string().min(8),platform:z.enum(["WEB","ANDROID","IOS"]),provider:z.string().default("ONESIGNAL"),anonymousId:z.string().optional(),deviceName:z.string().optional(),appVersion:z.string().optional(),locale:z.string().optional(),timezone:z.string().optional(),marketingEnabled:z.boolean().optional(),transactionalEnabled:z.boolean().optional()});
r.post("/push/devices",async(req:any,res)=>{const b=deviceSchema.parse(req.body);let userId:number|undefined;try{const h=req.headers.authorization;if(h){const jwt=require("jsonwebtoken");const p:any=jwt.verify(h.replace(/^Bearer\s+/i,""),process.env.JWT_SECRET!);userId=Number(p.userId||p.id)}}catch{}const data=await prisma.pushDevice.upsert({where:{token:b.token},create:{...b,userId},update:{...b,userId:userId??undefined,enabled:true,lastSeenAt:new Date()}});res.status(201).json({success:true,data})});
r.patch("/push/devices/:token/preferences",async(req,res)=>{const b=z.object({enabled:z.boolean().optional(),marketingEnabled:z.boolean().optional(),transactionalEnabled:z.boolean().optional()}).parse(req.body);res.json({success:true,data:await prisma.pushDevice.update({where:{token:req.params.token},data:b})})});
r.delete("/push/devices/:token",async(req,res)=>{await prisma.pushDevice.updateMany({where:{token:req.params.token},data:{enabled:false}});res.json({success:true})});
r.get("/push/devices",...admin,async(req,res)=>res.json({success:true,data:await prisma.pushDevice.findMany({where:req.query.platform?{platform:String(req.query.platform)}:{},orderBy:{lastSeenAt:"desc"},take:500})}));

const notificationSchema=z.object({title:z.string().min(1),body:z.string().min(1),imageUrl:z.string().url().optional(),deepLink:z.string().optional(),category:z.enum(["TRANSACTIONAL","MARKETING"]).default("TRANSACTIONAL"),audience:z.any().optional(),data:z.any().optional(),scheduledAt:z.coerce.date().optional()});
r.post("/push/notifications",...admin,async(req:any,res)=>{const b=notificationSchema.parse(req.body);const x=await prisma.pushNotification.create({data:{...b,createdById:req.user.userId,status:b.scheduledAt?"SCHEDULED":"DRAFT"} as any});res.status(201).json({success:true,data:x})});
r.get("/push/notifications",...admin,async(_req,res)=>res.json({success:true,data:await prisma.pushNotification.findMany({orderBy:{createdAt:"desc"},take:200})}));

async function prepareDeliveries(notificationId:number){const n=await prisma.pushNotification.findUnique({where:{id:notificationId}});if(!n)throw new Error("Notification not found");const a:any=n.audience||{};const where:any={enabled:true};if(a.platform)where.platform=a.platform;if(n.category==="MARKETING")where.marketingEnabled=true;else where.transactionalEnabled=true;if(Array.isArray(a.userIds))where.userId={in:a.userIds.map(Number)};const devices=await prisma.pushDevice.findMany({where});await prisma.$transaction(devices.map(d=>prisma.pushNotificationDelivery.upsert({where:{notificationId_deviceId:{notificationId:n.id,deviceId:d.id}},create:{notificationId:n.id,deviceId:d.id},update:{}})));return {n,devices};}

// OneSignal adapter works for Web Push + Android + iOS. Other providers remain queue-compatible.
r.post("/push/notifications/:id/send",...admin,async(req,res)=>{try{const {n,devices}=await prepareDeliveries(id(req.params.id));if(!devices.length)return res.status(400).json({success:false,message:"No eligible push devices"});const cfg=await prisma.integrationConnection.findFirst({where:{provider:{equals:"ONESIGNAL",mode:"insensitive"},isEnabled:true}});const secrets:any=cfg?.secrets||{};const config:any=cfg?.config||{};if(!secrets.apiKey||!config.appId){await prisma.pushNotification.update({where:{id:n.id},data:{status:"QUEUED"}});return res.status(202).json({success:true,queued:true,devices:devices.length,message:"Push queued. Configure enabled ONESIGNAL integration with config.appId and secrets.apiKey to deliver."});}const response=await axios.post("https://api.onesignal.com/notifications",{app_id:config.appId,include_subscription_ids:devices.map(d=>d.token),headings:{en:n.title},contents:{en:n.body},big_picture:n.imageUrl,ios_attachments:n.imageUrl?{image:n.imageUrl}:undefined,url:n.deepLink,data:n.data||{}},{headers:{Authorization:`Key ${secrets.apiKey}`,"Content-Type":"application/json"}});await prisma.$transaction([prisma.pushNotification.update({where:{id:n.id},data:{status:"SENT",sentAt:new Date()}}),prisma.pushNotificationDelivery.updateMany({where:{notificationId:n.id,status:"PENDING"},data:{status:"SENT",providerMessageId:String(response.data?.id||""),sentAt:new Date()}})]);res.json({success:true,devices:devices.length,provider:response.data});}catch(e:any){res.status(502).json({success:false,message:e.message})}});

// Accessibility content audit: catches missing image alternatives and basic product-content problems.
r.post("/accessibility/audit/products",...admin,async(_req,res)=>{await prisma.accessibilityIssue.deleteMany({where:{entityType:{in:["PRODUCT","PRODUCT_IMAGE","PRODUCT_MEDIA"]},resolved:false}});const products=await prisma.product.findMany({where:{isActive:true},include:{images:true,media:true}});const issues:any[]=[];for(const p of products){if(!p.name?.trim())issues.push({entityType:"PRODUCT",entityId:String(p.id),field:"name",severity:"ERROR",code:"MISSING_ACCESSIBLE_NAME",message:"Product requires a readable name."});if(!p.description?.trim())issues.push({entityType:"PRODUCT",entityId:String(p.id),field:"description",code:"MISSING_DESCRIPTION",message:"Product should include useful text content, not image-only information."});for(const im of p.images)if(!im.altText?.trim())issues.push({entityType:"PRODUCT_IMAGE",entityId:String(im.id),field:"altText",severity:"ERROR",code:"MISSING_ALT",message:`Image on ${p.name} requires meaningful alt text.`});for(const m of p.media)if(m.type==="IMAGE"&&!m.altText?.trim())issues.push({entityType:"PRODUCT_MEDIA",entityId:String(m.id),field:"altText",severity:"ERROR",code:"MISSING_ALT",message:`Product media on ${p.name} requires meaningful alt text.`});}if(issues.length)await prisma.accessibilityIssue.createMany({data:issues});res.json({success:true,data:{productsScanned:products.length,issues:issues.length,errors:issues.filter(x=>x.severity==="ERROR").length,warnings:issues.filter(x=>x.severity!=="ERROR").length}})});
r.get("/accessibility/issues",...admin,async(req,res)=>res.json({success:true,data:await prisma.accessibilityIssue.findMany({where:{...(req.query.resolved!==undefined?{resolved:String(req.query.resolved)==="true"}:{}),...(req.query.severity?{severity:String(req.query.severity)}:{})},orderBy:[{resolved:"asc"},{createdAt:"desc"}]})}));
r.patch("/accessibility/issues/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.accessibilityIssue.update({where:{id:id(req.params.id)},data:{resolved:!!req.body.resolved}})}));

export default r;
