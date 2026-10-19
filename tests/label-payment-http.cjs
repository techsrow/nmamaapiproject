process.env.JWT_SECRET='label-payment-http-test';process.env.PAYMENT_CONFIG_ENCRYPTION_KEY='test-only-encryption-key';
const assert=require('node:assert/strict'),express=require('express'),jwt=require('jsonwebtoken');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let generated=0,downloaded=0,saved,downloadFails=false;
const pdf=Buffer.from('%PDF-1.4\nfixture\n%%EOF\n');
const db={user:{findUnique:async({where})=>({id:where.id,isActive:true,role:where.id===1?'Admin':'Customer',tokenVersion:0})},paymentGatewayConfig:{findUnique:async()=>saved||null,findMany:async()=>[],upsert:async({create})=>(saved={id:1,...create}),updateMany:async()=>({count:1})}};
stub('../dist/lib/prisma',{prisma:db});
stub('../dist/services/shipping/shipping.service',{generateLabel:async id=>{generated++;assert.equal(id,7);return {id,labelUrl:'https://carrier.example/a.pdf'}}});
stub('../dist/services/shipping/labelPdf.service',{downloadLabelPdf:async()=>{downloaded++;if(downloadFails)throw Error("DNS lookup failed");return pdf}});
const app=express();app.use(express.json());app.use('/shipping',require('../dist/routes/shippingUnified').default);app.use('/payments',require('../dist/routes/payments').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;const headers=id=>({Authorization:'Bearer '+jwt.sign({userId:id,tokenVersion:0},process.env.JWT_SECRET),'Content-Type':'application/json'});
try{
 assert.equal((await fetch(base+'/shipping/shipments/7/label-pdf',{method:'POST'})).status,401);
 assert.equal((await fetch(base+'/shipping/shipments/7/label-pdf',{method:'POST',headers:headers(2)})).status,403);assert.equal(generated,0);
 let r=await fetch(base+'/shipping/shipments/7/label-pdf',{method:'POST',headers:headers(1)});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/pdf/);assert.match(r.headers.get('content-disposition'),/shipping-label-7.pdf/);assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await r.arrayBuffer()),pdf);assert.equal(downloaded,1);
 assert.equal((await fetch(base+'/shipping/shipments/-1/label-pdf',{method:'POST',headers:headers(1)})).status,400);assert.equal(generated,1);
 downloadFails=true;r=await fetch(base+'/shipping/shipments/7/label-pdf',{method:'POST',headers:headers(1)});assert.equal(r.status,400);const fallback=await r.json();assert.equal(fallback.labelUrl,'https://carrier.example/a.pdf');assert.match(fallback.message,/DNS/);downloadFails=false;

 const catalog=await(await fetch(base+'/payments/providers/catalog',{headers:headers(1)})).json();assert.equal(catalog.data.length,11);assert.equal(catalog.data.find(x=>x.provider==='Stripe').checkoutImplemented,false);
 for(const method of ['PUT','PATCH']){r=await fetch(base+'/payments/providers/Stripe'+(method==='PATCH'?'/status':''),{method,headers:headers(1),body:JSON.stringify({isEnabled:true})});assert.equal(r.status,400);assert.match((await r.json()).message,/integration is not implemented/)}
 r=await fetch(base+'/payments/providers/Stripe',{method:'PUT',headers:headers(1),body:JSON.stringify({isEnabled:false,credentials:{secretKey:'fixture-secret'},mode:'TEST'})});assert.equal(r.status,200);assert.ok(saved.encryptedCredentials);assert.equal(saved.isEnabled,false);
 r=await fetch(base+'/payments/providers/Stripe/test',{method:'POST',headers:headers(1)});assert.equal(r.status,400);assert.match((await r.json()).message,/integration is not implemented/);
 console.log('Label/payment HTTP: admin authorization, PDF bytes/headers, input validation, 11-provider catalog, unsupported activation/test guards and encrypted configuration save passed; database/carrier mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
