const assert=require('node:assert/strict');
let s,order,events,quantity,updates;
function reset(){s={id:1,orderId:2,provider:'Shadowfax360',awb:'SF123',status:'AwbAssigned',providerMeta:{clientOrderId:'NM123',mode:'TEST'},shippedAt:null,deliveredAt:null,cancelledAt:null};order={id:2,status:'Processing',paymentStatus:'Pending'};events=[];quantity=2;updates=[]}
const db={
 $queryRaw:async()=>[],shipment:{findUniqueOrThrow:async()=>s,update:async({data})=>Object.assign(s,data)},order:{findUniqueOrThrow:async()=>order,update:async({data})=>{updates.push(data);return Object.assign(order,data)}},
 shipmentTrackingEvent:{findFirst:async({where:w})=>events.find(e=>e.providerCode===w.providerCode&&e.eventTime.getTime()===w.eventTime.getTime()),create:async({data})=>events.push(data)},
 shipmentItem:{findMany:async()=>[{orderItemId:5,quantity:2}]},orderItem:{findUniqueOrThrow:async()=>({id:5,fulfilledQuantity:quantity}),update:async({data})=>{quantity-=data.fulfilledQuantity.decrement}}
};db.$transaction=async(fn)=>{const old=structuredClone({s,order,events,quantity,updates});try{return await fn(db)}catch(e){({s,order,events,quantity,updates}=old);throw e}};
function inject(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports}}
inject('../dist/lib/prisma',{prisma:db});
const {applyShadowfaxTracking,shadowfaxStatus,carrierDate}=require('../dist/services/shipping/shadowfaxLifecycle.service');
const response=(status,time='2026-10-15T10:00:00Z')=>({message:'Success',order_details:{awb_number:'SF123',client_order_id:'NM123',status},tracking_details:[{created:time,status_id:status,status,awb_number:'SF123'}]});
let clock=Date.now();const apply=(r)=>applyShadowfaxTracking(1,r,new Date(++clock));
(async()=>{
 reset();await apply(response('picked'));assert.equal(s.status,'Picked');assert.equal(order.status,'Shipped');assert.ok(s.shippedAt);
 await apply(response('picked'));assert.equal(events.length,1);
 await apply(response('delivered','2026-10-15T11:00:00Z'));assert.equal(order.status,'Delivered');assert.equal(order.paymentStatus,'Pending');
 await apply(response('picked','2026-10-15T10:00:00Z'));assert.equal(s.status,'Delivered');
 reset();await apply(response('cancelled_by_customer'));assert.equal(quantity,0);assert.equal(s.providerMeta.fulfillmentReleased,true);assert.equal(order.status,'Processing');
 await apply(response('cancelled_by_customer'));assert.equal(quantity,0);
 reset();await apply(response('picked'));await apply(response('cancelled_by_customer','2026-10-15T11:00:00Z'));assert.equal(quantity,2);assert.equal(s.providerMeta.needsPhysicalReturnReview,true);
 reset();await apply(response('rts_d'));assert.equal(quantity,2);assert.equal(s.status,'RTO');assert.equal(s.providerMeta.needsPhysicalReturnReview,true);
 reset();const mismatch=response('delivered');mismatch.order_details.client_order_id='OTHER';await assert.rejects(apply(mismatch),/does not match/);assert.equal(s.status,'AwbAssigned');
 reset();await apply(response('ofd','2026-10-15T11:00:00Z'));await apply(response('picked'));assert.equal(s.status,'OutForDelivery');
 reset();await apply(response('unknown_new_code'));assert.equal(s.status,'AwbAssigned');assert.equal(shadowfaxStatus('unknown'),undefined);
 assert.equal(carrierDate('2026-10-15 10:00:00').toISOString(),'2026-10-15T04:30:00.000Z');assert.equal(carrierDate('bad'),null);
 reset();await apply(response('nc'));await apply(response('ofd','2026-10-15T11:00:00Z'));assert.equal(s.status,'OutForDelivery');
 reset();await applyShadowfaxTracking(1,response('picked'),new Date(clock+100));await applyShadowfaxTracking(1,response('new'),new Date(clock));assert.equal(s.status,'Picked');
 console.log('14 Shadowfax lifecycle checks passed; carrier and transactions mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
