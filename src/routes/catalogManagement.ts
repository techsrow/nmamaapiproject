import { Router, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
import { slugify } from "../utils/slugify";

const router = Router();
const db: any = prisma;
const ok=(res:Response,data:any,status=200)=>res.status(status).json({success:true,data});
const fail=(res:Response,e:any,status=400)=>res.status(status).json({success:false,message:e?.message||"Request failed"});

async function uniqueSlug(model:any, value:string, excludeId?:number){
 const base=slugify(value)||`item-${Date.now()}`; let candidate=base, n=2;
 while(true){ const row=await model.findUnique({where:{slug:candidate},select:{id:true}}); if(!row || row.id===excludeId) return candidate; candidate=`${base}-${n++}`; }
}

// ---------- BRANDS ----------
router.get('/brands', async(req,res)=>{try{const includeInactive=req.query.all==='1'; return ok(res,await db.brand.findMany({where:includeInactive?{}:{isActive:true},orderBy:{name:'asc'},include:{_count:{select:{products:true}}}}));}catch(e){return fail(res,e,500)}});
router.get('/brands/:slug', async(req,res)=>{try{const row=await db.brand.findUnique({where:{slug:String(req.params.slug)},include:{products:{where:{isActive:true},take:24,include:{images:{take:1},variants:{where:{isActive:true}}}}}}); if(!row||!row.isActive)return fail(res,new Error('Brand not found'),404); return ok(res,row);}catch(e){return fail(res,e,500)}});
router.post('/admin/brands',auth,adminOnly,async(req,res)=>{try{const b=z.object({name:z.string().min(1),slug:z.string().optional(),description:z.string().nullable().optional(),imageUrl:z.string().nullable().optional(),isActive:z.boolean().default(true)}).parse(req.body); return ok(res,await db.brand.create({data:{...b,slug:await uniqueSlug(db.brand,b.slug||b.name)}}),201);}catch(e){return fail(res,e)}});
router.patch('/admin/brands/:id',auth,adminOnly,async(req,res)=>{try{const id=Number(req.params.id), b=z.object({name:z.string().min(1).optional(),slug:z.string().optional(),description:z.string().nullable().optional(),imageUrl:z.string().nullable().optional(),isActive:z.boolean().optional()}).parse(req.body); const data:any={...b}; if(b.slug||b.name)data.slug=await uniqueSlug(db.brand,b.slug||b.name!,id); return ok(res,await db.brand.update({where:{id},data}));}catch(e){return fail(res,e)}});
router.delete('/admin/brands/:id',auth,adminOnly,async(req,res)=>{try{return ok(res,await db.brand.update({where:{id:Number(req.params.id)},data:{isActive:false}}));}catch(e){return fail(res,e)}});

// ---------- COLLECTION RULE ENGINE ----------
type Rule={field:string;operator:string;value:any};
function ruleToWhere(rule:Rule):any{
 const op=rule.operator||'equals', value=rule.value;
 switch(rule.field){
  case 'categoryId': return {categoryId:Number(value)};
  case 'subCategoryId': return {subCategoryId:Number(value)};
  case 'brandId': return {brandId:Number(value)};
  case 'tagId': return {productTags:{some:{tagId:Number(value)}}};
  case 'featured': return {isFeatured:Boolean(value)};
  case 'name': return {name:op==='contains'?{contains:String(value),mode:'insensitive'}:String(value)};
  case 'price': {const n=Number(value); const f=op==='gt'?{gt:n}:op==='gte'?{gte:n}:op==='lt'?{lt:n}:op==='lte'?{lte:n}:{equals:n}; return {variants:{some:{isActive:true,price:f}}};}
  case 'size': return {variants:{some:{isActive:true,size:String(value)}}};
  case 'color': return {variants:{some:{isActive:true,color:{equals:String(value),mode:'insensitive'}}}};
  default: return {};
 }
}
async function collectionProducts(c:any, take=48, skip=0){
 if(c.type==='MANUAL') return db.collectionProduct.findMany({where:{collectionId:c.id,product:{isActive:true}},orderBy:[{position:'asc'},{productId:'asc'}],take,skip,include:{product:{include:{category:true,subCategory:true,productTags:{include:{tag:true}},brand:true,images:{take:1,orderBy:{sortOrder:'asc'}},variants:{where:{isActive:true}}}}}}).then((x:any[])=>x.map(x=>x.product));
 const r:any=c.rules||{}; const rules:Array<Rule>=Array.isArray(r.rules)?r.rules:[]; const mode=r.match==='ANY'?'OR':'AND'; const clauses=rules.map(ruleToWhere).filter(x=>Object.keys(x).length); const where:any={isActive:true}; if(clauses.length) where[mode]=clauses; return db.product.findMany({where,orderBy:c.isFeatured?[{isFeatured:'desc'},{updatedAt:'desc'},{id:'desc'}]:[{updatedAt:'desc'},{id:'desc'}],take,skip,include:{category:true,subCategory:true,productTags:{include:{tag:true}},brand:true,images:{take:1,orderBy:{sortOrder:'asc'}},variants:{where:{isActive:true}}}});
}
router.get('/collections',async(req,res)=>{try{const now=new Date(); const rows=await db.collection.findMany({where:{isActive:true,AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gte:now}}]}]},orderBy:[{isFeatured:'desc'},{updatedAt:'desc'}]}); return ok(res,rows);}catch(e){return fail(res,e,500)}});
router.get('/collections/:slug',async(req,res)=>{try{
 const c=await db.collection.findUnique({where:{slug:String(req.params.slug)}}); if(!c||!c.isActive)return fail(res,new Error('Collection not found'),404);
 const now=new Date();if((c.startsAt&&c.startsAt>now)||(c.endsAt&&c.endsAt<now))return fail(res,new Error('Collection is not currently available'),404);
 const page=z.coerce.number().int().min(1).max(51).parse(req.query.page||1),limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit||48);
 const products=await collectionProducts(c,limit,(page-1)*limit);
 return ok(res,{...c,products,pagination:{page,limit,hasMore:products.length===limit}});
}catch(e){return fail(res,e,500)}});

