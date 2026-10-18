import { recordManualPayment, refundPayment, cancelOrder } from "../services/payments/paymentService";
import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
import crypto from "crypto";

const router = Router();
const db:any = prisma;
const money=(v:any)=>Number(v||0);
const admin=[auth,adminOnly] as any;

// 9 Payments: dashboard/status, manual/COD/bank-transfer/partial payments and refunds.
router.get("/payments/order/:orderId",auth,async(req:AuthRequest,res:Response)=>{const id=+req.params.orderId; const o=await db.order.findUnique({where:{id},include:{payments:true}}); if(!o)return res.status(404).json({success:false,message:"Order not found"}); if(req.user?.role!=="Admin"&&o.userId!==req.user?.userId)return res.status(403).json({success:false}); const refunds=await db.paymentRefund.findMany({where:{orderId:id},orderBy:{id:"desc"}}); res.json({success:true,data:{order:o,payments:o.payments,refunds}})});
router.post("/payments/manual",...admin,async(req:AuthRequest,res:Response)=>{const b=req.body; const data=await recordManualPayment({orderId:Number(b.orderId),amount:Number(b.amount),provider:b.provider||"BankTransfer",reference:b.reference,method:b.method||"BANK_TRANSFER",status:b.status||"Paid"});return res.json({success:true,data});});
router.post("/payments/:paymentId/refund",...admin,async(req:AuthRequest,res:Response)=>{const p=await prisma.payment.findUniqueOrThrow({where:{id:Number(req.params.paymentId)}});const refund=await refundPayment(p.id,Number(req.body.amount??p.amount),req.body.reason,req.user?.userId,req.get("Idempotency-Key"));return res.json({success:true,data:{refund}});});

