import { ShipmentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { credentialsFor } from './provider.service';
import { trackShadowfax, updateShadowfaxOrder } from './shadowfax.service';

const object=(x:any):any=>x&&typeof x==='object'?x:{};
export function shadowfaxStatus(code:string):ShipmentStatus|undefined {
 const states:Record<string,ShipmentStatus>={new:'AwbAssigned',assigned_for_pickup:'PickupScheduled',assigned_for_seller_pickup:'PickupScheduled',ofp:'PickupScheduled',picked:'Picked',received_from_client_warehouse:'Picked',recd_at_rev_hub:'InTransit',recd_at_fwd_hub:'InTransit',recd_at_fwd_dc:'InTransit',assigned_for_delivery:'OutForDelivery',ofd:'OutForDelivery',delivered:'Delivered',cid:'NDR',nc:'NDR',na:'NDR',on_hold:'NDR',ewb_on_hold:'NDR',reopen_ndr:'InTransit',cancelled_by_customer:'Cancelled',rts:'RTOInitiated',rto:'RTOInitiated',rts_in_process:'RTOInTransit',rts_nd:'RTOInTransit',rto_nd:'RTOInTransit',rts_d:'RTO',rto_d:'RTO',lost:'Failed'};
 return states[code];
}
export function carrierDate(x:unknown):Date|null {
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(x))return null;
 const date=new Date(x.replace(' ','T')+(/(?:Z|[+-]\d{2}:?\d{2})$/.test(x)?'':'+05:30'));
 return Number.isFinite(date.getTime())?date:null;
}
export async function syncShadowfaxShipment(id:number) {
 const shipment=await prisma.shipment.findUniqueOrThrow({where:{id}});
 if(shipment.provider!=='Shadowfax360'||!shipment.awb)throw new Error('Shadowfax shipment with AWB required.');
 const cfg=await credentialsFor('Shadowfax360',true);
 if(object(shipment.providerMeta).mode!==cfg.config.mode)throw new Error('Restore original carrier mode before tracking.');
 const started=new Date();const response=await trackShadowfax(shipment.awb);
 return applyShadowfaxTracking(id,response,started);
}
// Only call with a response retrieved by our authenticated carrier client, never callback JSON.
export async function applyShadowfaxTracking(id:number,response:any,started:Date) {
 const initial=await prisma.shipment.findUniqueOrThrow({where:{id}});
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${initial.orderId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id=${id} FOR UPDATE`;
  const s=await tx.shipment.findUniqueOrThrow({where:{id}}),meta=object(s.providerMeta),remote=response?.order_details;
  if(response?.message!=='Success'||s.provider!=='Shadowfax360'||remote?.awb_number!==s.awb||remote?.client_order_id!==meta.clientOrderId)throw new Error('Carrier tracking does not match shipment.');
  if(meta.lastSyncStartedAt&&new Date(meta.lastSyncStartedAt)>=started)return s;
  const status=shadowfaxStatus(String(remote.status));
  const events=Array.isArray(response.tracking_details)?response.tracking_details:[];
  let latest=0;
  for(const event of events.slice(-500)){
   const date=carrierDate(event.created);if(!date||date.getTime()>Date.now()+300000||event.awb_number&&event.awb_number!==s.awb)continue;
   latest=Math.max(latest,date.getTime());
   const code=String(event.status_id||'').slice(0,100);
   if(!await tx.shipmentTrackingEvent.findFirst({where:{shipmentId:id,eventTime:date,providerCode:code}}))await tx.shipmentTrackingEvent.create({data:{shipmentId:id,eventTime:date,providerCode:code,status:String(event.status||code).slice(0,200),activity:String(event.remarks||'').slice(0,1000),location:String(event.location||'').slice(0,200)}});
  }
  const stale=latest>0&&latest<Number(meta.lastCarrierEventMs||0);
  const terminal=['Delivered','RTO','Cancelled'].includes(s.status);
  const next=(!status||stale||terminal)?s.status:status;
  const collected=['Picked','InTransit','OutForDelivery','Delivered','RTOInitiated','RTOInTransit','RTO'].includes(next)||events.some((e:any)=>['picked','received_from_client_warehouse'].includes(e.status_id));
  let fulfillmentReleased=Boolean(meta.fulfillmentReleased);
  if(next==='Cancelled'&&!s.shippedAt&&!collected&&!fulfillmentReleased){
   const items=await tx.shipmentItem.findMany({where:{shipmentId:id}});
   for(const item of items){const oi=await tx.orderItem.findUniqueOrThrow({where:{id:item.orderItemId}});if(oi.fulfilledQuantity<item.quantity)throw new Error('Fulfillment quantity requires reconciliation.');await tx.orderItem.update({where:{id:oi.id},data:{fulfilledQuantity:{decrement:item.quantity}}});}
   fulfillmentReleased=true;
  }
  const now=new Date();
  const updated=await tx.shipment.update({where:{id},data:{status:next,shippedAt:s.shippedAt||(collected?now:null),deliveredAt:s.deliveredAt||(next==='Delivered'?now:null),cancelledAt:s.cancelledAt||(next==='Cancelled'?now:null),providerMeta:{...meta,lastSyncStartedAt:started.toISOString(),lastSyncedAt:now.toISOString(),lastCarrierEventMs:Math.max(latest,Number(meta.lastCarrierEventMs||0)),carrierStatus:String(remote.status||''),fulfillmentReleased,needsPhysicalReturnReview:(next==='RTO'||next==='Cancelled'&&Boolean(s.shippedAt||collected))}}});
  const order=await tx.order.findUniqueOrThrow({where:{id:s.orderId}});
  if(!['Cancelled','Returned','Delivered'].includes(order.status))await tx.order.update({where:{id:s.orderId},data:{shipmentStatus:next,...(next==='Delivered'?{status:'Delivered',deliveredAt:now}:collected?{status:'Shipped',shippedAt:order.shippedAt||now}:{})}});
  // Delivery does not prove COD remittance; keep payment settlement separate.
  return updated;
 });
}
export async function requestShadowfaxPickup(_id:number,_input:any){throw Error('Pickup-slot scheduling is not documented in the supplied Shadowfax contract. Arrange pickup changes through the carrier.');}
export async function syncShadowfaxBatch(){
 const shipments=await prisma.shipment.findMany({where:{provider:'Shadowfax360',awb:{not:null},status:{notIn:['Delivered','Cancelled','RTO']}},orderBy:{updatedAt:'asc'},take:100});
 let synced=0,failed=0;
 for(const s of shipments){try{await syncShadowfaxShipment(s.id);synced++;}catch{failed++;await prisma.shipment.update({where:{id:s.id},data:{updatedAt:new Date()}}).catch(()=>{});}}
 return {synced,failed};
}
