process.env.JWT_SECRET='navigation-test-secret';
const assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken');
let menus=[],sequence=0;
const pages=[{id:1,title:'About',slug:'about',isPublished:true},{id:2,title:'Draft',slug:'draft',isPublished:false}];
const clone=x=>structuredClone(x);
function match(m,w={}) {return Object.entries(w).every(([k,v])=>k==='locations'?(v.has?m.locations.includes(v.has):v.hasSome.some(x=>m.locations.includes(x))):typeof v==='object'&&v?.not?m[k]!==v.not:m[k]===v);}
const db={user:{findUnique:async({where})=>({isActive:true,role:where.id===1?'Admin':'Customer',email:'test@example.com'})},
 cmsPage:{count:async({where})=>pages.filter(p=>where.id.in.includes(p.id)).length,findMany:async({where})=>clone(pages.filter(p=>!where||(where.id.in.includes(p.id)&&p.isPublished)))},
 navigationMenu:{findMany:async({where}={})=>clone(menus.filter(m=>match(m,where))),findFirst:async({where})=>clone(menus.find(m=>match(m,where))||null),findUnique:async({where})=>clone(menus.find(m=>match(m,where))||null),
 update:async({where,data})=>{const m=menus.find(m=>match(m,where));Object.assign(m,clone(data),{updatedAt:new Date(++sequence*1000)});return clone(m)},
 upsert:async({where,create,update})=>{const m=menus.find(m=>match(m,where));if(m)return db.navigationMenu.update({where,data:update});const result={id:menus.length+1,...clone(create),updatedAt:new Date(++sequence*1000)};menus.push(result);return clone(result)},
 delete:async({where})=>{menus=menus.filter(m=>!match(m,where));}},$executeRaw:async()=>1,
 $transaction:async fn=>{const original=clone(menus);try{return await fn(db)}catch(e){menus=original;throw e}}};
const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:db}};
const {default:router,menuSchema}=require('../dist/routes/navigation');
const app=express();app.use(express.json());app.use('/content',router);
const item=(id,extra={})=>({id,label:id,type:'custom',url:'/shop',newTab:false,isActive:true,children:[],...extra});
const body=(extra={})=>({name:'Main menu',items:[item('shop')],locations:['header'],isActive:true,...extra});
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/content`;let count=0;
async function test(name,fn){await fn();console.log('PASS '+name);count++;}
const request=async(path,method='GET',data,role='Admin')=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${jwt.sign({userId:role==='Admin'?1:2,role},process.env.JWT_SECRET)}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,...await response.json()}};
try{
await test('menu administration requires authentication and Admin',async()=>{assert.equal((await request('/navigation','GET',undefined,null)).status,401);assert.equal((await request('/navigation','GET',undefined,'Customer')).status,403)});
await test('create ordered nested menu',async()=>{const r=await request('/navigation/main','PUT',body({items:[item('shop',{children:[item('child')]}),item('about',{type:'page',pageId:1,url:undefined})]}));assert.equal(r.status,200);assert.equal(r.data.items[0].children[0].id,'child')});
await test('public location resolves page URLs and ordered children',async()=>{const r=await request('/navigation/location/header','GET',undefined,null);assert.equal(r.status,200);assert.equal(r.data.items[1].url,'/about');assert.equal(r.data.items[0].children[0].id,'child')});
await test('reject stale update and preserve menu',async()=>{assert.equal((await request('/navigation/main','PUT',body())).status,409);assert.equal(menus[0].items.length,2)});
await test('validated update saves reorder and draft page',async()=>{const r=await request('/navigation/main','PUT',body({expectedUpdatedAt:menus[0].updatedAt.toISOString(),items:[item('draft',{type:'page',pageId:2,url:undefined}),item('z'),item('hidden',{isActive:false})]}));assert.equal(r.status,200)});
await test('public response suppresses draft pages and hidden items',async()=>{assert.deepEqual((await request('/navigation/location/header','GET',undefined,null)).data.items.map(x=>x.id),['z'])});
await test('position reassignment removes previous ownership atomically',async()=>{assert.equal((await request('/navigation/footer-menu','PUT',body({name:'Footer',locations:['header','footer']}))).status,200);assert.deepEqual(menus[0].locations,[]);assert.equal((await request('/navigation/location/header','GET',undefined,null)).data.handle,'footer-menu')});
await test('disabled menu cannot be retrieved by location or legacy handle',async()=>{const m=menus[1];assert.equal((await request('/navigation/footer-menu','PUT',body({name:m.name,isActive:false,locations:m.locations,expectedUpdatedAt:m.updatedAt.toISOString()}))).status,200);assert.equal((await request('/navigation/location/header','GET',undefined,null)).status,404);assert.equal((await request('/cms/navigation/footer-menu','GET',undefined,null)).status,404)});
await test('unsafe URL schemes and protocol-relative links rejected',async()=>{for(const url of ['javascript:alert(1)','data:text/html,test','//evil.example','/\\evil.example','https://user:pass@example.com','/test%0aheader'])assert.equal((await request('/navigation/unsafe','PUT',body({items:[item('bad',{url})]}))).status,400)});
await test('duplicate IDs, excessive depth and item count rejected',async()=>{assert.equal(menuSchema.safeParse(body({items:[item('x'),item('x')]})).success,false);let x=item('5');for(let n=4;n>=1;n--)x=item(String(n),{children:[x]});assert.equal(menuSchema.safeParse(body({items:[x]})).success,false);assert.equal(menuSchema.safeParse(body({items:Array.from({length:201},(_,n)=>item(String(n)))})).success,false)});
await test('missing page blocks save without stealing a location',async()=>{assert.equal((await request('/navigation/missing','PUT',body({items:[item('missing',{type:'page',pageId:999})]}))).status,400);assert(menus[1].locations.includes('header'))});
await test('invalid handles and positions rejected',async()=>{assert.equal((await request('/navigation/Bad_Handle','PUT',body())).status,400);assert.equal((await request('/navigation/valid','PUT',body({locations:['unknown']}))).status,400)});
await test('admin can list draft pages and all inactive menus',async()=>{assert.equal((await request('/navigation/pages')).data.length,2);assert.equal((await request('/navigation')).data.length,2);assert((await request('/navigation/locations')).data.includes('footer'))});
await test('stale deletion blocked, confirmed deletion clears assignment',async()=>{assert.equal((await request('/navigation/footer-menu','DELETE',{expectedUpdatedAt:new Date(0).toISOString()})).status,409);assert.equal((await request('/navigation/footer-menu','DELETE',{expectedUpdatedAt:menus[1].updatedAt.toISOString()})).status,200);assert.equal((await request('/navigation/location/footer','GET',undefined,null)).status,404)});
await test('public handle compatibility route resolves active menu',async()=>{assert.equal((await request('/cms/navigation/main','GET',undefined,null)).status,200)});
console.log(`${count} navigation HTTP/schema scenarios passed; database mocked.`);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
