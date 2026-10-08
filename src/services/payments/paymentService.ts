import crypto from "crypto";
import Razorpay from "razorpay";
import { PaymentProvider, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { gateway } from "./providerRegistry";

const n=(v:any)=>Number(v||0);

export async function syncOrderPayment(orderId:number){
  const order=await prisma.order.findUnique({where:{id:orderId}}); if(!order) throw new Error("Order not found");
  const pays=await prisma.payment.findMany({where:{orderId,paymentStatus:{in:["Paid","PartiallyPaid"]}}});
  const refunds=await prisma.paymentRefund.findMany({where:{orderId,status:{in:["SUCCESS","PROCESSED"]}}});
  const paid=pays.reduce((a,x)=>a+n(x.amount),0), refunded=refunds.reduce((a,x)=>a+n(x.amount),0);
  const net=Math.max(0,paid-refunded), total=n(order.totalAmount);
  const status:any=refunded>=paid&&paid>0?"Refunded":refunded>0?"PartiallyRefunded":net>=total?"Paid":net>0?"PartiallyPaid":"Pending";
  return prisma.order.update({where:{id:orderId},data:{paidAmount:new Prisma.Decimal(net),refundedAmount:new Prisma.Decimal(refunded),paymentDue:new Prisma.Decimal(Math.max(0,total-net)),paymentStatus:status}});
}

export async function createProviderPayment(orderId:number, provider:PaymentProvider){
  const order=await prisma.order.findUnique({where:{id:orderId}}); if(!order) throw new Error("Order not found");
  const amount=n(order.paymentDue ?? order.totalAmount);
  if(amount<=0) throw new Error("Order has no payment due");

  if(provider==="COD" || provider==="BankTransfer" || provider==="Manual"){
    const p=await prisma.payment.create({data:{orderId,amount:new Prisma.Decimal(amount),currency:order.currency||"INR",provider,paymentStatus:"Pending",isCaptured:false}});
    return {payment:p, checkout:{type:String(provider)}};
  }

  if(provider!=="Razorpay") throw new Error(`${provider} transaction adapter is not enabled in this build`);
  const g=await gateway(provider); const c=g.credentials;
  const rz=new Razorpay({key_id:c.keyId,key_secret:c.keySecret});
  const ro:any=await rz.orders.create({amount:Math.round(amount*100),currency:order.currency||"INR",receipt:`order_${order.id}_${Date.now()}`,notes:{orderId:String(order.id)}});
  const p=await prisma.payment.create({data:{orderId,amount:new Prisma.Decimal(amount),currency:order.currency||"INR",provider:"Razorpay",paymentStatus:"Created",providerOrderId:ro.id,razorpayOrderId:ro.id,providerMeta:{receipt:ro.receipt}}});
  await prisma.order.update({where:{id:orderId},data:{razorpayOrderId:ro.id,paymentStatus:"Created"}});
  return {payment:p,checkout:{type:"Razorpay",providerOrderId:ro.id,keyId:c.keyId,amount:ro.amount,currency:ro.currency}};
}

export async function verifyRazorpay(input:{providerOrderId:string;providerPaymentId:string;signature:string}){
  const p=await prisma.payment.findFirst({where:{OR:[{providerOrderId:input.providerOrderId},{razorpayOrderId:input.providerOrderId}]},orderBy:{id:"desc"}}); if(!p) throw new Error("Payment not found");
  const g=await gateway("Razorpay");
  const expected=crypto.createHmac("sha256",g.credentials.keySecret).update(`${input.providerOrderId}|${input.providerPaymentId}`).digest("hex");
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(input.signature))) throw new Error("Invalid payment signature");
  const updated=await prisma.payment.update({where:{id:p.id},data:{providerPaymentId:input.providerPaymentId,providerSignature:input.signature,razorpayPaymentId:input.providerPaymentId,razorpaySignature:input.signature,paymentStatus:"Paid",isCaptured:true}});
  await syncOrderPayment(p.orderId);
  return updated;
}

export async function refundPayment(paymentId:number, amount:number, reason:string|undefined, createdById?:number){
  const p=await prisma.payment.findUnique({where:{id:paymentId}}); if(!p) throw new Error("Payment not found");
  if(amount<=0 || amount>n(p.amount)) throw new Error("Invalid refund amount");
  let providerRefundId:string|null=null, status="PROCESSED", meta:any=null;
  if(p.provider==="Razorpay"){
    const external=p.providerPaymentId||p.razorpayPaymentId; if(!external) throw new Error("Razorpay payment id missing");
    const g=await gateway("Razorpay"); const rz=new Razorpay({key_id:g.credentials.keyId,key_secret:g.credentials.keySecret});
    const r:any=await rz.payments.refund(external,{amount:Math.round(amount*100),notes:{reason:reason||"refund"}});
    providerRefundId=r.id; status=String(r.status||"PROCESSED").toUpperCase()==="PROCESSED"?"SUCCESS":String(r.status||"PENDING").toUpperCase(); meta={speed_processed:r.speed_processed};
  } else if (!["Manual","BankTransfer","COD"].includes(String(p.provider))) {
    throw new Error(`${p.provider} refund adapter is not enabled in this build`);
  }
  const r=await prisma.paymentRefund.create({data:{orderId:p.orderId,paymentId:p.id,amount:new Prisma.Decimal(amount),provider:String(p.provider),providerRefundId,status,reason:reason||null,meta,createdById}});
  await syncOrderPayment(p.orderId); return r;
}
