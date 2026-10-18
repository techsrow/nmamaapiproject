process.env.JWT_SECRET='isolated-webhook-test-secret';
const assert=require('node:assert/strict');const express=require('express');
let queued=0;const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:{shipment:{findFirst:async()=>({id:1,providerMeta:{clientOrderId:'NM1'}})},storeSetting:{upsert:async()=>{queued++}}}}};
const app=express();app.use(express.json());app.use('/shipping',require('../dist/routes/shippingUnified').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/shipping/webhooks/shadowfax`;
async function post(body,secret){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(secret?{'x-api-key':secret}:{})},body:JSON.stringify(body)})}
try{
 delete process.env.SHADOWFAX_WEBHOOK_SECRET;assert.equal((await post({})).status,401);
 process.env.SHADOWFAX_WEBHOOK_SECRET='x'.repeat(40);assert.equal((await post({},'wrong')).status,401);
 assert.equal((await post({},'x'.repeat(40))).status,400);
 assert.equal((await post({awb_number:'SF1',client_order_id:'OTHER'},'x'.repeat(40))).status,409);
 assert.equal((await post({awb_number:'SF1',client_order_id:'NM1',status:'delivered'},'x'.repeat(40))).status,200);assert.equal(queued,1);
 console.log('5 Shadowfax callback checks passed; authenticated callback queues carrier verification only.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