// 10 Orders: dashboard, manual create/edit, cancellation, partial fulfillment, history, packing slip data.
router.get("/orders/dashboard",...admin,async(_req:AuthRequest,res:Response)=>{const [total,pending,processing,fulfilled,cancelled,revenue]=await Promise.all([db.order.count(),db.order.count({where:{status:"Pending"}}),db.order.count({where:{status:{in:["Confirmed","Processing","PartiallyFulfilled"]}}}),db.order.count({where:{status:{in:["Fulfilled","Shipped","Delivered"]}}}),db.order.count({where:{status:"Cancelled"}}),db.order.aggregate({_sum:{totalAmount:true},where:{paymentStatus:{in:["Paid","PartiallyRefunded"]}}})]);res.json({success:true,data:{total,pending,processing,fulfilled,cancelled,revenue:money(revenue._sum.totalAmount)}})});
router.post("/orders/manual",...admin,async(req:AuthRequest,res:Response)=>{try{const b=req.body; const items=b.items||[]; if(!items.length)throw new Error("items required"); const total=items.reduce((a:any,i:any)=>a+money(i.unitPrice)*Number(i.quantity),0)+money(b.shippingFee)-money(b.discountAmount); const o=await db.order.create({data:{userId:b.userId||null,totalAmount:new Prisma.Decimal(total),subtotal:new Prisma.Decimal(total-money(b.shippingFee)+money(b.discountAmount)),shippingFee:new Prisma.Decimal(money(b.shippingFee)),discountAmount:new Prisma.Decimal(money(b.discountAmount)),customerName:b.customerName,customerEmail:b.customerEmail,guestPhone:b.phone,status:b.status||"Confirmed",paymentMethod:b.paymentMethod||"COD",shippingAddressJson:b.shippingAddress||undefined,billingAddress:b.billingAddress||undefined,internalNotes:b.internalNotes,orderItems:{create:items.map((i:any)=>({productId:+i.productId,variantId:+i.variantId,quantity:+i.quantity,unitPrice:new Prisma.Decimal(i.unitPrice),productName:i.productName,sku:i.sku||null,variantLabel:i.variantLabel||null,imageUrl:i.imageUrl||null}))}} ,include:{orderItems:true}});res.status(201).json({success:true,data:o})}catch(e:any){res.status(400).json({success:false,message:e.message})}});
router.patch("/orders/:id",...admin,async(req:AuthRequest,res:Response)=>{const allowed:any={customerName:req.body.customerName,customerEmail:req.body.customerEmail,guestPhone:req.body.guestPhone,shippingAddressJson:req.body.shippingAddress,billingAddress:req.body.billingAddress,orderNotes:req.body.orderNotes,internalNotes:req.body.internalNotes,deliveryOption:req.body.deliveryOption};Object.keys(allowed).forEach(k=>allowed[k]===undefined&&delete allowed[k]);const o=await db.order.update({where:{id:+req.params.id},data:allowed});res.json({success:true,data:o})});
router.post("/orders/:id/cancel",auth,async(req:AuthRequest,res:Response)=>{const id=Number(req.params.id);const order=await prisma.order.findUnique({where:{id}});if(!order||(req.user?.role!=="Admin"&&order.userId!==req.user?.userId))return res.status(403).json({success:false,message:"Forbidden"});const data=await cancelOrder(id,String(req.body.reason||"Customer cancellation"),req.user?.role==="Admin");return res.json({success:true,data});});
router.post("/orders/:id/fulfillments",...admin,async(req:AuthRequest,res:Response)=>{try{const id=+req.params.id,items=req.body.items||[];if(!items.length)throw new Error("items required");await db.$transaction(async(tx:any)=>{for(const i of items){const oi=await tx.orderItem.findFirst({where:{id:+i.orderItemId,orderId:id}});if(!oi||oi.fulfilledQuantity+Number(i.quantity)>oi.quantity)throw new Error("Invalid fulfillment quantity");await tx.orderItem.update({where:{id:oi.id},data:{fulfilledQuantity:{increment:Number(i.quantity)}}});}await tx.fulfillment.create({data:{orderId:id,status:"FULFILLED",provider:req.body.provider,trackingNumber:req.body.trackingNumber,trackingUrl:req.body.trackingUrl,labelUrl:req.body.labelUrl,items,createdById:req.user?.userId}})});const all=await db.orderItem.findMany({where:{orderId:id}});const done=all.every((x:any)=>x.fulfilledQuantity>=x.quantity),some=all.some((x:any)=>x.fulfilledQuantity>0);const o=await db.order.update({where:{id},data:{status:done?"Fulfilled":some?"PartiallyFulfilled":"Processing"}});res.json({success:true,data:o})}catch(e:any){res.status(400).json({success:false,message:e.message})}});
router.get("/orders/:id/packing-slip",...admin,async(req:AuthRequest,res:Response)=>{const o=await db.order.findUnique({where:{id:+req.params.id},include:{orderItems:true}});if(!o)return res.status(404).json({success:false});res.json({success:true,data:{orderNo:`ORD-${String(o.id).padStart(6,"0")}`,customer:o.customerName,address:o.shippingAddressJson||o.shippingAddress,items:o.orderItems.map((i:any)=>({sku:i.sku,name:i.productName,variant:i.variantLabel,quantity:i.quantity})),notes:o.orderNotes}})});

// 11 Shipping: zones/methods, calculated rates, COD serviceability, local delivery/store pickup.
router.get("/shipping/zones",async(_req,res)=>res.json({success:true,data:await db.shippingZone.findMany({where:{isActive:true}})}));
router.post("/shipping/zones",...admin,async(req,res)=>res.status(201).json({success:true,data:await db.shippingZone.create({data:req.body})}));
router.post("/shipping/methods",...admin,async(req,res)=>res.status(201).json({success:true,data:await db.shippingMethod.create({data:{...req.body,price:new Prisma.Decimal(req.body.price||0)}})}));
router.post("/shipping/quote",async(req,res)=>{const {zoneId,subtotal=0,weightKg=0,cod=false}=req.body;const ms=await db.shippingMethod.findMany({where:{zoneId:+zoneId,isActive:true,codAllowed:cod?true:undefined}});const data=ms.filter((m:any)=>(m.minOrderValue==null||subtotal>=money(m.minOrderValue))&&(m.maxOrderValue==null||subtotal<=money(m.maxOrderValue))&&(m.minWeightKg==null||weightKg>=money(m.minWeightKg))&&(m.maxWeightKg==null||weightKg<=money(m.maxWeightKg))).map((m:any)=>({...m,calculatedPrice:m.freeAbove!=null&&subtotal>=money(m.freeAbove)?0:money(m.price)}));res.json({success:true,data})});
router.post("/shipping/cod-serviceability",async(req,res)=>{const {zoneId}=req.body;const count=await db.shippingMethod.count({where:{zoneId:+zoneId,isActive:true,codAllowed:true}});res.json({success:true,serviceable:count>0})});

