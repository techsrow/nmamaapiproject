process.env.JWT_SECRET='storefront-customer-test-secret';
const assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken'),bcrypt=require('bcrypt');
let user={id:1,email:'test@example.com',role:'Customer',isActive:true,tokenVersion:0,passwordHash:bcrypt.hashSync('old-password',4)},guestItems=[{variantId:10,quantity:2}],accountItems=[],stock=10,orderQuery;
const variant={id:10,isActive:true,trackInventory:true,allowBackorder:false,preorderEnabled:false,product:{isActive:true}};
const db={user:{findUnique:async()=>({...user}),updateMany:async({where,data})=>{if(user.passwordHash!==where.passwordHash)return {count:0};user.passwordHash=data.passwordHash;user.tokenVersion++;return {count:1}}},
guestCart:{findUnique:async({where})=>where.token==='guest-token-1234567890'?{id:2,token:where.token,items:structuredClone(guestItems)}:null,update:async()=>({})},
guestCartItem:{deleteMany:async()=>{guestItems=[];return {count:2}}},
cartItem:{findUnique:async()=>accountItems[0]||null,findMany:async()=>structuredClone(accountItems),upsert:async({create,update})=>{if(accountItems.length)accountItems[0].quantity=update.quantity;else accountItems=[{...create,variant:{...variant,price:100,stockQuantity:stock}}];return accountItems[0]}},
productVariant:{findUnique:async()=>({...variant,stockQuantity:stock})},$executeRaw:async()=>1,
order:{findMany:async q=>{orderQuery=q;return []}}};
let queue=Promise.resolve();db.$transaction=fn=>{const result=queue.then(async()=>{const before=structuredClone({guestItems,accountItems});try{return await fn(db)}catch(e){guestItems=before.guestItems;accountItems=before.accountItems;throw e}});queue=result.catch(()=>{});return result};
const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:db}};
const app=express();app.use(express.json());app.use('/account',require('../dist/routes/customerAccount').default);app.use('/cart',require('../dist/routes/cartV2').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;let count=0;
const token=version=>jwt.sign({userId:1,role:'Customer',tokenVersion:version},process.env.JWT_SECRET);
const request=async(path,method='GET',body,version=0)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token(version)}`},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,...await r.json()}};
const check=async(name,fn)=>{await fn();console.log('PASS '+name);count++};
try{
await check('guest merge is replay safe and consumes guest items once',async()=>{assert.equal((await request('/cart/merge','POST',{cartToken:'guest-token-1234567890'})).status,200);assert.equal((await request('/cart/merge','POST',{cartToken:'guest-token-1234567890'})).status,200);assert.equal(accountItems[0].quantity,2);assert.equal(guestItems.length,0)});
await check('merge stock failure rolls back both carts',async()=>{guestItems=[{variantId:10,quantity:9}];assert.equal((await request('/cart/merge','POST',{cartToken:'guest-token-1234567890'})).status,400);assert.equal(guestItems[0].quantity,9);assert.equal(accountItems[0].quantity,2)});
await check('add checks accumulated quantity instead of only increment',async()=>{stock=3;assert.equal((await request('/cart/items','POST',{variantId:10,quantity:2})).status,400);assert.equal(accountItems[0].quantity,2)});
await check('order history is scoped to current user and excludes payment secrets',async()=>{assert.equal((await request('/account/orders')).status,200);assert.equal(orderQuery.where.userId,1);assert.equal(orderQuery.select.payments,undefined);assert.equal(orderQuery.select.internalNotes,undefined);assert.equal(orderQuery.take,200)});
await check('incorrect current password cannot change credentials',async()=>{assert.equal((await request('/account/password','POST',{currentPassword:'bad',newPassword:'new-password'})).status,400);assert.equal(user.tokenVersion,0)});
await check('password change revokes old signed tokens',async()=>{assert.equal((await request('/account/password','POST',{currentPassword:'old-password',newPassword:'new-password'})).status,200);assert(await bcrypt.compare('new-password',user.passwordHash));assert.equal(user.tokenVersion,1);assert.equal((await request('/account/orders')).status,401);assert.equal((await request('/account/orders','GET',undefined,1)).status,200)});
console.log(`${count} customer/cart HTTP scenarios passed; Prisma mocked, bcrypt/JWT real.`);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
