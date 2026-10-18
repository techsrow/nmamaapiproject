process.env.JWT_SECRET='return-guards-test-only';
const assert=require('node:assert/strict'),jwt=require('jsonwebtoken'),express=require('express');
let status='REQUESTED',booking=null,writes=0,credit=0;
const tx={$queryRaw:async()=>[],returnRequest:{findUniqueOrThrow:async()=>({id:1,userId:1,status,refundAmount:100}),update:async({data})=>{writes++;if(data.status)status=data.status;return data}},storeSetting:{findUnique:async()=>booking},storeCreditTransaction:{findFirst:async()=>null,create:async()=>{}},storeCreditAccount:{upsert:async()=>{credit++;return {balance:100}}}};
const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:{...tx,$transaction:async fn=>fn(tx),user:{findUnique:async()=>({isActive:true,role:'Admin'})}}}};
const payment=require.resolve('../dist/services/payments/paymentService');require.cache[payment]={id:payment,filename:payment,loaded:true,exports:{}};
const app=express();app.use(express.json());app.use(require('../dist/routes/commerce913').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;const headers={'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({userId:1,role:'Admin'},process.env.JWT_SECRET)}`};const patch=body=>fetch(base+'/returns/1',{method:'PATCH',headers,body:JSON.stringify(body)});const refund=amount=>fetch(base+'/returns/1/store-credit',{method:'POST',headers,body:JSON.stringify({amount})});try{
assert.equal((await patch({reversePickup:{awb:'fake'}})).status,400);
assert.equal((await patch({status:'RECEIVED'})).status,400);
assert.equal((await patch({refundAmount:-1})).status,400);assert.equal(writes,0);
assert.equal((await patch({status:'APPROVED'})).status,200);
booking={};assert.equal((await patch({status:'REJECTED'})).status,400);booking=null;
assert.equal((await refund(100)).status,400);
status='RECEIVED';assert.equal((await refund(101)).status,400);assert.equal((await refund(0)).status,400);
assert.equal((await refund(100)).status,200);assert.equal(credit,1);
assert.equal((await refund(100)).status,400);assert.equal(credit,1);
console.log('10 return lifecycle/credit HTTP checks passed; database mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
