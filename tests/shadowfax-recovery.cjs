process.env.JWT_SECRET='shadowfax-recovery-test-only';
const assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken');
let replay;
function inject(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
inject('../dist/lib/prisma',{prisma:{user:{findUnique:async({where})=>({id:where.id,isActive:true,role:where.id===1?'Admin':'Customer',tokenVersion:0})}}});
inject('../dist/services/shipping/shadowfaxBooking.service',{
 shadowfaxBookingStatus:async()=>({hasIntent:true,clientOrderId:'NM-2-saved',mode:'LIVE',state:'PENDING'}),
 retrySavedShadowfax:async(id,expected)=>{replay={id,expected};return {id:77,awb:'SF123'}},
 recoverShadowfax:async()=>{throw Error('Restore the original carrier mode before reconciliation.')}
});
const app=express();app.use(express.json());app.use('/shipping',require('../dist/routes/shippingUnified').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/shipping/shadowfax/orders/2`;const headers=id=>({Authorization:'Bearer '+jwt.sign({userId:id,tokenVersion:0},process.env.JWT_SECRET),'Content-Type':'application/json'});try{
 assert.equal((await fetch(base+'/booking')).status,401);
 assert.equal((await fetch(base+'/booking',{headers:headers(2)})).status,403);
 const status=await fetch(base+'/booking',{headers:headers(1)});assert.equal(status.status,200);assert.equal((await status.json()).data.clientOrderId,'NM-2-saved');
 assert.equal((await fetch(base+'/retry-saved',{method:'POST',headers:headers(2),body:JSON.stringify({expectedClientOrderId:'NM-2-saved'})})).status,403);assert.equal(replay,undefined);
 assert.equal((await fetch(base+'/retry-saved',{method:'POST',headers:headers(1),body:JSON.stringify({expectedClientOrderId:'NM-2-saved'})})).status,200);assert.deepEqual(replay,{id:2,expected:'NM-2-saved'});
 assert.equal((await fetch(base+'/retry-saved',{method:'POST',headers:headers(1),body:JSON.stringify({expectedClientOrderId:''})})).status,409);
 const recovery=await fetch(base+'/recover',{method:'POST',headers:headers(1),body:JSON.stringify({awb:'SF123'})});assert.equal(recovery.status,409);assert.match((await recovery.json()).message,/original carrier mode/);
 console.log('7 Shadowfax recovery authorization/HTTP scenarios passed; services and database mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
