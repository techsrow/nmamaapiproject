const assert=require('node:assert/strict');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let s={id:1,orderId:2,provider:'Shadowfax360',status:'AwbAssigned',awb:'SF39482317350'},o={id:2,customerName:'Asif <test>',customerEmail:'customer@example.com'},jobs=new Map();
const db={shipment:{findUniqueOrThrow:async()=>s},order:{findUniqueOrThrow:async()=>o},shippingJob:{upsert:async({where,create})=>{if(!jobs.has(where.key))jobs.set(where.key,{id:jobs.size+1,state:'QUEUED',...create});return jobs.get(where.key)},updateMany:async()=>({count:1})}};stub('../dist/lib/prisma',{prisma:db});
const {shippingEmail,queueShipmentEmail}=require('../dist/services/shipping/notification.service');
(async()=>{const mail=shippingEmail(o,s);assert.match(mail.text,/Hi Asif <test>/);assert.match(mail.text,/SF39482317350/);assert.match(mail.html,/Asif &lt;test&gt;/);assert.match(mail.html,/https:\/\/www.shadowfax.in\/track/);assert.ok(!mail.text.includes('has been picked up'));
 const a=await queueShipmentEmail(1,true),b=await queueShipmentEmail(1,true);assert.equal(a.jobId,b.jobId);assert.equal(jobs.size,1);assert.equal(jobs.values().next().value.payload.manual,true);
 s={...s,status:'Delivered'};assert.match(shippingEmail(o,s).text,/marked as delivered/);await queueShipmentEmail(1);assert.equal(jobs.size,2);
 s={...s,trackingUrl:'javascript:alert(1)'};assert.ok(!shippingEmail(o,s).html.includes('javascript:'));
 s={...s,awb:null};await assert.rejects(queueShipmentEmail(1),/AWB/);s.awb='SF123';o.customerEmail=null;await assert.rejects(queueShipmentEmail(1),/valid customer email/);o.user={email:'registered@example.com'};await queueShipmentEmail(1);
 console.log('Shipping notification greeting/tracking, HTML escaping, unsafe URL, missing email/AWB, registered fallback and per-status duplicate checks passed (database mocked).');
})().catch(e=>{console.error(e);process.exitCode=1});
