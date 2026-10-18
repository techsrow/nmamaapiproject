import { Router } from "express"; import crypto from "crypto"; import { prisma } from "../lib/prisma"; import { optionalAuth } from "../middleware/optionalAuth"; import { z } from "zod";
const r=Router(); r.use(optionalAuth);
const item=z.object({variantId:z.coerce.number().int().positive(),quantity:z.coerce.number().int().min(1).max(99)});
async function variantOK(id:number,q:number){const v=await prisma.productVariant.findUnique({where:{id},include:{product:true}});if(!v||!v.isActive||!v.product.isActive)throw new Error("Variant unavailable");if(v.trackInventory&&v.stockQuantity<q&&!v.allowBackorder&&!v.preorderEnabled)throw new Error(`Only ${v.stockQuantity} available`);return v;}
async function guest(req:any,create=true){let token=String(req.headers["x-cart-token"]||"");let c=token?await prisma.guestCart.findUnique({where:{token}}):null;if(!c&&create){token=crypto.randomBytes(24).toString("hex");c=await prisma.guestCart.create({data:{token}});}if(c)await prisma.guestCart.update({where:{id:c.id},data:{lastSeenAt:new Date()}});return c;}
async function response(req:any){if(req.user){const items=await prisma.cartItem.findMany({where:{userId:req.user.userId},include:{variant:{include:{product:{include:{images:true}}}}}});return {mode:"customer",items};}const c=await guest(req);const items=await prisma.guestCartItem.findMany({where:{cartId:c!.id},include:{variant:{include:{product:{include:{images:true}}}}}});return {mode:"guest",cartToken:c!.token,couponCode:c!.couponCode,items};}
r.get("/",async(req:any,res)=>res.json({success:true,data:await response(req)}));
r.post("/items",async(req:any,res)=>{try{
 const b=item.parse(req.body),c=req.user?null:await guest(req);
 await prisma.$transaction(async tx=>{
  const key=req.user?`cart:user:${req.user.userId}`:`cart:guest:${c!.token}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const where=req.user?{userId_variantId:{userId:req.user.userId,variantId:b.variantId}}:{cartId_variantId:{cartId:c!.id,variantId:b.variantId}};
  const current=req.user?await tx.cartItem.findUnique({where:where as any}):await tx.guestCartItem.findUnique({where:where as any});
  const quantity=(current?.quantity||0)+b.quantity;
  const v=await tx.productVariant.findUnique({where:{id:b.variantId},include:{product:true}});
  if(quantity>99||!v?.isActive||!v.product.isActive||(v.trackInventory&&v.stockQuantity<quantity&&!v.allowBackorder&&!v.preorderEnabled))throw new Error("Requested bag quantity exceeds available stock.");
  if(req.user)await tx.cartItem.upsert({where:where as any,create:{userId:req.user.userId,variantId:b.variantId,quantity},update:{quantity}});
  else await tx.guestCartItem.upsert({where:where as any,create:{cartId:c!.id,variantId:b.variantId,quantity},update:{quantity}});
 });res.json({success:true,data:await response(req)});
}catch(e:any){res.status(400).json({success:false,message:e instanceof z.ZodError?"Invalid bag item.":e.message})}});
r.patch("/items/:variantId",async(req:any,res)=>{try{const b=z.object({quantity:z.coerce.number().int().min(0).max(99)}).parse(req.body),variantId=+req.params.variantId;if(b.quantity)await variantOK(variantId,b.quantity);if(req.user){if(!b.quantity)await prisma.cartItem.deleteMany({where:{userId:req.user.userId,variantId}});else await prisma.cartItem.update({where:{userId_variantId:{userId:req.user.userId,variantId}},data:{quantity:b.quantity}});}else{const c=await guest(req);if(!b.quantity)await prisma.guestCartItem.deleteMany({where:{cartId:c!.id,variantId}});else await prisma.guestCartItem.update({where:{cartId_variantId:{cartId:c!.id,variantId}},data:{quantity:b.quantity}});}res.json({success:true,data:await response(req)});}catch(e:any){res.status(400).json({success:false,message:e.message})}});
r.delete("/items/:variantId",async(req:any,res)=>{const variantId=+req.params.variantId;if(req.user)await prisma.cartItem.deleteMany({where:{userId:req.user.userId,variantId}});else{const c=await guest(req,false);if(c)await prisma.guestCartItem.deleteMany({where:{cartId:c.id,variantId}})}res.json({success:true,data:await response(req)});});
r.delete("/",async(req:any,res)=>{if(req.user)await prisma.cartItem.deleteMany({where:{userId:req.user.userId}});else{const c=await guest(req,false);if(c)await prisma.guestCartItem.deleteMany({where:{cartId:c.id}})}res.json({success:true});});
r.post("/coupon",async(req:any,res)=>{const {code}=z.object({code:z.string().min(1)}).parse(req.body);const cp=await prisma.coupon.findUnique({where:{code:code.toUpperCase()}});if(!cp||!cp.isActive)return res.status(400).json({success:false,message:"Invalid coupon"});if(!req.user){const c=await guest(req);await prisma.guestCart.update({where:{id:c!.id},data:{couponCode:cp.code}})}res.json({success:true,data:{couponCode:cp.code}});});
r.get("/shipping-estimate",async(req:any,res)=>{const postalCode=String(req.query.postalCode||""),country=String(req.query.country||"IN");if(postalCode.length<4)return res.status(400).json({success:false,message:"postalCode required"});const zones=await prisma.shippingZone.findMany({where:{isActive:true}});res.json({success:true,data:{postalCode,country,options:zones.map(z=>({zoneId:z.id,name:z.name,rates:z.rates}))}});});
r.get("/cross-sell",async(req:any,res)=>{const data:any=await response(req);const ids=[...new Set(data.items.map((x:any)=>x.variant.productId))] as number[];const related=await prisma.relatedProduct.findMany({where:{productId:{in:ids}},include:{relatedProduct:{include:{images:true,variants:true}}},take:8});res.json({success:true,data:related.map(x=>x.relatedProduct)});});
r.post("/merge",async(req:any,res)=>{try{
 if(!req.user)return res.status(401).json({success:false,message:"Login required"});
 const {cartToken}=z.object({cartToken:z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/)}).parse(req.body);
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cart:user:${req.user.userId}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cart:guest:${cartToken}`}))`;
  const c=await tx.guestCart.findUnique({where:{token:cartToken},include:{items:true}});
  if(!c)return;
  for(const i of c.items){
   const current=await tx.cartItem.findUnique({where:{userId_variantId:{userId:req.user.userId,variantId:i.variantId}}});
   const quantity=(current?.quantity||0)+i.quantity;
   const v=await tx.productVariant.findUnique({where:{id:i.variantId},include:{product:true}});
   if(!v?.isActive||!v.product.isActive||quantity>99||(v.trackInventory&&v.stockQuantity<quantity&&!v.allowBackorder&&!v.preorderEnabled))throw new Error("Some device-bag items are unavailable or exceed stock. Your saved items remain unchanged. Adjust your guest bag before merging.");
   await tx.cartItem.upsert({where:{userId_variantId:{userId:req.user.userId,variantId:i.variantId}},create:{userId:req.user.userId,variantId:i.variantId,quantity},update:{quantity}});
  }
  await tx.guestCartItem.deleteMany({where:{cartId:c.id}});
  await tx.guestCart.update({where:{id:c.id},data:{recoveredAt:new Date(),couponCode:null}});
 });
 res.json({success:true,data:await response(req)});
}catch(e:any){res.status(400).json({success:false,message:e instanceof z.ZodError?"Invalid bag token.":e.message||"Unable to merge bag."})}});
export default r;