// 12 Returns/exchanges: eligibility, request, admin workflow, reverse pickup, refund/store credit.
router.get("/returns/eligibility/:orderId",auth,async(req:AuthRequest,res:Response)=>{const o=await db.order.findUnique({where:{id:+req.params.orderId},include:{orderItems:true}});if(!o)return res.status(404).json({success:false});if(req.user?.role!=="Admin"&&o.userId!==req.user?.userId)return res.status(403).json({success:false});const p=await db.returnPolicy.findFirst({where:{isActive:true},orderBy:{id:"desc"}});const days=p?.daysFromDelivery??7,base=o.deliveredAt||o.updatedAt,eligible=String(o.status)==="Delivered"&&(Date.now()-new Date(base).getTime())<=days*86400000;res.json({success:true,data:{eligible,days,policy:p,items:o.orderItems}})});
router.post("/returns",auth,async(req:AuthRequest,res:Response)=>{const o=await db.order.findUnique({where:{id:+req.body.orderId}});if(!o)return res.status(404).json({success:false});if(req.user?.role!=="Admin"&&o.userId!==req.user?.userId)return res.status(403).json({success:false});const r=await db.returnRequest.create({data:{userId:req.user?.userId,orderId:o.id,type:req.body.type||"RETURN",reason:req.body.reason,items:req.body.items}});res.status(201).json({success:true,data:r})});
router.patch("/returns/:id",...admin,async(req:AuthRequest,res:Response)=>{
  try {
    const id=Number(req.params.id), b=req.body||{};
    if(!Number.isSafeInteger(id)||id<1)throw Error("Invalid return ID");
    if(b.reversePickup!==undefined||b.resolution!==undefined)throw Error("Use the dedicated recovery, receipt or refund action");
    if(b.status!==undefined&&!['APPROVED','REJECTED'].includes(b.status))throw Error("Only approval or rejection is allowed here; use the dedicated lifecycle action");
    const amount=b.refundAmount===undefined?undefined:Number(b.refundAmount);
    if(amount!==undefined&&(!Number.isFinite(amount)||amount<0))throw Error("Invalid refund amount");
    const r=await db.$transaction(async(tx:any)=>{
      await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${id} FOR UPDATE`;
      const current=await tx.returnRequest.findUniqueOrThrow({where:{id}});
      if(!['REQUESTED','PENDING','APPROVED'].includes(current.status))throw Error("Return has progressed; use its dedicated lifecycle action");
      const booking=await tx.storeSetting.findUnique({where:{key:`reverse-booking:${id}`}});
      if(booking)throw Error("Reverse booking exists; reconcile or cancel it before changing the return");
      return tx.returnRequest.update({where:{id},data:{status:b.status,refundAmount:amount===undefined?undefined:new Prisma.Decimal(amount)}});
    });
    res.json({success:true,data:r});
  }catch(e:any){res.status(400).json({success:false,message:e.message})}
});
router.post("/returns/:id/store-credit",...admin,async(req:AuthRequest,res:Response)=>{try{
  const id=Number(req.params.id);
  const data=await db.$transaction(async(tx:any)=>{
    await tx.$queryRaw`SELECT id FROM "ReturnRequest" WHERE id = ${id} FOR UPDATE`;
    const r=await tx.returnRequest.findUniqueOrThrow({where:{id}});
    if(!r.userId)throw Error("Return has no customer account");
    if(r.status!=="RECEIVED")throw Error("Inspect and receive the return before issuing credit; already refunded returns cannot be credited again");
    const amount=Number(req.body.amount??r.refundAmount), approved=Number(r.refundAmount);
    if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(approved)||approved<=0||amount>approved)throw Error("Credit must be positive and no greater than the approved refund");
    if(await tx.storeCreditTransaction.findFirst({where:{referenceType:"RETURN",referenceId:String(id),type:"CREDIT"}}))throw Error("This return already has store credit");
    const account=await tx.storeCreditAccount.upsert({where:{userId:r.userId},create:{userId:r.userId,balance:new Prisma.Decimal(amount)},update:{balance:{increment:new Prisma.Decimal(amount)}}});
    await tx.storeCreditTransaction.create({data:{userId:r.userId,amount:new Prisma.Decimal(amount),type:"CREDIT",referenceType:"RETURN",referenceId:String(id)}});
    await tx.returnRequest.update({where:{id},data:{status:"REFUNDED",resolution:{method:"STORE_CREDIT",amount}}});
    return account;
  });res.json({success:true,data});
}catch(e:any){res.status(400).json({success:false,message:e.message})}});

// 13 Promotions: discount/automatic/BOGO/bundle/quantity/flash/customer pricing/gift cards.
router.get("/promotions",...admin,async(_req,res)=>res.json({success:true,data:await db.promotion.findMany({orderBy:[{priority:"desc"},{id:"desc"}]})}));
router.post("/promotions",...admin,async(req,res)=>{const b=req.body||{};const type=({PERCENTAGE:"PERCENT",FLASH_SALE:"FLASH"} as any)[b.type]||b.type||"PERCENT";const value=Number(b.value||0);const benefit=b.benefit||(type==="FIXED"?{amount:value}:{percent:value});res.status(201).json({success:true,data:await db.promotion.create({data:{name:b.name||"Promotion",code:b.code||null,type,rules:b.rules||{},benefit,startsAt:b.startsAt?new Date(b.startsAt):null,endsAt:b.endsAt?new Date(b.endsAt):null,priority:Number(b.priority||0),isActive:b.isActive!==false}})})});
router.patch("/promotions/:id",...admin,async(req,res)=>res.json({success:true,data:await db.promotion.update({where:{id:+req.params.id},data:req.body})}));
router.delete("/promotions/:id",...admin,async(req,res)=>{await db.promotion.delete({where:{id:+req.params.id}});res.json({success:true})});
router.post("/promotions/evaluate",async(req,res)=>{const now=new Date(),cart=req.body;const ps=await db.promotion.findMany({where:{isActive:true,AND:[{OR:[{startsAt:null},{startsAt:{lte:now}}]},{OR:[{endsAt:null},{endsAt:{gte:now}}]}]},orderBy:{priority:"desc"}});let discount=0;const applied:any[]=[];for(const p of ps){const r:any=p.rules||{},b:any=p.benefit||{};const subtotal=money(cart.subtotal);if(r.minSubtotal&&subtotal<money(r.minSubtotal))continue;if(r.customerId&&Number(r.customerId)!==Number(cart.userId))continue;let d=0;if(p.type==="PERCENT")d=subtotal*money(b.percent)/100;if(p.type==="FIXED")d=money(b.amount);if(p.type==="FLASH")d=b.percent?subtotal*money(b.percent)/100:money(b.amount);if(p.type==="QUANTITY"&&Number(cart.totalQuantity||0)>=Number(r.minQuantity||0))d=b.percent?subtotal*money(b.percent)/100:money(b.amount);if(p.type==="CUSTOMER_PRICE"&&r.customerId==cart.userId)d=money(b.discountAmount);if(p.type==="BOGO"||p.type==="BUNDLE")d=money(b.discountAmount||0);if(d>0){discount+=d;applied.push({id:p.id,name:p.name,type:p.type,discount:d});if(r.stopProcessing)break;}}res.json({success:true,data:{subtotal:money(cart.subtotal),discount:Math.min(discount,money(cart.subtotal)),total:Math.max(0,money(cart.subtotal)-discount),applied}})});
router.post("/gift-cards",...admin,async(req,res)=>{const code=(req.body.code||crypto.randomBytes(6).toString("hex")).toUpperCase();const v=money(req.body.value);res.status(201).json({success:true,data:await db.giftCard.create({data:{code,initialValue:new Prisma.Decimal(v),balance:new Prisma.Decimal(v),customerEmail:req.body.customerEmail,expiresAt:req.body.expiresAt?new Date(req.body.expiresAt):null}})})});
router.post("/gift-cards/check",async(req,res)=>{const g=await db.giftCard.findUnique({where:{code:String(req.body.code).toUpperCase()}});const valid=!!g&&g.isActive&&(!g.expiresAt||g.expiresAt>new Date())&&money(g.balance)>0;res.json({success:true,data:valid?{valid,balance:money(g.balance)}:{valid:false,balance:0}})});

export default router;
