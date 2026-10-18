const assert=require('node:assert/strict');
let state,ship,remoteCalls=0,fail=false,mode='TEST',enabled=true;
const {ShadowfaxBookingError}=require('../dist/services/shipping/shadowfaxError');
let order;
function reset(){state=null;ship=null;remoteCalls=0;fail=false;mode='TEST';enabled=true;order={id:1,status:'Confirmed',paymentMethod:'COD',paymentStatus:'Pending',totalAmount:1120,shippingFee:120,paidAmount:0,customerName:'Test',guestPhone:'9999999999',shippingAddress:'Test street',shippingCity:'Mumbai',shippingPostalCode:'400001',shippingAddressJson:{state:'Maharashtra'},orderItems:[{id:2,variantId:3,sku:'SKU',productName:'Test',unitPrice:500,quantity:2,fulfilledQuantity:0}]};}
const db={
 $queryRaw:async()=>[],
 storeSetting:{findUnique:async({where})=>where.key.startsWith('shadowfax-booking:')&&state?{key:'shadowfax-booking:1',value:state}:null,findUniqueOrThrow:async()=>{if(!state)throw Error('missing');return {key:'shadowfax-booking:1',value:state}},create:async({data})=>{state=data.value;return data},update:async({data})=>{state=data.value}},
 order:{findUniqueOrThrow:async()=>order,update:async({data})=>Object.assign(order,data)},
 shipment:{count:async()=>ship?1:0,create:async({data})=>(ship={id:5,...data}),findUniqueOrThrow:async()=>ship},
 pickupLocation:{findFirst:async()=>({id:10,name:'Store',address1:'Shop street',city:'Mumbai',phone:'9999999998',pincode:'400002'})},
 shipmentItem:{createMany:async()=>{}},orderItem:{update:async({data})=>Object.assign(order.orderItems[0],data)}
};
db.$transaction=async fn=>{const snapshot=structuredClone({state,ship,order});try{return await fn(db)}catch(e){({state,ship,order}=snapshot);throw e}};
function inject(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports}}
inject('../dist/lib/prisma',{prisma:db});
inject('../dist/services/shipping/provider.service',{credentialsFor:async()=>({config:{mode,publicConfig:{enableBooking:enabled,productCategory:'Clothing'}}})});
const remote=()=>({id:42,client_order_id:state.clientOrderId,awb_number:'SF123',product_value:state.payload.order_details.product_value,cod_amount:state.payload.order_details.cod_amount,pickup_details:state.payload.pickup_details});
inject('../dist/services/shipping/shadowfax.service',{createShadowfaxOrder:async()=>{remoteCalls++;if(fail==='rejected')throw new ShadowfaxBookingError('Carrier rejected postcode.',true);if(fail)throw Error('timeout');return remote()},trackShadowfax:async()=>({order_details:remote()})});
const {bookShadowfax,recoverShadowfax,retrySavedShadowfax,shadowfaxBookingStatus}=require('../dist/services/shipping/shadowfaxBooking.service');
(async()=>{
 reset();enabled=false;await assert.rejects(bookShadowfax({orderId:1}),/Enable/);assert.equal(remoteCalls,0);
 reset();assert.equal((await bookShadowfax({orderId:1})).awb,'SF123');assert.equal(order.status,'Processing');assert.equal(order.orderItems[0].fulfilledQuantity,2);assert.equal(state.payload.order_details.product_value,1000);assert.equal(state.payload.order_details.cod_amount,1120);
 assert.equal((await bookShadowfax({orderId:1})).id,5);assert.equal(remoteCalls,1);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}),/timeout/);assert.equal(state.state,'PENDING');await assert.rejects(bookShadowfax({orderId:1}),/reconciliation/);assert.equal(remoteCalls,1);
 assert.equal((await recoverShadowfax(1,'SF123')).id,5);assert.equal(remoteCalls,1);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));mode='LIVE';await assert.rejects(recoverShadowfax(1,'SF123'),/original carrier mode/);assert.equal(ship,null);
 reset();await assert.rejects(bookShadowfax({orderId:1,items:[]}),/complete unfulfilled/);
 reset();order.paymentMethod='Razorpay';await assert.rejects(bookShadowfax({orderId:1}),/Only paid/);assert.equal(remoteCalls,0);
 reset();order.totalAmount=60000;await assert.rejects(bookShadowfax({orderId:1}),/High-value/);assert.equal(remoteCalls,0);
 reset();order.totalAmount=60000;await bookShadowfax({orderId:1,ewayBill:'123456789012',sellerGstin:'27ABCDE1234F1Z5',weightKg:1});assert.equal(state.payload.order_details.eway_bill,'123456789012');assert.equal(state.payload.product_details[0].price,500);assert.equal(state.payload.product_details[0].additional_details.quantity,2);
 reset();await assert.rejects(bookShadowfax({orderId:1,pickupDate:'2026-02-30',pickupSlot:'slot_1'}),/Invalid/);assert.equal(remoteCalls,0);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));const original=JSON.stringify(state.payload),clientId=state.clientOrderId;fail=false;await retrySavedShadowfax(1,clientId);assert.equal(remoteCalls,2);assert.equal(JSON.stringify(state.payload),original);assert.equal(ship.awb,'SF123');
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));await assert.rejects(retrySavedShadowfax(1,'stale-id'),/changed/);assert.equal(remoteCalls,1);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));mode='LIVE';await assert.rejects(retrySavedShadowfax(1,state.clientOrderId),/original carrier mode/);assert.equal(remoteCalls,1);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));state.retryUntil=new Date(Date.now()+90000).toISOString();await assert.rejects(retrySavedShadowfax(1,state.clientOrderId),/already running/);assert.equal(remoteCalls,1);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));order.totalAmount=1200;await assert.rejects(retrySavedShadowfax(1,state.clientOrderId),/amounts or items/);assert.equal(remoteCalls,1);
 reset();fail='rejected';await assert.rejects(bookShadowfax({orderId:1}));assert.equal(state.lastError.kind,'CARRIER_REJECTED');const diagnostic=await shadowfaxBookingStatus(1);assert.equal(diagnostic.lastError.message,'Carrier rejected postcode.');assert.equal('payload' in diagnostic,false);assert.equal('credentials' in diagnostic,false);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));await assert.rejects(retrySavedShadowfax(1,state.clientOrderId),/timeout/);assert.equal(state.lastError.kind,'UNCERTAIN');assert.equal(state.retryUntil,null);assert.equal(state.shipmentId,undefined);
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));await assert.rejects(recoverShadowfax(1,state.clientOrderId),/not an AWB/);assert.equal(remoteCalls,1);
 reset();fail='rejected';await assert.rejects(bookShadowfax({orderId:1}));state.payload.pickup_details.pincode=400050;const savedId=state.clientOrderId;const savedError=state.lastError.at;fail=false;
 await retrySavedShadowfax(1,savedId,{pickupLocationId:10,expectedErrorAt:savedError});assert.equal(state.clientOrderId,savedId);assert.equal(state.payload.pickup_details.pincode,400002);assert.equal(state.payload.return_details.pincode,400002);assert.equal(state.corrections[0].previousPickup.pincode,400050);assert.equal(ship.awb,'SF123');
 reset();fail=true;await assert.rejects(bookShadowfax({orderId:1}));await assert.rejects(retrySavedShadowfax(1,state.clientOrderId,{pickupLocationId:10,expectedErrorAt:state.lastError.at}),/explicitly rejected/);assert.equal(remoteCalls,1);
 reset();fail='rejected';await assert.rejects(bookShadowfax({orderId:1}));await assert.rejects(retrySavedShadowfax(1,state.clientOrderId,{pickupLocationId:10,expectedErrorAt:'stale'}),/explicitly rejected/);assert.equal(remoteCalls,1);
 reset();fail='rejected';await assert.rejects(bookShadowfax({orderId:1}));const at=state.lastError.at;fail=true;await assert.rejects(retrySavedShadowfax(1,state.clientOrderId,{pickupLocationId:10,expectedErrorAt:at}),/timeout/);assert.equal(state.lastError.kind,'UNCERTAIN');assert.equal(state.pickupCorrected,true);
 console.log('23 Shadowfax booking/replay checks passed; transactions and carrier mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
