import crypto from 'crypto';
import { Prisma, PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { calculateCheckoutTax } from '../checkoutTax.service';
import { changeStock } from '../inventory/stock.service';
const amount=z.number().finite().nonnegative().max(10000000).refine(n=>Math.abs(n*100-Math.round(n*100))<0.00001,'Use at most two decimal places.');
export const quoteSchema=z.object({
 sessionId:z.number().int().positive(),items:z.array(z.object({variantId:z.number().int().positive(),quantity:z.number().int().min(1).max(10000)})).min(1).max(100),
 discount:amount.default(0),customerId:z.number().int().positive().optional(),customerName:z.string().trim().min(1).max(120).default('Walk-in customer'),
 customerEmail:z.email().optional(),customerPhone:z.string().trim().max(30).optional(),customerGstin:z.string().trim().max(20).optional(),
});
export const saleSchema=quoteSchema.extend({expectedTotal:amount,tenders:z.array(z.object({method:z.enum(['CASH','UPI','CARD','BANK_TRANSFER']),amount:amount.refine(n=>n>0),reference:z.string().trim().min(3).max(150).optional()})).min(1).max(5),paymentReceived:z.literal(true)});
export const returnSchema=z.object({sessionId:z.number().int().positive(),items:z.array(z.object({orderItemId:z.number().int().positive(),quantity:z.number().int().positive(),restock:z.boolean()})).min(1).max(100),method:z.enum(['CASH','UPI','CARD','BANK_TRANSFER']),reference:z.string().trim().min(3).max(150).optional(),reason:z.string().trim().min(3).max(500),refundPaid:z.literal(true)});
export const money=(x:number)=>Math.round(x*100);
const fingerprint=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const requestKeySchema=z.string().uuid();
async function session(tx:Prisma.TransactionClient,id:number,userId:number){
 await tx.$queryRaw`SELECT id FROM "PosSession" WHERE id=${id} FOR UPDATE`;
 const row=await tx.posSession.findUnique({where:{id}});
 if(!row||row.cashierId!==userId||row.closedAt)throw new Error('Your open POS session is required.');
 const warehouse=await tx.warehouse.findUnique({where:{id:row.warehouseId}});if(!warehouse?.isActive)throw new Error('Active warehouse required.');
 return {...row,warehouse};
}
async function quote(tx:Prisma.TransactionClient,b:z.infer<typeof quoteSchema>,userId:number){
 const active=await session(tx,b.sessionId,userId);
 const ids=b.items.map(x=>x.variantId);if(new Set(ids).size!==ids.length)throw new Error('Merge duplicate variants into one line.');
 for(const id of [...ids].sort((a,b)=>a-b))await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id=${id} FOR UPDATE`;
 const variants=await tx.productVariant.findMany({where:{id:{in:ids}},include:{product:true}});
 const lines=b.items.map(item=>{
  const v=variants.find(v=>v.id===item.variantId);if(!v?.isActive||!v.product.isActive)throw new Error('An item is unavailable.');
  if(!v.trackInventory||v.allowBackorder||v.preorderEnabled)throw new Error('POS requires tracked, in-stock variants.');
  if(v.stockQuantity<item.quantity)throw new Error(`Insufficient stock for ${v.product.name}.`);
  const unit=money(Number(v.discountPrice??v.price));if(!Number.isSafeInteger(unit)||unit<0)throw new Error('Invalid variant price.');
  return {variantId:v.id,productId:v.productId,productName:v.product.name,sku:v.sku,barcode:v.barcode,variantLabel:[v.color,v.size].filter(Boolean).join(' / '),quantity:item.quantity,unitPrice:unit/100,lineTotal:unit*item.quantity/100,hsnSac:v.product.hsnSac};
 });
 const allocations=await tx.warehouseInventory.findMany({where:{warehouseId:active.warehouseId,variantId:{in:ids}}});
 for(const line of lines){const row=allocations.find(x=>x.variantId===line.variantId);if(!row||row.reserved!==0||row.quantity<line.quantity)throw new Error('Insufficient allocated stock in the POS warehouse. Receive/transfer or reconcile stock first.');}
 const address=active.warehouse.address as Record<string,unknown>|null;
 const country=String(address?.country||'IN'),region=String(address?.state||address?.region||'');if(!region)throw new Error('Set the warehouse state for tax calculation.');
 const tax=await calculateCheckoutTax({country,region,discount:b.discount,items:lines},tx);
 const subtotal=lines.reduce((s,x)=>s+money(x.lineTotal),0)/100;
 const total=(money(subtotal)-money(b.discount)+money(tax.additionalTax))/100;
 if(total<=0)throw new Error('POS sale total must be greater than zero.');
 return {active,lines,subtotal,discount:b.discount,shippingCharge:0,total,currency:'INR',...tax};
}
export async function preparePos(b:z.infer<typeof quoteSchema>,userId:number){return prisma.$transaction(tx=>quote(tx,b,userId));}
export async function completePos(b:z.infer<typeof saleSchema>,userId:number,key:string){
 const requestKey=`sale:${userId}:${key}`,hash=fingerprint(b);
 return prisma.$transaction(async tx=>{
  // Transaction-scoped idempotency lock: retries wait for the original commit.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey},0))::text`;
  const old=await tx.posSale.findUnique({where:{requestKey}});if(old){if(old.fingerprint!==hash)throw new Error('Request key already used for another bill.');return {sale:old,order:await tx.order.findUnique({where:{id:old.orderId},include:{orderItems:true}}),reused:true};}
  const q=await quote(tx,b,userId);if(money(q.total)!==money(b.expectedTotal))throw new Error('Bill total changed. Review the new quote.');
  if(b.tenders.reduce((s,t)=>s+money(t.amount),0)!==money(q.total))throw new Error('Tender allocations must equal the bill total; exclude cash change.');
  if(b.tenders.some(t=>t.method!=='CASH'&&!t.reference))throw new Error('External UPI/card/bank payments require a confirmed reference.');
  const refs=b.tenders.filter(t=>t.method!=='CASH').map(t=>t.reference!);
  if(new Set(refs).size!==refs.length)throw new Error('Duplicate payment reference in this bill.');
  for(const ref of [...refs].sort()){
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-payment:${ref}`},0))::text`;
    const used=await tx.payment.findFirst({where:{provider:'Manual',providerPaymentId:ref,providerMeta:{path:['source'],equals:'POS'}}});
    if(used)throw new Error('This payment reference has already been recorded on a bill.');
  }
  if(b.customerId){const customer=await tx.user.findUnique({where:{id:b.customerId}});if(!customer?.isActive||customer.role!=='Customer')throw new Error('Active customer required.');}
  const store=await tx.storeSetting.findUnique({where:{key:'store'}});
  const now=new Date(),year=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Kolkata',year:'numeric'}).format(now)),month=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Kolkata',month:'numeric'}).format(now));
  const start=month>=4?year:year-1,fy=`${start}-${String(start+1).slice(-2)}`;
  const seq=await tx.invoiceSequence.upsert({where:{key:`POS-${fy}`},create:{key:`POS-${fy}`,prefix:'POS',nextNumber:2,financialYear:fy},update:{nextNumber:{increment:1}}});
  const invoiceNumber=`POS/${fy}/${String(seq.nextNumber-1).padStart(6,'0')}`;
  const order=await tx.order.create({data:{salesChannel:'POS',userId:b.customerId,customerName:b.customerName,customerEmail:b.customerEmail,guestPhone:b.customerPhone,customerGstin:b.customerGstin,
   status:'Fulfilled',paymentStatus:'Paid',paymentMethod:'Prepaid',currency:'INR',subtotal:q.subtotal,discountAmount:q.discount,couponDiscount:0,shippingFee:0,taxAmount:q.tax,totalAmount:q.total,paidAmount:q.total,paymentDue:0,
   invoiceNumber,invoiceIssuedAt:now,taxInclusive:q.additionalTax===0,taxBreakdown:q.breakdown as any,shippingMeta:{inventoryReserved:true,source:'POS'},
   orderItems:{create:q.lines.map(l=>({productId:l.productId,variantId:l.variantId,productName:l.productName,sku:l.sku,variantLabel:l.variantLabel,unitPrice:l.unitPrice,quantity:l.quantity,fulfilledQuantity:l.quantity}))}
  },include:{orderItems:true}});
  for(const line of [...q.lines].sort((a,b)=>a.variantId-b.variantId))await changeStock(tx,{variantId:line.variantId,warehouseId:q.active.warehouseId,delta:-line.quantity,type:'SALE',referenceType:'POS_ORDER',referenceId:String(order.id),userId});
  for(const tender of b.tenders)await tx.payment.create({data:{orderId:order.id,provider:'Manual',amount:tender.amount,currency:'INR',paymentStatus:'Paid',isCaptured:true,paymentMethod:tender.method==='CASH'?'Prepaid':tender.method as PaymentMethod,providerPaymentId:tender.reference,providerMeta:{source:'POS',method:tender.method,recordedBy:userId,externallyConfirmed:true}}});
  const sale=await tx.posSale.create({data:{orderId:order.id,sessionId:b.sessionId,cashierId:userId,requestKey,fingerprint:hash,tenders:b.tenders,sellerSnapshot:store?.value??{name:'Namama'}}});
  await tx.activityLog.create({data:{userId,action:'POS_SALE',entity:'Order',entityId:String(order.id),meta:{saleId:sale.id,invoiceNumber}}});
  return {sale,order,reused:false};
 },{timeout:15000});
}
export async function returnPos(saleId:number,b:z.infer<typeof returnSchema>,userId:number,key:string){
 const requestKey=`return:${userId}:${key}`,hash=fingerprint({saleId,...b});
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey},0))::text`;
  const old=await tx.posReturn.findUnique({where:{requestKey}});if(old){if(old.fingerprint!==hash)throw new Error('Request key already used for another return.');return old;}
  const returnSession=await session(tx,b.sessionId,userId);
  await tx.$queryRaw`SELECT id FROM "PosSale" WHERE id=${saleId} FOR UPDATE`;
  const sale=await tx.posSale.findUnique({where:{id:saleId}});if(!sale)throw new Error('POS sale not found.');
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${sale.orderId} FOR UPDATE`;
  const order=await tx.order.findUniqueOrThrow({where:{id:sale.orderId},include:{orderItems:{orderBy:{id:'asc'}}}});
  const oldSession=await tx.posSession.findUniqueOrThrow({where:{id:sale.sessionId}});
  if(b.method!=='CASH'&&!b.reference)throw new Error('Refund payment reference required.');
  if(new Set(b.items.map(x=>x.orderItemId)).size!==b.items.length)throw new Error('Duplicate return lines.');
  const breakdown=order.taxBreakdown as any[];
  if(!Array.isArray(breakdown)||breakdown.length!==order.orderItems.length)throw new Error('Bill tax snapshot requires review.');
  let cents=0, taxCents=0;
  const items=b.items.map(request=>{
   const index=order.orderItems.findIndex(i=>i.id===request.orderItemId),item=order.orderItems[index];
   if(!item||request.quantity>item.quantity-item.returnedQuantity)throw new Error('Return quantity exceeds the original unreturned sale quantity.');
   const tax=breakdown[index];const lineTotal=money(Number(tax.taxableAmount))+ (tax.inclusive?0:money(Number(tax.taxAmount)));
   // Cumulative rounding makes partial refunds sum exactly to the original line.
   const refund=Math.round(lineTotal*(item.returnedQuantity+request.quantity)/item.quantity)-Math.round(lineTotal*item.returnedQuantity/item.quantity);
   taxCents+=Math.round(money(Number(tax.taxAmount))*(item.returnedQuantity+request.quantity)/item.quantity)-Math.round(money(Number(tax.taxAmount))*item.returnedQuantity/item.quantity);
   cents+=refund;return {...request,variantId:item.variantId,refund:refund/100};
  });
  if(cents+money(Number(order.refundedAmount))>money(Number(order.totalAmount)))throw new Error('Refund exceeds the remaining paid balance.');
  for(const item of [...items].sort((a,b)=>a.variantId-b.variantId)){
   if(item.restock)await changeStock(tx,{variantId:item.variantId,warehouseId:returnSession.warehouseId,delta:item.quantity,type:'RETURN',referenceType:'POS_RETURN',referenceId:requestKey,userId,note:b.reason});
   await tx.orderItem.update({where:{id:item.orderItemId},data:{returnedQuantity:{increment:item.quantity},refundedQuantity:{increment:item.quantity}}});
  }
  const refunded=(money(Number(order.refundedAmount))+cents)/100;
  const full=money(refunded)===money(Number(order.totalAmount));
  await tx.order.update({where:{id:order.id},data:{refundedAmount:refunded,paidAmount:(money(Number(order.totalAmount))-money(refunded))/100,paymentDue:0,paymentStatus:full?'Refunded':'PartiallyRefunded',...(full?{status:'Returned'}:{})}});
  await tx.paymentRefund.create({data:{orderId:order.id,amount:cents/100,provider:'Manual',status:'SUCCESS',reason:b.reason,createdById:userId,meta:{source:'POS',requestKey,method:b.method,reference:b.reference??null,externallyConfirmed:true}}});
  const result=await tx.posReturn.create({data:{saleId,sessionId:b.sessionId,cashierId:userId,requestKey,fingerprint:hash,items,amount:cents/100,method:b.method,reference:b.reference,reason:b.reason}});
  await tx.creditNote.create({data:{orderId:order.id,number:`POS-CN/${result.id}`,amount:cents/100,taxAmount:taxCents/100,reason:b.reason,lines:items,createdById:userId}});
  await tx.activityLog.create({data:{userId,action:'POS_RETURN',entity:'Order',entityId:String(order.id),meta:{returnId:result.id,amount:cents/100}}});return result;
 },{timeout:15000});
}
