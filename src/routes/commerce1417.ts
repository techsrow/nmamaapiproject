import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
import { z } from "zod";
import crypto from "crypto";

const r = Router();
const admin = [auth as any, adminOnly as any];
const n=(v:any)=>Number(v||0);
const slug=(s:string)=>s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

// ---------- 14 REVIEWS & TRUST ----------
r.get("/trust/reviews/product/:productId", async(req,res)=>{
  const productId=n(req.params.productId);
  const rows=await prisma.review.findMany({where:{productId,status:"Approved",isActive:true},include:{user:{select:{id:true,firstName:true,lastName:true}},images:true},orderBy:{createdAt:"desc"}});
  const verifiedIds=new Set((await prisma.order.findMany({where:{userId:{not:null},orderItems:{some:{productId}}},select:{userId:true}})).map((x:any)=>x.userId));
  const media=await prisma.reviewMediaV2.findMany({where:{reviewId:{in:rows.map(x=>x.id)}},orderBy:{sortOrder:"asc"}});
  res.json({success:true,data:rows.map(x=>({...x,verifiedPurchase:x.userId?verifiedIds.has(x.userId):false,media:media.filter(m=>m.reviewId===x.id)}))});
});
r.post("/trust/reviews/:id/media",auth,async(req:any,res)=>{
  const id=n(req.params.id); const review=await prisma.review.findUnique({where:{id}}); if(!review||review.userId!==req.user.userId)return res.status(403).json({success:false,message:"Not allowed"});
  const b=z.object({type:z.enum(["IMAGE","VIDEO"]),url:z.string().url(),thumbnailUrl:z.string().url().optional(),altText:z.string().optional()}).parse(req.body);
  res.json({success:true,data:await prisma.reviewMediaV2.create({data:{reviewId:id,...b}})});
});
r.patch("/trust/reviews/:id/moderate",...admin,async(req,res)=>{const b=z.object({status:z.enum(["Pending","Approved","Rejected"]),isActive:z.boolean().optional()}).parse(req.body);res.json({success:true,data:await prisma.review.update({where:{id:n(req.params.id)},data:b as any})});});
r.get("/trust/testimonials",async(_q,res)=>res.json({success:true,data:await prisma.testimonial.findMany({where:{isActive:true},orderBy:[{sortOrder:"asc"},{createdAt:"desc"}]})}));
r.post("/trust/testimonials",...admin,async(req,res)=>res.json({success:true,data:await prisma.testimonial.create({data:req.body})}));
r.patch("/trust/testimonials/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.testimonial.update({where:{id:n(req.params.id)},data:req.body})}));
r.delete("/trust/testimonials/:id",...admin,async(req,res)=>{await prisma.testimonial.delete({where:{id:n(req.params.id)}});res.json({success:true})});
r.get("/trust/badges",async(req,res)=>res.json({success:true,data:await prisma.trustBadge.findMany({where:{isActive:true,...(req.query.placement?{placement:String(req.query.placement)}:{})},orderBy:{sortOrder:"asc"}})}));
r.post("/trust/badges",...admin,async(req,res)=>res.json({success:true,data:await prisma.trustBadge.create({data:req.body})}));
r.patch("/trust/badges/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.trustBadge.update({where:{id:n(req.params.id)},data:req.body})}));
r.get("/trust/faqs",async(req,res)=>res.json({success:true,data:await prisma.faq.findMany({where:{isActive:true,...(req.query.category?{category:String(req.query.category)}:{})},orderBy:{position:"asc"}})}));
r.post("/trust/faqs",...admin,async(req,res)=>res.json({success:true,data:await prisma.faq.create({data:req.body})}));
r.patch("/trust/faqs/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.faq.update({where:{id:n(req.params.id)},data:req.body})}));
r.delete("/trust/faqs/:id",...admin,async(req,res)=>{await prisma.faq.delete({where:{id:n(req.params.id)}});res.json({success:true})});

// ---------- 15 MARKETING & RETENTION ----------
r.post("/marketing/segments",...admin,async(req,res)=>res.json({success:true,data:await prisma.customerSegment.create({data:req.body})}));
r.get("/marketing/segments",...admin,async(_q,res)=>res.json({success:true,data:await prisma.customerSegment.findMany({orderBy:{createdAt:"desc"}})}));
r.post("/marketing/campaigns",...admin,async(req,res)=>res.json({success:true,data:await prisma.marketingCampaign.create({data:req.body})}));
r.get("/marketing/campaigns",...admin,async(_q,res)=>res.json({success:true,data:await prisma.marketingCampaign.findMany({orderBy:{createdAt:"desc"}})}));
r.post("/marketing/campaigns/:id/queue",...admin,async(req,res)=>{
  const c=await prisma.marketingCampaign.findUnique({where:{id:n(req.params.id)}}); if(!c)return res.status(404).json({success:false,message:"Campaign not found"});
  const users=await prisma.user.findMany({where:{isActive:true},select:{id:true,email:true,phone:true}}); const destinations=users.map(u=>({campaignId:c.id,userId:u.id,destination:c.channel==="EMAIL"?u.email:(u.phone||"")})).filter(x=>x.destination);
  await prisma.$transaction(destinations.map(x=>prisma.campaignDelivery.create({data:x}))); await prisma.marketingCampaign.update({where:{id:c.id},data:{status:"SENDING"}}); res.json({success:true,queued:destinations.length});
});
r.get("/marketing/abandoned-carts",...admin,async(_q,res)=>res.json({success:true,data:await prisma.abandonedCart.findMany({where:{status:"ABANDONED"},orderBy:{abandonedAt:"desc"}})}));
r.post("/marketing/abandoned-carts/:id/reminded",...admin,async(req,res)=>res.json({success:true,data:await prisma.abandonedCart.update({where:{id:n(req.params.id)},data:{reminderCount:{increment:1},lastReminderAt:new Date()}})}));
r.get("/marketing/recommendations/:productId",async(req,res)=>{const id=n(req.params.productId);const rel=await prisma.relatedProduct.findMany({where:{productId:id},include:{relatedProduct:true}});if(rel.length)return res.json({success:true,data:rel.map(x=>x.relatedProduct)});const p=await prisma.product.findUnique({where:{id}});res.json({success:true,data:await prisma.product.findMany({where:{isActive:true,id:{not:id},categoryId:p?.categoryId||undefined},take:8,include:{variants:true,images:true}})});});
r.get("/marketing/upsells/:productId",async(req,res)=>{const p=await prisma.product.findUnique({where:{id:n(req.params.productId)},include:{variants:true}});const base=Math.max(...(p?.variants||[]).map(v=>Number(v.price)),0);res.json({success:true,data:await prisma.product.findMany({where:{isActive:true,id:{not:p?.id},variants:{some:{price:{gt:base}}}},take:6,include:{variants:true,images:true}})});});
r.get("/marketing/cross-sells/:productId",async(req,res)=>{const rel=await prisma.relatedProduct.findMany({where:{productId:n(req.params.productId)},include:{relatedProduct:{include:{variants:true,images:true}}},take:6});res.json({success:true,data:rel.map(x=>x.relatedProduct)});});
r.get("/marketing/loyalty",auth,async(req:any,res)=>res.json({success:true,data:await prisma.loyaltyAccount.upsert({where:{userId:req.user.userId},create:{userId:req.user.userId},update:{}})}));
r.post("/marketing/loyalty/adjust",...admin,async(req,res)=>{const b=z.object({userId:z.number(),points:z.number().int(),note:z.string().optional()}).parse(req.body);const data=await prisma.$transaction(async tx=>{await tx.loyaltyTransaction.create({data:{userId:b.userId,points:b.points,type:"ADJUST",note:b.note}});return tx.loyaltyAccount.upsert({where:{userId:b.userId},create:{userId:b.userId,points:Math.max(0,b.points),lifetimeEarned:Math.max(0,b.points)},update:{points:{increment:b.points},...(b.points>0?{lifetimeEarned:{increment:b.points}}:{lifetimeRedeemed:{increment:-b.points}})}})});res.json({success:true,data})});
r.post("/marketing/referrals/code",auth,async(req:any,res)=>{const existing=await prisma.referralCode.findFirst({where:{userId:req.user.userId,isActive:true}});if(existing)return res.json({success:true,data:existing});const code=`NM${req.user.userId}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;res.json({success:true,data:await prisma.referralCode.create({data:{userId:req.user.userId,code,rewardValue:100}})})});
r.post("/marketing/referrals/:code/track",async(req,res)=>{const c=await prisma.referralCode.findUnique({where:{code:req.params.code}});if(!c)return res.status(404).json({success:false});res.json({success:true,data:await prisma.referralEvent.create({data:{referralCodeId:c.id,status:"CLICKED"}})})});
r.post("/marketing/affiliates",...admin,async(req,res)=>res.json({success:true,data:await prisma.affiliate.create({data:req.body})}));
r.post("/marketing/affiliates/:code/track",async(req,res)=>{const a=await prisma.affiliate.findUnique({where:{code:req.params.code}});if(!a)return res.status(404).json({success:false});res.json({success:true,data:await prisma.affiliateEvent.create({data:{affiliateId:a.id,type:String(req.body.type||"CLICK"),sessionId:req.body.sessionId,orderId:req.body.orderId,amount:req.body.amount,commission:req.body.commission}})})});

// ---------- 16 SEO ----------
r.get("/seo/meta/:entityType/:entityId",async(req,res)=>res.json({success:true,data:await prisma.seoMeta.findUnique({where:{entityType_entityId:{entityType:req.params.entityType,entityId:req.params.entityId}}})}));
r.put("/seo/meta/:entityType/:entityId",...admin,async(req,res)=>res.json({success:true,data:await prisma.seoMeta.upsert({where:{entityType_entityId:{entityType:req.params.entityType,entityId:req.params.entityId}},create:{entityType:req.params.entityType,entityId:req.params.entityId,...req.body},update:req.body})}));
r.get("/seo/product/:slug/schema",async(req,res)=>{const p=await prisma.product.findUnique({where:{slug:req.params.slug},include:{variants:true,images:true,reviews:{where:{status:"Approved",isActive:true}}}});if(!p)return res.status(404).json({success:false});const prices=p.variants.map(v=>Number(v.discountPrice||v.price));res.json({"@context":"https://schema.org","@type":"Product",name:p.name,description:p.description,image:p.images.map(i=>i.url),sku:p.variants[0]?.sku,offers:{"@type":"AggregateOffer",priceCurrency:"INR",lowPrice:Math.min(...prices),highPrice:Math.max(...prices),offerCount:p.variants.length},aggregateRating:p.reviews.length?{"@type":"AggregateRating",ratingValue:p.reviews.reduce((a,b)=>a+b.rating,0)/p.reviews.length,reviewCount:p.reviews.length}:undefined})});
r.get("/seo/sitemap.xml",async(_q,res)=>{const base=process.env.STOREFRONT_URL||"https://example.com";const [ps,bs,pages]=await Promise.all([prisma.product.findMany({where:{isActive:true},select:{slug:true,updatedAt:true}}),prisma.blogPost.findMany({where:{status:"PUBLISHED"},select:{slug:true,updatedAt:true}}),prisma.cmsPage.findMany({where:{isPublished:true},select:{slug:true,updatedAt:true}})]);const urls=[...ps.map(x=>[`/products/${x.slug}`,x.updatedAt]),...bs.map(x=>[`/blogs/${x.slug}`,x.updatedAt]),...pages.map(x=>[`/${x.slug}`,x.updatedAt])];res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(([u,d])=>`<url><loc>${base}${u}</loc><lastmod>${new Date(d as any).toISOString()}</lastmod></url>`).join("")}</urlset>`)});
r.get("/seo/robots.txt",(_q,res)=>res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${(process.env.API_PUBLIC_URL||"https://example.com")}/api/content/seo/sitemap.xml\n`));
r.get("/seo/redirect",async(req,res)=>{const x=await prisma.seoRedirect.findUnique({where:{fromPath:String(req.query.path||"")}});res.json({success:true,data:x?.isActive?x:null})});
r.post("/seo/redirects",...admin,async(req,res)=>res.json({success:true,data:await prisma.seoRedirect.create({data:req.body})}));
r.get("/seo/audit",...admin,async(_q,res)=>{const products=await prisma.product.findMany({where:{isActive:true},include:{images:true}});const issues:any[]=[];for(const p of products){if(!p.metaTitle)issues.push({productId:p.id,type:"MISSING_META_TITLE"});if(!p.metaDescription)issues.push({productId:p.id,type:"MISSING_META_DESCRIPTION"});if(!p.canonicalUrl)issues.push({productId:p.id,type:"MISSING_CANONICAL"});for(const i of p.images)if(!i.altText)issues.push({productId:p.id,imageId:i.id,type:"MISSING_IMAGE_ALT"});}res.json({success:true,score:Math.max(0,100-Math.min(100,issues.length)),issues})});

// ---------- 17 CONTENT MANAGEMENT ----------
r.get("/cms/pages/:slug",async(req,res)=>{const p=await prisma.cmsPage.findUnique({where:{slug:req.params.slug}});if(!p||!p.isPublished)return res.status(404).json({success:false});res.json({success:true,data:p})});
r.get("/cms/pages",...admin,async(_q,res)=>res.json({success:true,data:await prisma.cmsPage.findMany({orderBy:{updatedAt:"desc"}})}));
r.post("/cms/pages",...admin,async(req,res)=>{const b=req.body;res.json({success:true,data:await prisma.cmsPage.create({data:{title:b.title,slug:b.slug||slug(b.title),content:b.content||{},metaTitle:b.metaTitle,metaDescription:b.metaDescription,isPublished:!!b.isPublished}})})});
r.patch("/cms/pages/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.cmsPage.update({where:{id:n(req.params.id)},data:req.body})}));
r.delete("/cms/pages/:id",...admin,async(req,res)=>{await prisma.cmsPage.delete({where:{id:n(req.params.id)}});res.json({success:true})});
r.get("/cms/blogs",async(_q,res)=>res.json({success:true,data:await prisma.blogPost.findMany({where:{status:"PUBLISHED"},orderBy:{publishedAt:"desc"}})}));
r.get("/cms/blogs/:slug",async(req,res)=>{const x=await prisma.blogPost.findUnique({where:{slug:req.params.slug}});if(!x||x.status!=="PUBLISHED")return res.status(404).json({success:false});res.json({success:true,data:x})});
r.post("/cms/blogs",...admin,async(req,res)=>{const b=req.body;res.json({success:true,data:await prisma.blogPost.create({data:{...b,slug:b.slug||slug(b.title),publishedAt:b.status==="PUBLISHED"?(b.publishedAt?new Date(b.publishedAt):new Date()):null}})})});
r.patch("/cms/blogs/:id",...admin,async(req,res)=>res.json({success:true,data:await prisma.blogPost.update({where:{id:n(req.params.id)},data:req.body})}));
r.delete("/cms/blogs/:id",...admin,async(req,res)=>{await prisma.blogPost.delete({where:{id:n(req.params.id)}});res.json({success:true})});
r.get("/cms/media",...admin,async(_q,res)=>res.json({success:true,data:await prisma.mediaAsset.findMany({orderBy:{createdAt:"desc"}})}));
r.get("/cms/templates",...admin,async(_q,res)=>res.json({success:true,data:await prisma.pageTemplate.findMany({orderBy:{createdAt:"desc"}})}));
r.post("/cms/templates",...admin,async(req,res)=>res.json({success:true,data:await prisma.pageTemplate.create({data:req.body})}));

export default r;
