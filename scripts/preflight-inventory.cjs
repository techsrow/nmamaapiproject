require('dotenv/config');
const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();
(async()=>{
 const duplicates=await db.$queryRaw`SELECT barcode, array_agg(id) AS ids, count(*)::int AS count FROM "ProductVariant" WHERE barcode IS NOT NULL GROUP BY barcode HAVING count(*)>1`;
 const mismatches=await db.$queryRaw`SELECT v.id, v."stockQuantity" AS available, sum(w.quantity)::int AS allocated, sum(w.reserved)::int AS reserved FROM "ProductVariant" v JOIN "WarehouseInventory" w ON w."variantId"=v.id GROUP BY v.id HAVING sum(w.quantity)<>v."stockQuantity" OR sum(w.reserved)<>0`;
 const negative=await db.productVariant.findMany({where:{stockQuantity:{lt:0}},select:{id:true,stockQuantity:true}});
 console.log(JSON.stringify({duplicateBarcodes:duplicates,warehouseMismatches:mismatches,negativeStock:negative},null,2));
 if(duplicates.length||mismatches.length||negative.length){console.error('Preflight requires stock/barcode review. No data changed.');process.exitCode=1;}
 else console.log('Inventory preflight passed. Existing variants without warehouse allocations will be adopted into SYSTEM-UNALLOCATED on their next stock change. Allocate store stock before enabling POS.');
})().catch(e=>{console.error('Preflight failed:',e.code||e.name);process.exitCode=1}).finally(()=>db.$disconnect());
