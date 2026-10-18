import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { credentialsFor } from './provider.service';
import { createShadowfaxOrder, trackShadowfax } from './shadowfax.service';
import { ShadowfaxBookingError, shadowfaxErrorMessage } from './shadowfaxError';
const key=(id:number)=>`shadowfax-booking:${id}`;
const obj=(x:unknown):any=>x&&typeof x==='object'?x:{};
function phone(value:unknown){const x=String(value||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');if(!/^\d{10}$/.test(x))throw new Error('Valid ten-digit pickup/customer phone required.');return x;}
function pin(value:unknown){const x=String(value||'');if(!/^[1-9]\d{5}$/.test(x))throw new Error('Valid Indian pickup/customer PIN required.');return Number(x);}
export async function bookShadowfax(input:{orderId:number;pickupLocationId?:number;items?:unknown;weightKg?:number;ewayBill?:string;sellerGstin?:string;pickupDate?:string;pickupSlot?:string}){
 if(!Number.isSafeInteger(input.orderId)||input.orderId<=0)throw new Error('Invalid order ID.');
 if(input.items!==undefined)throw new Error('Shadowfax booking currently ships the complete unfulfilled order; omit items.');
 const cfg=await credentialsFor('Shadowfax360');
 if(obj(cfg.config.publicConfig).enableBooking!==true)throw new Error('Enable Shadowfax booking only after staging carrier verification (publicConfig.enableBooking).');
 const prepared=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${input.orderId} FOR UPDATE`;
  if(await tx.storeSetting.findUnique({where:{key:`shiprocket-booking:${input.orderId}`}}))throw Error("Reconcile existing Shiprocket booking first.");
  const existing=await tx.storeSetting.findUnique({where:{key:key(input.orderId)}}),saved=obj(existing?.value);
  if(saved.shipmentId){
   const previous=await tx.shipment.findUniqueOrThrow({where:{id:saved.shipmentId}});
   if(previous.status==='Cancelled'&&obj(previous.providerMeta).fulfillmentReleased===true&&!previous.shippedAt){
    await tx.storeSetting.upsert({where:{key:`shadowfax-booking:archive:${previous.id}`},create:{key:`shadowfax-booking:archive:${previous.id}`,value:saved},update:{value:saved}});
    await tx.storeSetting.delete({where:{key:key(input.orderId)}});
   }else return {saved:true,state:saved};
  }
  if(existing&&!saved.shipmentId)throw new Error(`Shadowfax booking ${saved.clientOrderId} needs reconciliation. Recover it using the actual AWB; do not create another shipment.`);
  const order=await tx.order.findUniqueOrThrow({where:{id:input.orderId},include:{orderItems:true,payments:true}});
  if(['Cancelled','Returned','Shipped','Delivered','Fulfilled'].includes(order.status))throw new Error('This order is not eligible for a new shipment.');
  if(!order.orderItems.length)throw new Error('Order has no items.');
  const cod=order.paymentMethod==='COD';
  if(!cod&&order.paymentStatus!=='Paid')throw new Error('Only paid or confirmed COD orders can be shipped.');
  if(cod&&order.status!=='Confirmed'&&order.status!=='Processing')throw new Error('Confirm the COD order before shipping.');
  if(order.orderItems.some(i=>i.fulfilledQuantity>0)||await tx.shipment.count({where:{orderId:order.id,status:{notIn:['Cancelled','Failed']}}}))throw new Error('Existing or partial fulfillment requires review.');
  const pickup=await tx.pickupLocation.findFirst({where:{isActive:true,...(input.pickupLocationId?{id:input.pickupLocationId}:{})},orderBy:[{isDefault:'desc'},{id:'asc'}]});if(!pickup)throw new Error('Active pickup location required.');
  const address=obj(order.shippingAddressJson),config=obj(cfg.config.publicConfig);
  const name=order.customerName||address.fullName||address.name,street=order.shippingAddress||address.line1||address.address1||address.address,city=order.shippingCity||address.city;
  if(!name||!street||!city||!pickup.address1||!pickup.city)throw new Error('Complete delivery and pickup addresses are required.');
  const value=Number(order.totalAmount)-Number(order.shippingFee||0);
  if(!Number.isFinite(value)||value<=0)throw new Error('Invalid shipment value.');
  const docs=z.object({ewayBill:z.string().regex(/^\d{12}$/).optional(),sellerGstin:z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),weightKg:z.number().finite().positive().max(1000).optional(),pickupDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),pickupSlot:z.string().regex(/^[-A-Za-z0-9_]{1,50}$/).optional()}).parse(input);
  if(value>=50000&&(!docs.ewayBill||!docs.sellerGstin))throw new Error('High-value shipments require e-way bill/GST documentation.');
  if(docs.pickupDate||docs.pickupSlot)throw Error('Invalid pickup scheduling request: no date/slot contract is supplied.');
  if(Boolean(docs.pickupDate)!==Boolean(docs.pickupSlot))throw new Error('Supply pickupDate and pickupSlot together.');
  if(docs.pickupDate&&(!Number.isFinite(Date.parse(docs.pickupDate))||new Date(docs.pickupDate).toISOString().slice(0,10)!==docs.pickupDate||docs.pickupDate<new Date(Date.now()+19800000).toISOString().slice(0,10)))throw new Error('Invalid/past pickup date.');
  if(!String(config.productCategory||'').trim())throw new Error('Configure the actual carrier productCategory before booking.');
  const clientOrderId=`NM-${order.id}-${crypto.randomUUID()}`;
  const sender={name:pickup.contactName||pickup.name,contact:phone(pickup.phone),address_line_1:pickup.address1,address_line_2:pickup.address2||'',city:pickup.city,pincode:pin(pickup.pincode)};
  const payload={order_type:'marketplace',customer_details:{name,contact:phone(order.guestPhone||address.phone),address_line_1:street,city,pincode:pin(order.shippingPostalCode||address.postalCode||address.pincode),state:address.state||''},
   order_details:{client_order_id:clientOrderId,product_value:Math.round(value*100)/100,payment_mode:cod?'cod':'prepaid',cod_amount:cod?Number(order.totalAmount)-Number(order.paidAmount||0):0,order_service:'Regular',...(docs.ewayBill?{eway_bill:docs.ewayBill}:{}),...(docs.weightKg?{actual_weight:docs.weightKg}:{})},
   pickup_details:{...sender,pickup_type:'seller',...(docs.pickupDate?{pickup_date:docs.pickupDate,pickup_slot:docs.pickupSlot}:{})},return_details:{...sender,return_type:'seller'},
   product_details:order.orderItems.map(i=>({sku_name:i.productName,sku_id:i.sku||String(i.variantId),price:Number(i.unitPrice),additional_details:{quantity:i.quantity},...(docs.sellerGstin?{seller_details:{gstin_number:docs.sellerGstin}}:{}),category:String(config.productCategory||''),invoice_no:order.invoiceNumber||`NM-${order.id}`}))};
  const state={state:'PENDING',clientOrderId,payload,pickupLocationId:pickup.id,mode:cfg.config.mode,createdAt:new Date().toISOString()};
  await tx.storeSetting.create({data:{key:key(order.id),value:state}});
  await tx.order.update({where:{id:order.id},data:{status:'Processing'}});
  return {saved:false,state};
 });
 if(prepared.saved)return prisma.shipment.findUniqueOrThrow({where:{id:prepared.state.shipmentId}});
 // Intentionally no blind retry: timeout does not mean the carrier failed to book.
 try {
  const response=await createShadowfaxOrder(prepared.state.payload);
  return await finalizeShadowfax(input.orderId,response);
 } catch(error) {await recordBookingFailure(input.orderId,prepared.state.clientOrderId,error);throw error;}
}
async function recordBookingFailure(orderId:number,clientOrderId:string,error:unknown){
 try{await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const row=await tx.storeSetting.findUnique({where:{key:key(orderId)}}),state=obj(row?.value);
  if(!row||state.clientOrderId!==clientOrderId||state.shipmentId)return;
  await tx.storeSetting.update({where:{key:key(orderId)},data:{value:{...state,retryUntil:null,lastError:{at:new Date().toISOString(),kind:error instanceof ShadowfaxBookingError&&error.rejected?'CARRIER_REJECTED':'UNCERTAIN',message:shadowfaxErrorMessage(error)}}}});
 });}catch{console.error('Shadowfax booking diagnostics could not be saved.',{orderId,clientOrderId});}
}
export async function shadowfaxBookingStatus(orderId:number){
 const row=await prisma.storeSetting.findUnique({where:{key:key(orderId)}});
 if(!row)return {hasIntent:false};
 const state=obj(row.value);
 return {hasIntent:true,clientOrderId:state.clientOrderId,mode:state.mode,state:state.state,createdAt:state.createdAt,shipmentId:state.shipmentId||null,awb:state.awb||null,lastError:state.lastError||null,retryUntil:state.retryUntil||null,pickupPincode:state.payload?.pickup_details?.pincode||null,pickupLocationId:state.pickupLocationId||null};
}
// Explicit administrator recovery: Shadowfax documents client_order_id idempotency.
// Always replay the original payload and ID. Never build a new request from edited form data.
export async function retrySavedShadowfax(orderId:number,expectedClientOrderId:string,correction?:{pickupLocationId:number;expectedErrorAt:string}){
 const cfg=await credentialsFor('Shadowfax360');
 const prepared=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const row=await tx.storeSetting.findUniqueOrThrow({where:{key:key(orderId)}}),state=obj(row.value);
  if(state.clientOrderId!==expectedClientOrderId)throw new Error('The saved booking changed. Reload its diagnostics before retrying.');
  if(state.mode!==cfg.config.mode)throw new Error('Restore the original carrier mode before retrying the saved booking.');
  if(state.shipmentId)return {booked:true,state};
  if(Date.parse(state.retryUntil||'')>Date.now())throw new Error('A saved-request recovery is already running. Wait and refresh diagnostics.');
  if(!state.payload||state.payload.order_details?.client_order_id!==state.clientOrderId)throw new Error('Saved carrier request is incomplete. Manual review is required.');
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{orderItems:true}});
  if(order.status!=='Processing'||order.orderItems.some(i=>i.fulfilledQuantity!==0)||await tx.shipment.count({where:{orderId,status:{notIn:['Cancelled','Failed']}}}))throw new Error('Order fulfillment changed. Review it before retrying.');
  const value=Number(order.totalAmount)-Number(order.shippingFee||0),cod=order.paymentMethod==='COD'?Number(order.totalAmount)-Number(order.paidAmount||0):0;
  const items=state.payload.product_details;
  if(value!==Number(state.payload.order_details.product_value)||cod!==Number(state.payload.order_details.cod_amount)||!Array.isArray(items)||items.length!==order.orderItems.length||order.orderItems.some(i=>!items.some((p:any)=>p.sku_id===(i.sku||String(i.variantId))&&Number(p.price)===Number(i.unitPrice)&&Number(p.additional_details?.quantity)===i.quantity)))throw new Error('Order amounts or items changed since booking. Manual reconciliation is required.');
  if(correction){
   if(obj(cfg.config.publicConfig).enableBooking!==true)throw new Error('Enable Shadowfax API booking before correcting a rejected request.');
   if(state.lastError?.kind!=='CARRIER_REJECTED'||state.lastError?.at!==correction.expectedErrorAt)throw new Error('Only the current explicitly rejected request can be corrected. Refresh diagnostics; uncertain requests require reconciliation.');
   const pickup=await tx.pickupLocation.findFirst({where:{id:correction.pickupLocationId,isActive:true}});
   if(!pickup||!pickup.address1||!pickup.city)throw new Error('Select an active pickup location with a complete address.');
   const sender={name:pickup.contactName||pickup.name,contact:phone(pickup.phone),address_line_1:pickup.address1,address_line_2:pickup.address2||'',city:pickup.city,pincode:pin(pickup.pincode)};
   state.corrections=[...(Array.isArray(state.corrections)?state.corrections:[]),{at:new Date().toISOString(),previousPickup:state.payload.pickup_details,previousReturn:state.payload.return_details,previousError:state.lastError}];
   state.payload={...state.payload,pickup_details:{...state.payload.pickup_details,...sender},return_details:{...state.payload.return_details,...sender}};
   state.pickupLocationId=pickup.id;
   state.pickupCorrected=true;
  }
  // Once a request is in flight its outcome is uncertain, including a process crash.
  state.lastError={at:new Date().toISOString(),kind:'UNCERTAIN',message:'Carrier request started; awaiting a confirmed response.'};
  await tx.storeSetting.update({where:{key:key(orderId)},data:{value:{...state,retryUntil:new Date(Date.now()+90000).toISOString()}}});
  return {booked:false,state};
 });
 if(prepared.booked)return prisma.shipment.findUniqueOrThrow({where:{id:prepared.state.shipmentId}});
 try{const remote=await createShadowfaxOrder(prepared.state.payload);return await finalizeShadowfax(orderId,remote);}
 catch(error){await recordBookingFailure(orderId,prepared.state.clientOrderId,error);throw error;}
}
export async function recoverShadowfax(orderId:number,awb:string){
 const intent=await prisma.storeSetting.findUniqueOrThrow({where:{key:key(orderId)}});
 if(awb===obj(intent.value).clientOrderId)throw new Error('This is the client order ID, not an AWB. Enter the carrier AWB or use Retry saved booking.');
 const cfg=await credentialsFor('Shadowfax360');
 if(obj(intent.value).mode!==cfg.config.mode)throw new Error('Restore the original carrier mode before reconciliation.');
 const response=await trackShadowfax(awb);return finalizeShadowfax(orderId,response.order_details);
}
async function finalizeShadowfax(orderId:number,remote:any){
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
  const intent=await tx.storeSetting.findUniqueOrThrow({where:{key:key(orderId)}}),state=obj(intent.value);
  if(state.shipmentId)return tx.shipment.findUniqueOrThrow({where:{id:state.shipmentId}});
  if(remote?.client_order_id!==state.clientOrderId||!remote?.id||!/^[A-Za-z0-9_-]{1,100}$/.test(String(remote?.awb_number||''))||Number(remote.product_value)!==Number(state.payload.order_details.product_value)||Number(remote.cod_amount)!==Number(state.payload.order_details.cod_amount))throw new Error('Carrier order does not match the saved shipment intent.');
  if(state.pickupCorrected&&(Number(remote.pickup_details?.pincode)!==Number(state.payload.pickup_details.pincode)||remote.pickup_details?.address_line_1!==state.payload.pickup_details.address_line_1))throw new Error('Carrier pickup address does not match the corrected request. Review the existing carrier booking before proceeding.');
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{orderItems:true}});
  if(order.status!=='Processing'||order.orderItems.some(i=>i.fulfilledQuantity!==0))throw new Error('Order changed while shipping was being reconciled.');
  const shipment=await tx.shipment.create({data:{orderId,provider:'Shadowfax360',courierName:'Shadowfax 360',providerOrderId:String(remote.id),providerShipmentId:String(remote.id),awb:String(remote.awb_number),status:'AwbAssigned',pickupLocationId:state.pickupLocationId,codAmount:state.payload.order_details.cod_amount,shippingCost:null,providerMeta:{clientOrderId:state.clientOrderId,mode:state.mode}}});
  await tx.shipmentItem.createMany({data:order.orderItems.map(i=>({shipmentId:shipment.id,orderItemId:i.id,quantity:i.quantity}))});
  for(const item of order.orderItems)await tx.orderItem.update({where:{id:item.id},data:{fulfilledQuantity:item.quantity}});
  await tx.order.update({where:{id:orderId},data:{shippingProvider:'Shadowfax360',shipmentId:String(shipment.id),awbNumber:shipment.awb,shipmentStatus:'AwbAssigned'}});
  await tx.storeSetting.update({where:{key:intent.key},data:{value:{...state,state:'BOOKED',shipmentId:shipment.id,awb:shipment.awb}}});return shipment;
 });
}