const collectionSchema=z.object({name:z.string().min(1),slug:z.string().optional(),description:z.string().nullable().optional(),imageUrl:z.string().nullable().optional(),type:z.enum(['MANUAL','AUTOMATIC','SEASONAL']).default('MANUAL'),rules:z.any().optional(),isFeatured:z.boolean().default(false),startsAt:z.coerce.date().nullable().optional(),endsAt:z.coerce.date().nullable().optional(),isActive:z.boolean().default(true)});
router.post('/admin/collections',auth,adminOnly,async(req,res)=>{try{const b=collectionSchema.parse(req.body); return ok(res,await db.collection.create({data:{...b,slug:await uniqueSlug(db.collection,b.slug||b.name)}}),201);}catch(e){return fail(res,e)}});
router.patch('/admin/collections/:id',auth,adminOnly,async(req,res)=>{try{const id=Number(req.params.id), b=collectionSchema.partial().parse(req.body); const data:any={...b}; if(b.slug||b.name)data.slug=await uniqueSlug(db.collection,b.slug||b.name!,id); return ok(res,await db.collection.update({where:{id},data}));}catch(e){return fail(res,e)}});
router.delete('/admin/collections/:id',auth,adminOnly,async(req,res)=>{try{return ok(res,await db.collection.update({where:{id:Number(req.params.id)},data:{isActive:false}}));}catch(e){return fail(res,e)}});
router.put('/admin/collections/:id/products',auth,adminOnly,async(req,res)=>{try{const collectionId=Number(req.params.id); const productIds=z.array(z.coerce.number().int().positive()).parse(req.body.productIds); const c=await db.collection.findUnique({where:{id:collectionId}}); if(!c)return fail(res,new Error('Collection not found'),404); if(c.type!=='MANUAL')return fail(res,new Error('Products can be assigned directly only to MANUAL collections')); await db.$transaction(async(tx:any)=>{await tx.collectionProduct.deleteMany({where:{collectionId}}); for(let i=0;i<productIds.length;i++)await tx.collectionProduct.create({data:{collectionId,productId:productIds[i],position:i}})}); return ok(res,{collectionId,productIds});}catch(e){return fail(res,e)}});
router.post('/admin/collections/:id/preview',auth,adminOnly,async(req,res)=>{try{const c=await db.collection.findUnique({where:{id:Number(req.params.id)}}); if(!c)return fail(res,new Error('Collection not found'),404); return ok(res,await collectionProducts(c,100));}catch(e){return fail(res,e)}});

// ---------- FEATURED PRODUCTS ----------
router.get('/featured-products',async(req,res)=>{try{return ok(res,await db.product.findMany({where:{isActive:true,isFeatured:true},take:Math.min(Number(req.query.limit)||12,50),orderBy:{updatedAt:'desc'},include:{brand:true,images:{take:1},variants:{where:{isActive:true}}}}));}catch(e){return fail(res,e,500)}});
router.patch('/admin/products/:id/featured',auth,adminOnly,async(req,res)=>{try{const {isFeatured}=z.object({isFeatured:z.boolean()}).parse(req.body); return ok(res,await db.product.update({where:{id:Number(req.params.id)},data:{isFeatured}}));}catch(e){return fail(res,e)}});
export default router;
