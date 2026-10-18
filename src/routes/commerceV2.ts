import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
const db:any = prisma;
const router=Router();
const ok=(res:Response,data:any,status=200)=>res.status(status).json({success:true,data});
const fail=(res:Response,e:any)=>{console.error(e); return res.status(500).json({success:false,message:e?.message||"Request failed"});};

// Shopify-like product options + arbitrary variant combinations.
router.put("/admin/products/:id/options",auth,adminOnly,async(req:AuthRequest,res)=>{try{
 const productId=Number(req.params.id); const body=z.object({options:z.array(z.object({name:z.string().min(1),values:z.array(z.string().min(1)).min(1)})).max(3)}).parse(req.body);
 await db.$transaction(async(tx:any)=>{await tx.productOption.deleteMany({where:{productId}}); for(let i=0;i<body.options.length;i++) await tx.productOption.create({data:{productId,name:body.options[i].name,values:body.options[i].values,position:i}});});
 return ok(res,await db.productOption.findMany({where:{productId},orderBy:{position:"asc"}}));
}catch(e){return fail(res,e)}});
router.post("/admin/products/:id/variants",auth,adminOnly,async(req:AuthRequest,res)=>{try{
 const productId=Number(req.params.id); const b=z.object({sku:z.string().min(1),price:z.number().nonnegative(),compareAtPrice:z.number().nonnegative().nullable().optional(),discountPrice:z.number().nonnegative().nullable().optional(),stockQuantity:z.number().int().nonnegative().default(0),optionValues:z.record(z.string(),z.string()),barcode:z.string().nullable().optional(),trackInventory:z.boolean().default(true),allowBackorder:z.boolean().default(false),preorderEnabled:z.boolean().default(false),images:z.array(z.object({url:z.string().url(),altText:z.string().nullable().optional()})).default([])}).parse(req.body);
 const values=Object.values(b.optionValues); const size=b.optionValues.Size||b.optionValues.size||null, color=b.optionValues.Color||b.optionValues.color||null;
 const v=await db.productVariant.create({data:{productId,sku:b.sku,price:b.price,discountPrice:b.discountPrice??null,compareAtPrice:b.compareAtPrice??null,stockQuantity:b.stockQuantity,optionValues:b.optionValues,size,color,barcode:b.barcode??null,trackInventory:b.trackInventory,allowBackorder:b.allowBackorder,preorderEnabled:b.preorderEnabled,images:{create:b.images}} ,include:{images:true}}); return ok(res,v,201);
}catch(e){return fail(res,e)}});
router.patch("/admin/variants/:id",auth,adminOnly,async(req,res)=>{try{return ok(res,await db.productVariant.update({where:{id:Number(req.params.id)},data:req.body}));}catch(e){return fail(res,e)}});

// Collections / seasonal merchandising
router.get("/collections",async(_req,res)=>{try{return ok(res,await db.collection.findMany({where:{isActive:true},include:{products:{include:{product:true}}},orderBy:{updatedAt:"desc"}}));}catch(e){return fail(res,e)}});
router.post("/admin/collections",auth,adminOnly,async(req,res)=>{try{return ok(res,await db.collection.create({data:req.body}),201)}catch(e){return fail(res,e)}});
router.patch("/admin/collections/:id",auth,adminOnly,async(req,res)=>{try{return ok(res,await db.collection.update({where:{id:Number(req.params.id)},data:req.body}))}catch(e){return fail(res,e)}});
router.put("/admin/collections/:id/products",auth,adminOnly,async(req,res)=>{try{const id=Number(req.params.id), ids=z.array(z.number().int().positive()).parse(req.body.productIds); await db.$transaction([db.collectionProduct.deleteMany({where:{collectionId:id}}),...ids.map((productId:number,position:number)=>db.collectionProduct.create({data:{collectionId:id,productId,position}}))]); return ok(res,{productIds:ids});}catch(e){return fail(res,e)}});

// Search/autocomplete/suggestions + filters
router.get("/search",async(req,res)=>{try{const q=String(req.query.q||"").trim(), take=Math.min(Number(req.query.limit)||12,50); if(!q)return ok(res,[]); const data=await db.product.findMany({where:{isActive:true,OR:[{name:{contains:q,mode:"insensitive"}},{description:{contains:q,mode:"insensitive"}},{variants:{some:{sku:{contains:q,mode:"insensitive"}}}}]},take,include:{images:{take:1,orderBy:{sortOrder:"asc"}},variants:{where:{isActive:true},orderBy:{price:"asc"},take:1}}}); return ok(res,data);}catch(e){return fail(res,e)}});
router.get("/search/suggestions",async(req,res)=>{try{const q=String(req.query.q||"").trim(); const p=await db.product.findMany({where:{isActive:true,name:{contains:q,mode:"insensitive"}},select:{name:true,slug:true},take:8}); return ok(res,p)}catch(e){return fail(res,e)}});
router.post("/me/searches",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.searchHistory.create({data:{userId:req.user!.userId,query:String(req.body.query||"").slice(0,200)}}),201)}catch(e){return fail(res,e)}});
router.get("/me/searches",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.searchHistory.findMany({where:{userId:req.user!.userId},orderBy:{searchedAt:"desc"},take:20}))}catch(e){return fail(res,e)}});

