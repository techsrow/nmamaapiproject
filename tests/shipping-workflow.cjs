const assert=require('node:assert/strict');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let cfg={enabled:true,notifications:false}, order={salesChannel:'WEB',status:'Confirmed',paymentMethod:'COD',orderItems:[{fulfilledQuantity:0}]},job={id:1,state:'REVIEW',kind:'BOOK',orderId:2},shipment=null,updates=[],audit=[],mailCalls=0;
const tx={shippingJob:{updateMany:async q=>{updates.push(q);return {count:q.where.state===job.state?1:0}},findUniqueOrThrow:async()=>job},shippingAudit:{create:async q=>audit.push(q)},shipment:{findFirst:async()=>shipment}};
const db={...tx,$transaction:async fn=>fn(tx),storeSetting:{findUnique:async()=>({value:cfg})},order:{findUniqueOrThrow:async()=>order},shippingJob:{...tx.shippingJob,upsert:async q=>q}};
stub('../dist/lib/prisma',{prisma:db});
stub('../dist/services/shipping/shipping.service',{createShipment:async()=>{throw Error('must not call carrier')}});
stub('../dist/services/shipping/fulfillment.service',{});stub('../dist/services/shipping/rate.service',{});stub('../dist/services/shipping/shadowfax.service',{});stub('../dist/lib/mailer',{sendMail:async()=>{mailCalls++;throw Error('SMTP connection lost')}});
const w=require('../dist/services/shipping/workflow.service');
(async()=>{
assert.equal(w.eligibleOrder({...order,status:'Pending'}),false);
assert.equal(w.eligibleOrder({...order,salesChannel:'POS'}),false);
assert.equal(w.eligibleOrder({...order,paymentMethod:'Online',paymentStatus:'Pending'}),false);
assert.equal(w.eligibleOrder(order),true);
await assert.rejects(w.retryJob(1,1),/Only BLOCKED/);
await assert.rejects(w.resolveJob(1,1),/Recover/);
shipment={id:4,awb:'ACTUAL'};await w.resolveJob(1,1);assert.equal(updates.at(-1).data.state,'DONE');
order.orderItems[0].fulfilledQuantity=1;await assert.rejects(w.enqueueOrder(2),/unfulfilled/);
job={...job,state:'RUNNING',leaseToken:'lease'};cfg.enabled=false;await w.processJob(job);assert.equal(updates.at(-1).data.state,'BLOCKED');assert.equal(updates.at(-1).where.leaseToken,'lease');
cfg.notifications=true;process.env.SMTP_HOST='mock';process.env.MAIL_FROM='mock@example.com';await w.processJob({...job,kind:'EMAIL',payload:{to:'x',text:'text',subject:'s'}});assert.equal(mailCalls,1);assert.equal(updates.at(-1).data.state,'REVIEW');
await w.expireLeases();assert.equal(updates.at(-1).data.state,'REVIEW');assert.equal(updates.at(-1).data.leaseToken,null);
cfg.notifications=false;await w.processJob({...job,kind:'EMAIL',payload:{to:'x',text:'text',subject:'s',manual:true}});assert.equal(mailCalls,2);assert.equal(updates.at(-1).data.state,'REVIEW');
assert.equal(w.automationSchema.safeParse({enabled:false,notifications:true,providers:['Shadowfax360'],allowFallback:false,pickupLocationId:0,weightKg:0,lengthCm:0,widthCm:0,heightCm:0}).success,true);
console.log('13 shipping workflow guards passed; database, carrier and SMTP mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
