const assert=require('node:assert/strict');
let enabled=true,intent=null,saved;
const item={id:10,quantity:1,fulfilledQuantity:0,unitPrice:100,productName:'Shirt'};
const order={id:1,status:'Processing',paymentStatus:'Paid',orderItems:[item],payments:[],shippingAddress:'Road',shippingCity:'Mumbai',shippingPostalCode:'400001'};
const db={shippingProviderConfig:{findUnique:async()=>({isEnabled:enabled})},storeSetting:{findUnique:async()=>intent},order:{findUnique:async()=>order,findUniqueOrThrow:async()=>order,update:async()=>({})},orderItem:{findUnique:async()=>item,update:async()=>({}),findMany:async()=>[{quantity:1,fulfilledQuantity:1}]},pickupLocation:{findFirst:async()=>({id:1})},shipment:{findMany:async()=>[],findFirst:async()=>null,findUnique:async()=>saved,create:async({data})=>(saved={id:50,...data})},shipmentItem:{createMany:async()=>({})},$queryRaw:async()=>[]};db.$transaction=async f=>f(db);
const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:db}};
const svc=require('../dist/services/shipping/shipping.service');
(async()=>{
 const input={orderId:1,provider:'Delhivery',awb:'DL12345',items:[{orderItemId:10,quantity:1}]};
 enabled=false;await assert.rejects(svc.createShipment(input),/disabled/);enabled=true;
 intent={};await assert.rejects(svc.createShipment(input),/Reconcile/);intent=null;
 await assert.rejects(svc.createShipment({...input,awb:''}),/actual carrier AWB/);
 await assert.rejects(svc.createShipment({...input,trackingUrl:'javascript:alert(1)'}),/HTTPS/);
 const s=await svc.createShipment({...input,trackingUrl:'https://example.com/track/DL12345'});assert.equal(s.provider,'Delhivery');assert.equal(s.awb,'DL12345');assert.equal(s.providerMeta.bookingMode,'MANUAL');assert.equal(s.shippingCost,null);
 await assert.rejects(svc.schedulePickup(50),/carrier portal/);
 await assert.rejects(svc.generateLabel(50),/carrier portal/);
 await assert.rejects(svc.cancelShipment(50),/carrier portal/);
 console.log('8 manual carrier scenarios passed (mock database, no carrier calls).');
})().catch(e=>{console.error(e);process.exitCode=1});
