import axios from 'axios';
import crypto from 'crypto';
import { z } from 'zod';
import { ShipmentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { credentialsFor } from './provider.service';
import { carrierDate } from './shadowfaxLifecycle.service';
const key=(id:number)=>`delhivery-booking:${id}`;
const object=(x:any):any=>x&&typeof x==='object'?x:{};
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const schema=z.object({orderId:z.number().int().positive(),pickupLocationId:z.number().int().positive(),weightKg:z.number().positive().max(100),lengthCm:z.number().positive().max(300),widthCm:z.number().positive().max(300),heightCm:z.number().positive().max(300),ewayBill:z.string().regex(/^\d{12}$/).optional(),sellerGstin:z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),items:z.array(z.object({orderItemId:z.number().int().positive(),quantity:z.number().int().positive()})).optional()});
async function client(existing=false){
 const {config,credentials}=await credentialsFor('Delhivery',existing),token=String(credentials.token||'').trim();
 if(!token)throw Error('Delhivery API token is missing. Save the token for the selected Test/Live mode in Shipping Providers → Delhivery.');
 return {config,credentials,mode:config.mode,account:hash(token),base:config.mode==='LIVE'?'https://track.delhivery.com':'https://staging-express.delhivery.com',options:{headers:{Authorization:`Token ${token}`,Accept:'application/json'},timeout:20000}};
}
export function delhiveryError(e:any){
 if([401,403].includes(e?.response?.status))return 'Delhivery authentication failed. Check your token, Test/Live mode and API access.';
 if(e?.response?.status===429)return 'Delhivery request limit reached. Wait before retrying this operation.';
 const d=e?.response?.data||e;const parts=[d?.rmk,d?.message,...(Array.isArray(d?.packages)?d.packages.flatMap((p:any)=>p.remarks||[]):[])];
 return parts.flat().filter(x=>typeof x==='string').join('; ').replace(/<[^>]*>/g,'').slice(0,500)||'Delhivery did not confirm the request. Check its saved booking reference.';
}
async function tracking(c:any,params:any){try{return (await axios.get(`${c.base}/api/v1/packages/json/`,{...c.options,params})).data}catch(e){throw Error(delhiveryError(e))}}
function matched(data:any,reference:string,awb?:string){
 const matches=(Array.isArray(data?.ShipmentData)?data.ShipmentData:[]).map((x:any)=>x.Shipment).filter((x:any)=>x?.ReferenceNo===reference&&/^\d{8,30}$/.test(String(x.AWB||''))&&(!awb||String(x.AWB)===awb));
 if(matches.length!==1)throw Error(`Delhivery booking ${reference} is awaiting reconciliation. Verify this reference in Delhivery One. Do not create a second shipment.`);
 return matches[0];
}
async function serviceability(c:any,pincode:string,cod:boolean){
 let data;try{data=(await axios.get(`${c.base}/c/api/pin-codes/json/`,{...c.options,params:{filter_codes:pincode}})).data}catch(e){throw Error(delhiveryError(e))}
 const postal=Array.isArray(data?.delivery_codes)?data.delivery_codes.map((x:any)=>x.postal_code).find((x:any)=>String(x?.pin)===pincode):null;
 if(!postal||String(postal.remarks||'').trim()||String(postal[cod?'cod':'pre_paid']).toUpperCase()!=='Y')throw Error(`Delhivery does not service destination PIN ${pincode} for ${cod?'COD':'prepaid'} orders.`);
}
async function bookingAccount(c:any,state:any){if(state.mode!==c.mode||state.account!==c.account)throw Error('Restore the original Delhivery token and Test/Live mode before recovering or managing this booking.');}
export async function bookDelhivery(input:unknown){
 const parsed=schema.safeParse(input);if(!parsed.success)throw Error('Check shipping fields: '+parsed.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '));
 const b=parsed.data,c=await client();
 // A repeated click or uncertain previous response must only recover the saved booking.
 const old=await prisma.storeSetting.findUnique({where:{key:key(b.orderId)}});
 if(old)return recoverDelhivery(b.orderId);
 const order=await prisma.order.findUniqueOrThrow({where:{id:b.orderId},include:{orderItems:true}});
 const pickup=await prisma.pickupLocation.findFirst({where:{id:b.pickupLocationId,isActive:true}});if(!pickup)throw Error('Select an active pickup location.');
 const cfg=object(c.config.publicConfig),address=object(order.shippingAddressJson),cod=order.paymentMethod==='COD';
 const warehouse=String(cfg.pickupLocationNames?.[String(pickup.id)]||'').trim();
 if(!warehouse)throw Error('Delhivery warehouse mapping is missing for this pickup location. Open Shipping Providers → Delhivery and enter its exact registered warehouse name.');
 if(order.paymentStatus!=='Paid'&&!cod)throw Error('Only paid or confirmed COD orders can be shipped.');
 if(!['Confirmed','Processing'].includes(order.status)||!order.orderItems.length||order.orderItems.some(i=>i.fulfilledQuantity>0))throw Error('Delhivery requires a complete unfulfilled confirmed order.');
 if(b.items&&(b.items.length!==order.orderItems.length||new Set(b.items.map(i=>i.orderItemId)).size!==b.items.length||order.orderItems.some(i=>!b.items!.some(x=>x.orderItemId===i.id&&x.quantity===i.quantity))))throw Error('Delhivery booking requires all order items in one parcel.');
 const phone=String(order.guestPhone||address.phone||'').replace(/\D/g,'').replace(/^91(?=\d{10}$)/,''),pin=String(order.shippingPostalCode||address.pincode||address.postalCode||''),name=order.customerName||address.name||address.fullName,street=order.shippingAddress||address.address1||address.line1||address.address,city=order.shippingCity||address.city,state=address.state||address.province;
 if(!name||!street||!city||!state||!/^[1-9]\d{5}$/.test(pin)||!/^\d{10}$/.test(phone))throw Error('Complete the customer name, address, city, state, six-digit PIN and ten-digit phone before booking Delhivery.');
 if(Number(order.totalAmount)>=50000&&!b.ewayBill)throw Error('Enter the 12-digit e-way bill for this high-value Delhivery shipment.');
 await serviceability(c,pin,cod);
 const reference=`NM-${order.id}-${crypto.randomUUID().slice(0,18)}`;
 const parcel={order:reference,name,add:street,pin,city,state,country:order.shippingCountry||address.country||'India',phone,payment_mode:cod?'COD':'Prepaid',cod_amount:cod?Math.max(0,Number(order.totalAmount)-Number(order.paidAmount||0)):0,total_amount:Number(order.totalAmount),products_desc:order.orderItems.map(i=>i.productName||i.sku||'Item').join(', ').slice(0,250),quantity:String(order.orderItems.reduce((s,i)=>s+i.quantity,0)),weight:Math.round(b.weightKg*1000),shipment_length:b.lengthCm,shipment_width:b.widthCm,shipment_height:b.heightCm,shipping_mode:cfg.shippingMode==='Express'?'Express':'Surface',seller_name:pickup.contactName||pickup.name,seller_add:pickup.address1,seller_inv:order.invoiceNumber||`NM-${order.id}`,...(c.credentials.clientName?{client:c.credentials.clientName}:{}),...(b.ewayBill?{ewbn:b.ewayBill}:{}),...(b.sellerGstin?{seller_gst_tin:b.sellerGstin}:{})};
 const prepared=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${order.id} FOR UPDATE`;
  for(const prefix of ['shadowfax','shiprocket'])if(await tx.storeSetting.findUnique({where:{key:`${prefix}-booking:${order.id}`}}))throw Error(`Reconcile the saved ${prefix} booking before changing provider.`);
  if(await tx.storeSetting.findUnique({where:{key:key(order.id)}}))return false;
  const fresh=await tx.order.findUniqueOrThrow({where:{id:order.id},include:{orderItems:true}});
  if(!['Confirmed','Processing'].includes(fresh.status)||fresh.orderItems.some(i=>i.fulfilledQuantity>0)||fresh.updatedAt.getTime()!==order.updatedAt.getTime())throw Error('Order changed. Refresh before booking.');
  await tx.storeSetting.create({data:{key:key(order.id),value:{stage:'PENDING',mode:c.mode,account:c.account,reference,payload:{shipments:[parcel],pickup_location:{name:warehouse}},package:b,items:order.orderItems.map(i=>({id:i.id,quantity:i.quantity})),createdAt:new Date().toISOString()}}});
  return true;
 });
 if(!prepared)return recoverDelhivery(order.id);
 try{
  const body=new URLSearchParams({format:'json',data:JSON.stringify({shipments:[parcel],pickup_location:{name:warehouse}})}).toString();
  const data=(await axios.post(`${c.base}/api/cmu/create.json`,body,{...c.options,headers:{...c.options.headers,'Content-Type':'application/x-www-form-urlencoded'}})).data;
  const p=data?.packages?.[0];
  if(data?.success!==true||data.packages?.length!==1||String(p?.status).toLowerCase()!=='success'||!/^\d{8,30}$/.test(String(p?.waybill||''))||p.refnum&&p.refnum!==reference)throw Error(delhiveryError(data));
  // Preserve the confirmed AWB before local fulfillment, allowing recovery after a DB failure.
  const saved=await prisma.storeSetting.findUniqueOrThrow({where:{key:key(order.id)}});
  await prisma.storeSetting.update({where:{key:key(order.id)},data:{value:{...object(saved.value),awb:String(p.waybill),stage:'CONFIRMED'}}});
  return finalize(order.id);
 }catch(e){const message=axios.isAxiosError(e)?delhiveryError(e):e instanceof Error?e.message:'Unconfirmed carrier response';throw Error(`${message} Saved Delhivery reference: ${reference}. Retry this order to recover the existing booking; no second shipment will be created.`);}
}
export async function recoverDelhivery(orderId:number){
 const saved=await prisma.storeSetting.findUniqueOrThrow({where:{key:key(orderId)}}),state=object(saved.value),c=await client(true);await bookingAccount(c,state);
 if(state.shipmentId)return prisma.shipment.findUniqueOrThrow({where:{id:state.shipmentId}});
 if(!state.awb){const remote=matched(await tracking(c,{ref_ids:state.reference}),state.reference);const status=delhiveryStatus(remote.Status?.Status,remote.Status?.StatusType);if(status==='Cancelled')throw Error('The recovered Delhivery booking is cancelled. Contact the carrier before rebooking.');await prisma.storeSetting.update({where:{key:key(orderId)},data:{value:{...state,awb:String(remote.AWB),stage:'CONFIRMED'}}});}
 return finalize(orderId);
}
async function finalize(orderId:number){return prisma.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${orderId} FOR UPDATE`;
 const saved=await tx.storeSetting.findUniqueOrThrow({where:{key:key(orderId)}}),state=object(saved.value);
 if(state.shipmentId)return tx.shipment.findUniqueOrThrow({where:{id:state.shipmentId}});
 if(!state.awb)throw Error('No confirmed Delhivery AWB saved.');
 const order=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{orderItems:true}});
 if(!['Confirmed','Processing'].includes(order.status)||order.orderItems.some(i=>i.fulfilledQuantity>0)||order.orderItems.length!==state.items.length||order.orderItems.some(i=>!state.items.some((x:any)=>x.id===i.id&&x.quantity===i.quantity)))throw Error('Order changed after carrier booking. Reconcile the existing AWB; do not rebook.');
 const b=state.package,shipment=await tx.shipment.create({data:{orderId,provider:'Delhivery',courierName:'Delhivery',awb:state.awb,providerOrderId:state.reference,status:'AwbAssigned',pickupLocationId:b.pickupLocationId,weightKg:b.weightKg,lengthCm:b.lengthCm,widthCm:b.widthCm,heightCm:b.heightCm,shippingCost:null,codAmount:state.payload.shipments[0].cod_amount,trackingUrl:`https://www.delhivery.com/track/package/${encodeURIComponent(state.awb)}`,providerMeta:{bookingMode:'API',mode:state.mode,account:state.account,clientOrderId:state.reference}}});
 await tx.shipmentItem.createMany({data:state.items.map((i:any)=>({shipmentId:shipment.id,orderItemId:i.id,quantity:i.quantity}))});
 for(const item of state.items)await tx.orderItem.update({where:{id:item.id},data:{fulfilledQuantity:item.quantity}});
 await tx.order.update({where:{id:orderId},data:{status:'Processing',shippingProvider:'Delhivery',shipmentStatus:'AwbAssigned',shipmentId:String(shipment.id),awbNumber:shipment.awb,trackingCode:shipment.awb,trackingUrl:shipment.trackingUrl}});
 await tx.storeSetting.update({where:{key:key(orderId)},data:{value:{...state,stage:'BOOKED',shipmentId:shipment.id}}});
 return shipment;
});}
async function forShipment(s:any){const c=await client(true);await bookingAccount(c,object(s.providerMeta));return c;}
export async function labelDelhivery(s:any){
 const c=await forShipment(s);let data;try{data=(await axios.get(`${c.base}/api/p/packing_slip`,{...c.options,params:{wbns:s.awb,pdf:'true',pdf_size:'4R'}})).data}catch(e){throw Error(delhiveryError(e))}
 const url=data?.pdf_download_link||data?.packages?.[0]?.pdf_download_link;
 if(typeof url!=='string')throw Error('Delhivery has not returned the PDF label yet. Retry Generate label for this AWB; do not create another shipment.');
 return url;
}
export function delhiveryStatus(raw:unknown,type?:unknown):ShipmentStatus|undefined{
 const s=String(raw||'').toLowerCase();if(String(type).toUpperCase()==='RT'||s.includes('rto'))return s==='rto'||s.includes('delivered')?'RTO':s.includes('transit')?'RTOInTransit':'RTOInitiated';
 return ({manifested:'AwbAssigned','not picked':'AwbAssigned','ready for pickup':'PickupScheduled','in transit':'InTransit',pending:'NDR',dispatched:'OutForDelivery',delivered:'Delivered',cancelled:'Cancelled',canceled:'Cancelled','returned to origin':'RTO',lost:'Failed'} as Record<string,ShipmentStatus>)[s];
}
export async function syncDelhivery(id:number){
 const initial=await prisma.shipment.findUniqueOrThrow({where:{id}});if(initial.provider!=='Delhivery'||!initial.awb)throw Error('Delhivery shipment with AWB required.');
 const c=await forShipment(initial),started=new Date(),remote=matched(await tracking(c,{waybill:initial.awb}),object(initial.providerMeta).clientOrderId,initial.awb),current=remote.Status||{},date=carrierDate(current.StatusDateTime);
 if(!date||date.getTime()>Date.now()+300000)throw Error('Delhivery has no valid tracking scan yet. Retry later; your saved shipment is unchanged.');
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${initial.orderId} FOR UPDATE`;
  const s=await tx.shipment.findUniqueOrThrow({where:{id}}),m=object(s.providerMeta);
  if(Number(m.lastCarrierEventMs||0)>date.getTime()||m.lastSyncStartedAt&&new Date(m.lastSyncStartedAt)>=started)return s;
  const events=[...(Array.isArray(remote.Scans)?remote.Scans:[]).map((x:any)=>x.ScanDetail),{ScanDateTime:current.StatusDateTime,Scan:current.Status,ScanType:current.StatusType,ScannedLocation:current.StatusLocation,Instructions:current.Instructions}];
  for(const e of events.slice(-500)){if(!e)continue;const d=carrierDate(e.ScanDateTime),code=String(e.ScanType||'').slice(0,100);if(!d||d.getTime()>Date.now()+300000)continue;if(!await tx.shipmentTrackingEvent.findFirst({where:{shipmentId:id,eventTime:d,providerCode:code}}))await tx.shipmentTrackingEvent.create({data:{shipmentId:id,eventTime:d,providerCode:code,status:String(e.Scan||'Update').slice(0,200),activity:String(e.Instructions||'').slice(0,1000),location:String(e.ScannedLocation||'').slice(0,200)}});}
  const next=delhiveryStatus(current.Status,current.StatusType),status=['Delivered','RTO','Cancelled'].includes(s.status)?s.status:next||s.status;
  const collected=!!s.shippedAt||['InTransit','OutForDelivery','Delivered','RTOInitiated','RTOInTransit','RTO'].includes(status);
  const updated=await tx.shipment.update({where:{id},data:{status,shippedAt:s.shippedAt||(collected?date:null),deliveredAt:s.deliveredAt||(status==='Delivered'?date:null),providerMeta:{...m,lastSyncStartedAt:started.toISOString(),lastCarrierEventMs:date.getTime(),carrierStatus:String(current.Status||''),needsPhysicalReturnReview:['RTO','Cancelled'].includes(status)}}});
  const order=await tx.order.findUniqueOrThrow({where:{id:s.orderId}});
  if(!['Cancelled','Returned','Delivered'].includes(order.status))await tx.order.update({where:{id:s.orderId},data:{shipmentStatus:status,...(status==='Delivered'?{status:'Delivered',deliveredAt:date}:collected?{status:'Shipped',shippedAt:order.shippedAt||date}:{})}});
  return updated;
 });
}

export async function testDelhivery(){
 const c=await client(),cfg=object(c.config.publicConfig);
 if(!Object.values(cfg.pickupLocationNames||{}).some(x=>typeof x==='string'&&x.trim()))throw Error('Map a pickup location to its registered Delhivery warehouse name before booking.');
 try{const r=await axios.get(`${c.base}/c/api/pin-codes/json/`,{...c.options,params:{filter_codes:'400102'}});if(!Array.isArray(r.data?.delivery_codes))throw Error('Unexpected Delhivery serviceability response.');}catch(e){throw Error(delhiveryError(e))}
 return {ok:true,message:'Delhivery API authentication succeeded. Warehouse activation and destination serviceability are checked by carrier booking.'};
}
