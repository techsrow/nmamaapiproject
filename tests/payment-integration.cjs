const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { Prisma } = require('@prisma/client');
process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
process.env.CHECKOUT_ACCESS_SECRET = 'test-order-access-'.repeat(4);
process.env.PAYMENT_CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
const { encryptJson } = require('../dist/services/payments/crypto');
const clone = v => v instanceof Date ? new Date(v) : v instanceof Prisma.Decimal ? new Prisma.Decimal(v) : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)])) : v;
let tables, ids, externalOrders, externalPayments, externalRefunds, metrics, loseOrderResponse, loseRefundResponse;
function compare(a,b){if(a instanceof Date||b instanceof Date)return new Date(a).getTime()===new Date(b).getTime();return a===b}
function match(row, where={}) {
 return Object.entries(where).every(([key,v])=>{
  if(v===undefined)return true;
  if(key==='OR')return v.some(w=>match(row,w));
  if(key==='AND')return v.every(w=>match(row,w));
  const x=row[key];
  if(v && typeof v==='object' && !(v instanceof Date) && !(v instanceof Prisma.Decimal)) {
   if('in' in v)return v.in.includes(x);
   if('not' in v)return !compare(x,v.not);
   if('gte' in v && !(x>=v.gte))return false;
   if('gt' in v && !(x>v.gt))return false;
   if('lt' in v && !(x<v.lt))return false;
   if('equals' in v)return v.mode==='insensitive'?String(x).toLowerCase()===String(v.equals).toLowerCase():compare(x,v.equals);
   if('startsWith' in v)return String(x).startsWith(v.startsWith);
   return true;
  }
  return compare(x,v);
 });
}
const db={};
const names=['order','payment','paymentRefund','paymentGatewayConfig','storeSetting','productVariant','orderItem','guestCartItem','cartItem','coupon','orderStatusHistory','systemIncident','shipment'];
function present(name,row,args={}){
 if(!row)return null;const result=clone(row);
 if(args.include?.payments)result.payments=clone(tables.payment.filter(p=>p.orderId===row.id));
 if(args.include?.order)result.order=clone(tables.order.find(o=>o.id===row.orderId));
 return result;
}
for(const name of names){
 db[name]={
  async findMany(args={}){let rows=tables[name].filter(r=>match(r,args.where));if(args.orderBy){const by=Array.isArray(args.orderBy)?args.orderBy[0]:args.orderBy;const [key,direction]=Object.entries(by)[0];rows.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(direction==='desc'?-1:1))}if(args.take)rows=rows.slice(0,args.take);return rows.map(r=>present(name,r,args))},
  async findFirst(args={}){return (await this.findMany(args))[0]||null},
  async findUnique(args){return present(name,tables[name].find(r=>match(r,args.where)),args)},
  async findUniqueOrThrow(args){const r=await this.findUnique(args);if(!r)throw Error('test row not found: '+name);return r},
  async count(args={}){return (await this.findMany(args)).length},
  async create({data}){const row={id:++ids[name],createdAt:new Date(),updatedAt:new Date(),...clone(data)};if(name==='payment'){row.providerMeta??=null;row.providerOrderId??=null;row.razorpayOrderId??=null;row.providerPaymentId??=null;row.razorpayPaymentId??=null;row.isCaptured??=false;}if(name==='storeSetting'&&tables[name].some(r=>r.key===row.key))throw Error('unique constraint');tables[name].push(row);return clone(row)},
  async update({where,data}){const row=tables[name].find(r=>match(r,where));if(!row)throw Error('update missing '+name);for(const[k,v]of Object.entries(data)){if(v===undefined)continue;if(v&&typeof v==='object'&&'increment'in v)row[k]+=v.increment;else if(v&&typeof v==='object'&&'decrement'in v)row[k]-=v.decrement;else row[k]=clone(v)}row.updatedAt=new Date();return clone(row)},
  async updateMany({where,data}){const rows=tables[name].filter(r=>match(r,where));for(const row of rows)await this.update({where:{id:row.id},data});return {count:rows.length}},
  async deleteMany({where}){const before=tables[name].length;tables[name]=tables[name].filter(r=>!match(r,where));return {count:before-tables[name].length}},
 };
}
let queue=Promise.resolve();
db.$queryRaw=async()=>[];
db.$transaction=fn=>{const result=queue.then(async()=>{const snapshot=clone(tables);try{return await fn(db)}catch(e){tables=snapshot;throw e}});queue=result.catch(()=>{});return result};
const dbPath=require.resolve('../dist/lib/prisma');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{prisma:db}};
class FakeRazorpay {
 constructor(){this.orders={
  create:async body=>{metrics.creates++;const result={id:'order_'+metrics.creates,...clone(body),status:'created'};externalOrders.push(result);if(loseOrderResponse){loseOrderResponse=false;throw Error('remote timeout after commit')}return clone(result)},
  all:async ({receipt})=>({items:clone(externalOrders.filter(o=>o.receipt===receipt))}),
  fetchPayments:async id=>({items:clone(externalPayments.filter(p=>p.order_id===id))}),
 };this.payments={
  fetch:async id=>{const p=externalPayments.find(p=>p.id===id);if(!p)throw Error('payment missing');return clone(p)},
  capture:async(id,amount,currency)=>{metrics.captures++;const p=externalPayments.find(p=>p.id===id);assert.equal(p.amount,amount);assert.equal(p.currency,currency);p.status='captured';p.captured=true;return clone(p)},
  refund:async(id,body)=>{metrics.refunds++;const r={id:'rfnd_'+metrics.refunds,payment_id:id,amount:body.amount,notes:body.notes,status:'processed'};externalRefunds.push(r);if(loseRefundResponse){loseRefundResponse=false;throw Error('remote refund timeout')}return clone(r)},
  fetchMultipleRefund:async id=>({items:clone(externalRefunds.filter(r=>r.payment_id===id))}),
  fetchRefund:async(id,rid)=>clone(externalRefunds.find(r=>r.id===rid&&r.payment_id===id)),
 } }
}
const rzPath=require.resolve('razorpay');require.cache[rzPath]={id:rzPath,filename:rzPath,loaded:true,exports:FakeRazorpay};
const service=require('../dist/services/payments/paymentService');
const lifecycle=require('../dist/services/payments/orderLifecycle');
const access=require('../dist/services/payments/orderAccess');
const api=require('../dist/routes/payments').default;
const webhook=require('../dist/routes/paymentWebhooks').default;
const guestOrders=require('../dist/routes/guestOrders').default;
const {logError}=require('../dist/middleware/security');
function reset(provider='Razorpay'){
 tables=Object.fromEntries(names.map(n=>[n,[]]));ids=Object.fromEntries(names.map(n=>[n,0]));
 externalOrders=[];externalPayments=[];externalRefunds=[];metrics={creates:0,captures:0,refunds:0};loseOrderResponse=false;loseRefundResponse=false;
 tables.order.push({id:1,userId:null,totalAmount:new Prisma.Decimal(100),currency:'INR',paymentDue:new Prisma.Decimal(100),paidAmount:new Prisma.Decimal(0),refundedAmount:new Prisma.Decimal(0),paymentStatus:'Pending',status:'Pending',paymentMethod:provider==='COD'?'COD':'Prepaid',shippingMeta:{paymentProvider:provider,inventoryReserved:true}});
 tables.productVariant.push({id:1,stockQuantity:3,trackInventory:true,allowBackorder:false,preorderEnabled:false});
 const date=new Date('2026-10-01T00:00:00Z');tables.guestCartItem.push({id:1,cartId:1,variantId:1,quantity:2,updatedAt:date});
 tables.storeSetting.push({id:1,key:'checkout-lifecycle:1',value:{reservations:[{variantId:1,quantity:2}],cartItems:[{id:1,quantity:2,updatedAt:date.toISOString()}],guestCartId:1,userId:null,couponId:1,finalized:false,released:false}});ids.storeSetting=1;
 tables.coupon.push({id:1,usedCount:1});
 for(const p of ['Razorpay','COD','BankTransfer','Manual'])tables.paymentGatewayConfig.push({id:tables.paymentGatewayConfig.length+1,provider:p,isEnabled:true,displayName:p,publicConfig:{instructions:'Test instructions'},encryptedCredentials:encryptJson({keyId:'rzp_test_123',keySecret:'test_secret',webhookSecret:'webhook_secret'})});
}
async function create(){return service.createProviderPayment(1,'Razorpay')}
function entity(status='captured',extra={}){const p={id:'pay_test',order_id:externalOrders[0].id,amount:10000,currency:'INR',status,captured:status==='captured',...extra};externalPayments.push(p);return p}
function proof(p){return {providerOrderId:p.order_id,providerPaymentId:p.id,signature:crypto.createHmac('sha256','test_secret').update(`${p.order_id}|${p.id}`).digest('hex')}}
let checks=0;async function test(name,fn){reset();await fn();checks++;console.log('PASS '+name)}
(async()=>{
 await test('same order reuses gateway order after repeat and concurrent requests',async()=>{await create();await Promise.all([create(),create()]);assert.equal(metrics.creates,1);assert.equal(tables.payment.length,1)});
 await test('unknown creation outcome recovers receipt without creating another charge',async()=>{loseOrderResponse=true;await assert.rejects(create());const r=await create();assert.equal(r.checkout.providerOrderId,'order_1');assert.equal(metrics.creates,1)});
 await test('unknown creation with no matching receipt blocks replacement',async()=>{loseOrderResponse=true;await assert.rejects(create());externalOrders=[];await assert.rejects(create(),/reconciled/);assert.equal(metrics.creates,1)});
 await test('captured verification confirms order and clears unchanged cart exactly once',async()=>{await create();const p=entity();await service.verifyRazorpay(proof(p));await service.verifyRazorpay(proof(p));assert.equal(tables.order[0].paymentStatus,'Paid');assert.equal(Number(tables.order[0].paymentDue),0);assert.equal(tables.order[0].status,'Confirmed');assert.equal(tables.productVariant[0].stockQuantity,3);assert.equal(tables.guestCartItem.length,0)});
 await test('modified bag quantities survive payment finalization',async()=>{await create();tables.guestCartItem[0].quantity=3;await service.verifyRazorpay(proof(entity()));assert.equal(tables.guestCartItem[0].quantity,3)});
 await test('authorized payment is captured before marking paid',async()=>{await create();await service.verifyRazorpay(proof(entity('authorized')));assert.equal(metrics.captures,1);assert.equal(tables.order[0].paymentStatus,'Paid')});
 await test('invalid signature never mutates order',async()=>{await create();const p=entity();await assert.rejects(service.verifyRazorpay({...proof(p),signature:'0'.repeat(64)}),/signature/);assert.equal(tables.order[0].paymentStatus,'Pending')});
 await test('wrong amount is rejected even with valid signature',async()=>{await create();const p=entity('captured',{amount:1});await assert.rejects(service.verifyRazorpay(proof(p)),/match/);assert.equal(tables.payment[0].isCaptured,false)});
 await test('wrong currency is rejected',async()=>{await create();const p=entity('captured',{currency:'USD'});await assert.rejects(service.verifyRazorpay(proof(p)),/match/)});
 await test('delayed failed attempt never downgrades paid order',async()=>{await create();await service.verifyRazorpay(proof(entity()));const failed=entity('failed',{id:'pay_failed'});await service.handleRazorpayEntity(failed);assert.equal(tables.order[0].paymentStatus,'Paid');assert.equal(tables.payment[0].isCaptured,true)});
 await test('duplicate captured webhook never repeats stock or cart changes',async()=>{await create();const p=entity();await service.handleRazorpayEntity(p);await service.handleRazorpayEntity(p);assert.equal(tables.productVariant[0].stockQuantity,3);assert.equal(tables.order[0].paymentStatus,'Paid')});
 await test('cancellation releases exactly reserved stock and coupon once',async()=>{await service.cancelOrder(1,'test');await service.cancelOrder(1,'test');assert.equal(tables.order[0].status,'Cancelled');assert.equal(tables.productVariant[0].stockQuantity,5);assert.equal(tables.coupon[0].usedCount,0)});
 await test('cancelled order cannot start payment',async()=>{await service.cancelOrder(1,'test');await assert.rejects(create(),/cannot accept/);assert.equal(metrics.creates,0)});
 await test('customer cannot cancel captured paid order',async()=>{await create();await service.verifyRazorpay(proof(entity()));await assert.rejects(service.cancelOrder(1,'test'),/paid order/);assert.equal(tables.productVariant[0].stockQuantity,3)});
 await test('authorized payment prevents cancellation',async()=>{await create();entity('authorized');await assert.rejects(service.cancelOrder(1,'test'),/authorized/);assert.equal(tables.productVariant[0].stockQuantity,3)});
 await test('late captured payment remains on cancelled order for refund review',async()=>{await create();await service.cancelOrder(1,'test');await service.handleRazorpayEntity(entity());assert.equal(tables.order[0].status,'Cancelled');assert.equal(tables.order[0].paymentStatus,'Paid');assert.equal(tables.productVariant[0].stockQuantity,5);assert.equal(tables.systemIncident.length,1)});
 await test('COD confirms order but keeps payment pending',async()=>{reset('COD');await service.createProviderPayment(1,'COD');assert.equal(tables.order[0].status,'Confirmed');assert.equal(tables.order[0].paymentStatus,'Pending');assert.equal(tables.payment[0].isCaptured,false);assert.equal(tables.guestCartItem.length,0)});
 await test('selected order provider cannot be switched',async()=>{await assert.rejects(service.createProviderPayment(1,'COD'),/does not match/)});
 await test('disabled gateway blocks new payments',async()=>{tables.paymentGatewayConfig[0].isEnabled=false;await assert.rejects(create(),/unavailable/)});
 await test('disabled gateway still permits existing captured verification',async()=>{await create();tables.paymentGatewayConfig[0].isEnabled=false;await service.verifyRazorpay(proof(entity()));assert.equal(tables.order[0].paymentStatus,'Paid')});
 await test('unsupported provider fails before creating payment',async()=>{await assert.rejects(service.createProviderPayment(1,'Stripe'),/adapter/);assert.equal(tables.payment.length,0)});
 await test('partial refund retry is idempotent and does not reopen payment debt',async()=>{await create();await service.verifyRazorpay(proof(entity()));await service.refundPayment(1,30,'test',1,'refund-key');await service.refundPayment(1,30,'test',1,'refund-key');assert.equal(metrics.refunds,1);assert.equal(Number(tables.order[0].paymentDue),0);assert.equal(Number(tables.order[0].refundedAmount),30);await assert.rejects(create(),/no payment due/)});
 await test('cumulative refunds cannot exceed captured amount',async()=>{await create();await service.verifyRazorpay(proof(entity()));await service.refundPayment(1,60,'test',1,'refund-key-1');await assert.rejects(service.refundPayment(1,60,'test',1,'refund-key-2'),/refundable balance/);assert.equal(metrics.refunds,1)});
 await test('unknown refund outcome recovers before sending another refund',async()=>{await create();await service.verifyRazorpay(proof(entity()));loseRefundResponse=true;await assert.rejects(service.refundPayment(1,20,'test',1,'refund-key'));await service.refundPayment(1,20,'test',1,'refund-key');assert.equal(metrics.refunds,1);assert.equal(Number(tables.order[0].refundedAmount),20)});
 await test('unpaid payment cannot be refunded',async()=>{await create();await assert.rejects(service.refundPayment(1,10,'test'),/captured/)});
 await test('manual captured payment cannot exceed balance',async()=>{reset('COD');await assert.rejects(service.recordManualPayment({orderId:1,provider:'COD',amount:101}),/balance/);assert.equal(tables.payment.length,0)});
 await test('manual reference deduplicates payment entry',async()=>{reset('COD');await service.recordManualPayment({orderId:1,provider:'COD',amount:100,reference:'receipt-1'});await service.recordManualPayment({orderId:1,provider:'COD',amount:100,reference:'receipt-1'});assert.equal(tables.payment.length,1);assert.equal(tables.order[0].paymentStatus,'Paid')});
 await test('dashboard refund webhook is recorded once and keeps debt closed',async()=>{await create();await service.verifyRazorpay(proof(entity()));const r={id:'rfnd_dashboard',payment_id:'pay_test',amount:2500,status:'processed',notes:{}};externalRefunds.push(r);await service.reconcileRefundEvent(r);await service.reconcileRefundEvent(r);assert.equal(tables.paymentRefund.length,1);assert.equal(Number(tables.order[0].refundedAmount),25);assert.equal(Number(tables.order[0].paymentDue),0)});
 await test('authorized webhook captures before confirming payment',async()=>{await create();await service.handleRazorpayEntity(entity('authorized'));assert.equal(metrics.captures,1);assert.equal(tables.order[0].paymentStatus,'Paid')});
 const app=express();app.use('/api/payments/webhooks',express.raw({type:'application/json'}),webhook);app.use(express.json());app.use('/api/payments',api);app.use('/api/guest-orders',guestOrders);app.use(logError);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/payments`;
 const request=async(path,body,headers={})=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()}};
 try{
  await test('methods advertise guest support and omit unsupported enabled adapters',async()=>{tables.paymentGatewayConfig.push({id:5,provider:'Stripe',isEnabled:true});const r=await request('/methods');assert.equal(r.guestCheckoutVersion,2);assert.deepEqual(r.data.map(x=>x.provider),['Razorpay','COD','BankTransfer','Manual'])});
  await test('tracking capability is read-only, purpose-bound, tamper-resistant and expires',async()=>{const t=access.issueGuestTrackingAccess(1);assert.ok(access.verifyGuestTrackingAccess(t,1));assert.equal(access.verifyGuestTrackingAccess(t,2),false);assert.equal(access.verifyGuestTrackingAccess(t+'x',1),false);assert.equal(access.verifyGuestOrderAccess(t,1),false);assert.equal(access.verifyGuestTrackingAccess(access.issueGuestOrderAccess(1),1),false);const now=Date.now;try{Date.now=()=>now()+31*86400000;assert.equal(access.verifyGuestTrackingAccess(t,1),false)}finally{Date.now=now}});
  await test('tracking requires private link and never exposes customer contact or provider secrets',async()=>{tables.order[0].customerEmail='private@example.test';tables.order[0].internalNotes='private-note';tables.order[0].trackingUrl='javascript:alert(1)';const url=base.replace('/payments','/guest-orders/1');let r=await fetch(url);assert.equal(r.status,403);r=await fetch(url,{headers:{'x-order-tracking-token':access.issueGuestTrackingAccess(1)}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');const data=await r.json();assert.equal(data.data.order.trackingUrl,null);assert.equal(JSON.stringify(data).includes('private'),false);tables.order[0].userId=2;r=await fetch(url,{headers:{'x-order-tracking-token':access.issueGuestTrackingAccess(1)}});assert.equal(r.status,404)});
  await test('tracking token cannot create or cancel a payment',async()=>{const headers={'x-order-access-token':access.issueGuestTrackingAccess(1)};assert.equal((await request('/create',{orderId:1,provider:'Razorpay'},headers)).status,403);assert.equal((await request('/order/1/cancel',{},headers)).status,403);assert.equal(metrics.creates,0)});
  await test('status issues a guest tracking token and unpaid cancellation is repeat-safe',async()=>{const headers={'x-order-access-token':access.issueGuestOrderAccess(1)};const r=await request('/order/1',undefined,headers);assert.ok(access.verifyGuestTrackingAccess(r.data.order.trackingAccessToken,1));assert.equal((await request('/order/1/cancel',{},headers)).status,200);assert.equal((await request('/order/1/cancel',{},headers)).status,200);assert.equal(tables.productVariant[0].stockQuantity,5)});
  await test('guest create route rejects missing order token',async()=>{const r=await request('/create',{orderId:1,provider:'Razorpay'});assert.equal(r.status,403);assert.equal(metrics.creates,0)});
  await test('guest cannot use another order token',async()=>{const r=await request('/create',{orderId:1,provider:'Razorpay'},{'x-order-access-token':access.issueGuestOrderAccess(2)});assert.equal(r.status,403)});
  await test('invalid account JWT cannot fall back to guest token',async()=>{const r=await request('/create',{orderId:1,provider:'Razorpay'},{Authorization:'Bearer invalid','x-order-access-token':access.issueGuestOrderAccess(1)});assert.equal(r.status,401)});
  await test('guest token cannot access account order',async()=>{tables.order[0].userId=2;const r=await request('/order/1',undefined,{'x-order-access-token':access.issueGuestOrderAccess(1)});assert.equal(r.status,403)});
  await test('frontend-compatible create, verify, status contract',async()=>{const headers={'x-order-access-token':access.issueGuestOrderAccess(1)};let r=await request('/create',{orderId:1,provider:'Razorpay'},headers);assert.equal(r.status,201);assert.equal(r.data.checkout.amount,10000);assert.ok(!JSON.stringify(r).includes('test_secret'));const p=entity();r=await request('/verify/razorpay',{orderId:1,razorpay_order_id:p.order_id,razorpay_payment_id:p.id,razorpay_signature:proof(p).signature},headers);assert.equal(r.status,200);r=await request('/order/1',undefined,headers);assert.equal(r.data.order.paymentStatus,'Paid');assert.equal(Number(r.data.order.paymentDue),0)});
  await test('verification route rejects mismatched local order ID',async()=>{await create();const p=entity();const r=await request('/verify/razorpay',{orderId:2,...proof(p)},{'x-order-access-token':access.issueGuestOrderAccess(1)});assert.equal(r.status,403)});
  await test('raw webhook HMAC verified before capture processing',async()=>{await create();const p=entity();const body={event:'payment.captured',payload:{payment:{entity:p}}};let r=await request('/webhooks/razorpay',body,{'x-razorpay-signature':'0'.repeat(64)});assert.equal(r.status,400);assert.equal(tables.payment[0].isCaptured,false);const sig=crypto.createHmac('sha256','webhook_secret').update(JSON.stringify(body)).digest('hex');r=await request('/webhooks/razorpay',body,{'x-razorpay-signature':sig});assert.equal(r.status,200);assert.equal(tables.payment[0].isCaptured,true)});
 }finally{server.close()}
 console.log(`${checks} payment integration checks passed. Database and gateway mocked; no real orders or payments.`);
})().catch(e=>{console.error(e);process.exitCode=1});
