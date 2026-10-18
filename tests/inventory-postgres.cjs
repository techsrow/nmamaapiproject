// Test-only dependency: npm install --prefix /tmp/nm-pos-test @electric-sql/pglite@0.5.10
// PGLITE_MODULE=/tmp/nm-pos-test/node_modules/@electric-sql/pglite BASELINE_SQL=/path/to/baseline.sql node tests/inventory-postgres.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();let checks=0;
const check=(a,b)=>{assert.deepEqual(a,b);checks++};
(async()=>{
 await db.exec(fs.readFileSync(process.env.BASELINE_SQL||path.join(__dirname,'fixtures/pre-pos-schema.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261015140000_inventory_pos/migration.sql'),'utf8'));
 await db.exec(`INSERT INTO "Product" (name,slug,"updatedAt") VALUES ('Test','test',now()); INSERT INTO "ProductVariant" ("productId",price,"stockQuantity","updatedAt") VALUES (1,100,10,now());`);
 let r=await db.query('SELECT quantity FROM "WarehouseInventory" WHERE "variantId"=1');check(r.rows[0].quantity,10);
 await db.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"-2 WHERE id=1;`);
 check((await db.query('SELECT sum(quantity)::int AS q FROM "WarehouseInventory" WHERE "variantId"=1')).rows[0].q,8);
 await assert.rejects(db.exec(`UPDATE "ProductVariant" SET "stockQuantity"=-1 WHERE id=1`),/negative/);checks++;
 check((await db.query('SELECT "stockQuantity" FROM "ProductVariant" WHERE id=1')).rows[0].stockQuantity,8);
 await db.exec(`INSERT INTO "Warehouse" (id,name,code) VALUES (100,'Store','STORE');`);
 await db.transaction(async tx=>{
  await tx.query(`SELECT set_config('namama.stock_context',$1,true)`,[JSON.stringify({warehouseId:100,type:'IN',referenceType:'PURCHASE_ORDER',referenceId:'9',userId:1})]);
  await tx.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"+5 WHERE id=1`);
 });
 check((await db.query('SELECT quantity FROM "WarehouseInventory" WHERE "variantId"=1 AND "warehouseId"=100')).rows[0].quantity,5);
 const context=await db.query(`SELECT "referenceType","referenceId",type,"createdById" FROM "InventoryMovement" ORDER BY id DESC LIMIT 1`);check(context.rows[0],{referenceType:'PURCHASE_ORDER',referenceId:'9',type:'IN',createdById:1});
 await assert.rejects(db.transaction(async tx=>{await tx.query(`SELECT set_config('namama.stock_context',$1,true)`,[JSON.stringify({warehouseId:100,type:'SALE'})]);await tx.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"-6 WHERE id=1`)}),/Insufficient/);checks++;
 check((await db.query('SELECT "stockQuantity" FROM "ProductVariant" WHERE id=1')).rows[0].stockQuantity,13);
 await db.exec(`UPDATE "WarehouseInventory" SET quantity=4 WHERE "variantId"=1 AND "warehouseId"=100`);
 await assert.rejects(db.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"-1 WHERE id=1`),/mismatch/);checks++;
 await db.exec(`UPDATE "WarehouseInventory" SET quantity=5,reserved=1 WHERE "variantId"=1 AND "warehouseId"=100`);
 await assert.rejects(db.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"-1 WHERE id=1`),/reservations/);checks++;
 await db.exec(`UPDATE "WarehouseInventory" SET reserved=0 WHERE "variantId"=1 AND "warehouseId"=100`);
 await db.transaction(async tx=>{
  await tx.query(`SELECT set_config('namama.stock_context',$1,true)`,[JSON.stringify({warehouseId:100,type:'SALE',referenceType:'POS_ORDER',referenceId:'1'})]);
  await tx.exec(`UPDATE "ProductVariant" SET "stockQuantity"="stockQuantity"-3 WHERE id=1`);
 });
 check((await db.query('SELECT quantity FROM "WarehouseInventory" WHERE "variantId"=1 AND "warehouseId"=100')).rows[0].quantity,2);
 check((await db.query('SELECT "stockQuantity" FROM "ProductVariant" WHERE id=1')).rows[0].stockQuantity,10);
 await db.exec(`UPDATE "ProductVariant" SET barcode='2000000000015' WHERE id=1;`);
 await assert.rejects(db.exec(`INSERT INTO "ProductVariant" ("productId",price,"stockQuantity","updatedAt",barcode) VALUES (1,100,2,now(),'2000000000015')`),/unique/);checks++;
 await db.exec(`INSERT INTO "User" ("firstName","lastName",email,"updatedAt") VALUES ('Test','Cashier','cashier@example.test',now()); INSERT INTO "PosSession" ("cashierId","warehouseId","openingCash") VALUES (1,100,100);`);
 await assert.rejects(db.exec(`INSERT INTO "PosSession" ("cashierId","warehouseId","openingCash") VALUES (1,100,0)`),/unique/);checks++;
 await db.exec(`UPDATE "PosSession" SET "closedAt"=now() WHERE id=1;INSERT INTO "PosSession" ("cashierId","warehouseId","openingCash") VALUES (1,100,0)`);checks++;
 console.log(`${checks} embedded PostgreSQL migration/trigger checks passed. Single connection; not a production load test.`);
 await db.close();
})().catch(async e=>{console.error(e.message);await db.close();process.exitCode=1});
