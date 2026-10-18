process.env.JWT_SECRET='admin-operations-test-only';
const assert=require('node:assert/strict'),jwt=require('jsonwebtoken'),express=require('express');
const id=require.resolve('../dist/lib/prisma');let writes=0;require.cache[id]={id,filename:id,loaded:true,exports:{prisma:{user:{findUnique:async({where})=>({isActive:true,role:where.id===1?'Admin':'Customer',email:'test@example.com'})},returnRequest:{findMany:async()=>[{id:1,status:'REQUESTED'}]},returnPolicy:{findMany:async()=>[],create:async({data})=>{writes++;return {id:1,...data}},update:async({data})=>({id:1,...data})},fraudCheck:{findMany:async()=>[]}}}};
const app=express();app.use(express.json());app.use('/api',require('../dist/routes/adminOperations').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api`;const token=role=>jwt.sign({userId:role==='Admin'?1:2,role},process.env.JWT_SECRET);const headers=role=>({'Content-Type':'application/json',Authorization:`Bearer ${token(role)}`});try{
 assert.equal((await fetch(base+'/commerce/returns')).status,401);
 assert.equal((await fetch(base+'/commerce/returns',{headers:headers('Customer')})).status,403);
 assert.equal((await fetch(base+'/commerce/returns',{headers:headers('Admin')})).status,200);
 assert.equal((await fetch(base+'/commerce/returns/policies',{method:'POST',headers:headers('Admin'),body:JSON.stringify({name:'Invalid'})})).status,400);assert.equal(writes,0);
 assert.equal((await fetch(base+'/commerce/returns/policies',{method:'POST',headers:headers('Admin'),body:JSON.stringify({name:'Standard',daysFromDelivery:7,allowReturn:true,allowExchange:true,reversePickup:true,refundMethods:['ORIGINAL'],isActive:true})})).status,201);assert.equal(writes,1);
 assert.equal((await fetch(base+'/platform/security/fraud?limit=999',{headers:headers('Admin')})).status,400);
 console.log('6 admin companion HTTP checks passed; database mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
