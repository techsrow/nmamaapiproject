const assert=require('node:assert/strict'),axios=require('axios');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let settings=new Map(),shipment=null,events=[],posts=0,mode='LIVE',token='test-only',warehouse='NM Mumbai',service=true,timeout=false,reply=null,remote=null;
const order={id:1,status:'Processing',paymentMethod:'COD',paymentStatus:'Pending',totalAmount:1000,paidAmount:0,updatedAt:new Date('2026-01-01'),customerName:'Customer',guestPhone:'9999999999',shippingAddress:'Road 1',shippingCity:'Mumbai',shippingPostalCode:'400102',shippingAddressJson:{state:'Maharashtra'},orderItems:[{id:10,quantity:2,fulfilledQuantity:0,productName:'Shirt'}]};
const tx={$queryRaw:async()=>[],storeSetting:{findUnique:async({where})=>settings.has(where.key)?{key:where.key,value:settings.get(where.key)}:null,findUniqueOrThrow:async({where})=>{if(!settings.has(where.key))throw Error('not found');return {key:where.key,value:settings.get(where.key)}},create:async({data})=>{settings.set(data.key,data.value);return data},update:async({where,data})=>{settings.set(where.key,data.value);return data}},order:{findUniqueOrThrow:async()=>order,update:async({data})=>Object.assign(order,data)},pickupLocation:{findFirst:async()=>({id:1,name:'Shop',contactName:'Store',address1:'Warehouse Road',isActive:true})},shipment:{create:async({data})=>shipment={id:5,...data},findUniqueOrThrow:async()=>shipment,update:async({data})=>Object.assign(shipment,data)},shipmentItem:{createMany:async()=>{}},orderItem:{update:async({data})=>Object.assign(order.orderItems[0],data)},shipmentTrackingEvent:{findFirst:async({where})=>events.find(x=>x.eventTime.getTime()===where.eventTime.getTime()&&x.providerCode===where.providerCode),create:async({data})=>events.push(data)}};
stub('../dist/lib/prisma',{prisma:{...tx,$transaction:async fn=>fn(tx)}});
stub('../dist/services/shipping/provider.service',{credentialsFor:async()=>({config:{mode,publicConfig:{pickupLocationNames:warehouse?{'1':warehouse}:{}}},credentials:{token,clientName:'NM'}})});
let posted;
axios.post=async(url,body)=>{posts++;posted=JSON.parse(new URLSearchParams(body).get('data'));if(timeout)throw Object.assign(Error('timeout'),{isAxiosError:true});return {data:reply||{success:true,packages:[{status:'Success',waybill:'123456789012',refnum:posted.shipments[0].order}]}}};
axios.get=async(url,options)=>{
 if(url.includes('pin-codes'))return {data:{delivery_codes:service?[{postal_code:{pin:400102,remarks:'',cod:'Y',pre_paid:'Y'}}]:[]}};
 if(url.includes('packing_slip'))return {data:{pdf_download_link:'https://carrier.example/label.pdf'}};
 const ref=settings.get('delhivery-booking:1')?.reference;
 return {data:remote||{ShipmentData:[{Shipment:{AWB:'123456789012',ReferenceNo:ref,Status:{Status:'In Transit',StatusType:'UD',StatusDateTime:'2026-01-02T10:00:00'},Scans:[]}}]}};
};
const svc=require('../dist/services/shipping/delhivery.service');
const input={orderId:1,pickupLocationId:1,weightKg:.5,lengthCm:10,widthCm:10,heightCm:5,items:[{orderItemId:10,quantity:2}]};
function reset(){settings.clear();shipment=null;events=[];order.status='Processing';order.orderItems[0].fulfilledQuantity=0;posts=0;timeout=false;reply=null;remote=null;warehouse='NM Mumbai';service=true;mode='LIVE';token='test-only'}
(async()=>{
reset();warehouse='';await assert.rejects(svc.bookDelhivery(input),/warehouse mapping/);assert.equal(posts,0);
reset();service=false;await assert.rejects(svc.bookDelhivery(input),/does not service/);assert.equal(settings.size,0);
reset();await assert.rejects(svc.bookDelhivery({...input,items:[{orderItemId:10,quantity:1}]}),/all order items/);
reset();const first=await svc.bookDelhivery(input);assert.equal(first.awb,'123456789012');assert.equal(posted.shipments[0].weight,500);assert.equal(posted.pickup_location.name,'NM Mumbai');assert.equal('waybill' in posted.shipments[0],false);assert.equal(posted.shipments[0].cod_amount,1000);assert.equal(first.shippingCost,null);
assert.equal((await svc.bookDelhivery(input)).id,first.id);assert.equal(posts,1);
assert.equal(await svc.labelDelhivery(first),'https://carrier.example/label.pdf');
mode='TEST';await assert.rejects(svc.labelDelhivery(first),/original Delhivery/);mode='LIVE';
await svc.syncDelhivery(first.id);assert.equal(shipment.status,'InTransit');assert.equal(events.length,1);await svc.syncDelhivery(first.id);assert.equal(events.length,1);
remote={ShipmentData:[{Shipment:{AWB:'1111111111',ReferenceNo:settings.get('delhivery-booking:1').reference}}]};await assert.rejects(svc.syncDelhivery(first.id),/reconciliation/);
assert.equal(svc.delhiveryStatus('In Transit','RT'),'RTOInTransit');assert.equal(svc.delhiveryStatus('Delivered','RT'),'RTO');assert.equal(svc.delhiveryStatus('Unknown'),undefined);
reset();timeout=true;await assert.rejects(svc.bookDelhivery(input),/Saved Delhivery reference/);assert.equal(posts,1);timeout=false;await svc.bookDelhivery(input);assert.equal(posts,1);assert.equal(shipment.awb,'123456789012');
reset();timeout=true;await assert.rejects(svc.bookDelhivery(input),/Saved Delhivery/);remote={ShipmentData:[]};await assert.rejects(svc.bookDelhivery(input),/awaiting reconciliation/);assert.equal(posts,1);
reset();reply={success:false,rmk:'Client-Warehouse is not active',packages:[]};await assert.rejects(svc.bookDelhivery(input),/Client-Warehouse is not active/);assert.equal(shipment,null);
reset();settings.set('shadowfax-booking:1',{});await assert.rejects(svc.bookDelhivery(input),/saved shadowfax/);assert.equal(posts,0);
console.log('Delhivery booking, AWB, replay, recovery, serviceability, label, tracking, stale account and error checks passed (carrier and database mocked).');
})().catch(e=>{console.error(e);process.exitCode=1});
