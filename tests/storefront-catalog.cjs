process.env.JWT_SECRET='catalog-test-secret';
const assert=require('node:assert/strict'),express=require('express');let query;
const db={collection:{findUnique:async({where})=>where.slug==='fixture'?{id:1,name:'Fixture collection',isActive:true,type:'MANUAL'}:null},collectionProduct:{findMany:async q=>{query=q;return Array.from({length:q.skip===0?100:5},(_,n)=>({product:{id:q.skip+n+1}}))}}};
const id=require.resolve('../dist/lib/prisma');require.cache[id]={id,filename:id,loaded:true,exports:{prisma:db}};
const app=express();app.use('/catalog',require('../dist/routes/catalogManagement').default);
(async()=>{const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;try{
let response=await fetch(base+'/catalog/collections/fixture?limit=100&page=1'),json=await response.json();assert.equal(json.data.products.length,100);assert.equal(json.data.pagination.hasMore,true);
response=await fetch(base+'/catalog/collections/fixture?limit=100&page=2');json=await response.json();assert.equal(json.data.products.length,5);assert.equal(json.data.products[0].id,101);assert.equal(json.data.pagination.hasMore,false);assert.equal(query.skip,100);assert(query.include.product.include.category);assert(query.include.product.include.productTags);
assert.equal((await fetch(base+'/catalog/collections/missing')).status,404);
const mapper=require('../dist/mappers/product.mapper');const groups=mapper.groupVariantsByColor([{id:1,color:'Pink',size:'S',price:100,stockQuantity:0,trackInventory:false,allowBackorder:true,preorderEnabled:true,images:[]}]);assert.equal(groups[0].sizes[0].allowBackorder,true);assert.equal(groups[0].sizes[0].preorderEnabled,true);assert.equal(groups[0].sizes[0].trackInventory,false);
const p=mapper.mapProductListItem({id:1,name:'Test',slug:'test',variants:[{price:100}],brand:{slug:'namama'},productTags:[{tag:{slug:'summer'}}],createdAt:new Date(0),images:[]},groups);assert.equal(p.brand.slug,'namama');assert.equal(p.productTags[0].tag.slug,'summer');assert(p.createdAt instanceof Date);
console.log('5 storefront catalog HTTP/mapper scenarios passed; database mocked.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}})().catch(e=>{console.error(e);process.exitCode=1});