// Customer address book + recently viewed
router.get("/me/addresses",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.customerAddress.findMany({where:{userId:req.user!.userId},orderBy:{isDefault:"desc"}}))}catch(e){return fail(res,e)}});
router.post("/me/addresses",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.customerAddress.create({data:{...req.body,userId:req.user!.userId}}),201)}catch(e){return fail(res,e)}});
router.delete("/me/addresses/:id",auth,async(req:AuthRequest,res)=>{try{await db.customerAddress.deleteMany({where:{id:Number(req.params.id),userId:req.user!.userId}}); return ok(res,{deleted:true})}catch(e){return fail(res,e)}});
router.post("/me/recently-viewed/:productId",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.recentlyViewed.upsert({where:{userId_productId:{userId:req.user!.userId,productId:Number(req.params.productId)}},update:{viewedAt:new Date()},create:{userId:req.user!.userId,productId:Number(req.params.productId)}}))}catch(e){return fail(res,e)}});
router.get("/me/recently-viewed",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.recentlyViewed.findMany({where:{userId:req.user!.userId},include:{product:{include:{images:{take:1},variants:{where:{isActive:true},take:1}}}},orderBy:{viewedAt:"desc"},take:24}))}catch(e){return fail(res,e)}});

// Returns/exchanges
router.post("/returns",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.returnRequest.create({data:{...req.body,userId:req.user!.userId}}),201)}catch(e){return fail(res,e)}});
router.get("/returns",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.returnRequest.findMany({where:req.user!.role==="Admin"?{}:{userId:req.user!.userId},orderBy:{createdAt:"desc"}}))}catch(e){return fail(res,e)}});
router.patch("/admin/returns/:id",auth,adminOnly,async(req,res)=>{try{return ok(res,await db.returnRequest.update({where:{id:Number(req.params.id)},data:req.body}))}catch(e){return fail(res,e)}});

// Promotions, CMS, FAQ, redirects, shipping/tax/settings
for(const [path,model] of [["promotions","promotion"],["pages","cmsPage"],["faqs","faq"],["redirects","seoRedirect"],["shipping-zones","shippingZone"],["tax-rules","taxRule"],["warehouses","warehouse"],["suppliers","supplier"],["purchase-orders","purchaseOrder"]] as const){
 router.get(`/admin/${path}`,auth,adminOnly,async(_req,res)=>{try{return ok(res,await db[model].findMany())}catch(e){return fail(res,e)}});
 router.post(`/admin/${path}`,auth,adminOnly,async(req,res)=>{try{return ok(res,await db[model].create({data:req.body}),201)}catch(e){return fail(res,e)}});
 router.patch(`/admin/${path}/:id`,auth,adminOnly,async(req,res)=>{try{return ok(res,await db[model].update({where:{id:Number(req.params.id)},data:req.body}))}catch(e){return fail(res,e)}});
}
router.get("/pages/:slug",async(req,res)=>{try{const p=await db.cmsPage.findFirst({where:{slug:req.params.slug,isPublished:true}}); if(!p)return res.status(404).json({success:false,message:"Page not found"}); return ok(res,p)}catch(e){return fail(res,e)}});
router.get("/faqs",async(_req,res)=>{try{return ok(res,await db.faq.findMany({where:{isActive:true},orderBy:{position:"asc"}}))}catch(e){return fail(res,e)}});

// Support tickets
router.post("/support/tickets",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.supportTicket.create({data:{...req.body,userId:req.user!.userId}}),201)}catch(e){return fail(res,e)}});
router.get("/support/tickets",auth,async(req:AuthRequest,res)=>{try{return ok(res,await db.supportTicket.findMany({where:req.user!.role==="Admin"?{}:{userId:req.user!.userId},orderBy:{updatedAt:"desc"}}))}catch(e){return fail(res,e)}});

// Store settings power integrations, tracking/ads, localization, consent, notifications.
router.get("/settings/public",async(_req,res)=>{try{const rows=await db.storeSetting.findMany({where:{key:{in:["store","localization","tracking","consent","checkout","shipping"]}}}); return ok(res,Object.fromEntries(rows.map((x:any)=>[x.key,x.value])))}catch(e){return fail(res,e)}});
router.put("/admin/settings/:key",auth,adminOnly,async(req,res)=>{try{if(/^(checkout-order:|checkout-lifecycle:|payment-stock:|inventory-receive:|pos-draft:|shadowfax-sync|shadowfax-booking:)/.test(String(req.params.key)))return res.status(400).json({success:false,message:"Reserved internal setting key"});return ok(res,await db.storeSetting.upsert({where:{key:req.params.key},update:{value:req.body},create:{key:req.params.key,value:req.body}}))}catch(e){return fail(res,e)}});

export default router;
