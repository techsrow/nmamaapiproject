process.env.JWT_SECRET='pos-tests-only';
const assert=require('node:assert/strict');let state,queue=Promise.resolve();
const reset=()=>{state={variants:[{id:1,productId:1,isActive:true,trackInventory:true,allowBackorder:false,preorderEnabled:false,stockQuantity:5,price:100,discountPrice:null,sku:'PINK-4Y',barcode:'2000000000015',size:'4Y',color:'Pink',product:{id:1,name:'Dress',isActive:true,hsnSac:'6204'}}],warehouse:[{warehouseId:2,variantId:1,quantity:5,reserved:0}],sessions:[{id:1,cashierId:7,warehouseId:2,closedAt:null}],orders:[],items:[],sales:[],returns:[],payments:[],refunds:[],seq:0,tax:[{id:1,country:'IN',region:null,hsnSac:null,rate:18,inclusive:true,name:'GST'}]}};
const match=(rows,w)=>rows.find(r=>Object.entries(w).every(([k,v])=>r[k]===v));
const db={
 $queryRaw:async()=>[],
 $transaction:fn=>{const run=queue.then(async()=>{const before=structuredClone(state);try{return await fn(db)}catch(e){state=before;throw e}});queue=run.catch(()=>{});return run},
 posSession:{findUnique:async({where})=>match(state.sessions,where),findUniqueOrThrow:async({where})=>match(state.sessions,where)},
 warehouse:{findUnique:async()=>({id:2,isActive:true,address:{country:'IN',state:'Maharashtra'}})},
 productVariant:{findMany:async({where})=>state.variants.filter(v=>where.id.in.includes(v.id)),findUnique:async({where})=>match(state.variants,where),update:async({where,data})=>{const v=match(state.variants,where);v.stockQuantity+=data.stockQuantity.increment;const w=state.warehouse.find(w=>w.variantId===v.id);w.quantity+=data.stockQuantity.increment;return v}},
 warehouseInventory:{findMany:async()=>state.warehouse},taxRule:{findMany:async()=>state.tax},storeSetting:{findUnique:async()=>({value:{name:'Namama'}})},
 user:{findUnique:async({where})=>({isActive:true,role:where.id===7?'Admin':'Customer'})},
 invoiceSequence:{upsert:async()=>({nextNumber:++state.seq+1})},
 order:{create:async({data})=>{const {orderItems,...order}=data;order.id=state.orders.length+1;order.refundedAmount=0;state.orders.push(order);for(const l of orderItems.create)state.items.push({...l,id:state.items.length+1,orderId:order.id,returnedQuantity:0,refundedQuantity:0});return {...order,orderItems:state.items.filter(i=>i.orderId===order.id)}},findUnique:async({where})=>match(state.orders,where),findUniqueOrThrow:async({where})=>{const o=match(state.orders,where);return {...o,orderItems:state.items.filter(i=>i.orderId===o.id)}},update:async({where,data})=>Object.assign(match(state.orders,where),data)},
 orderItem:{update:async({where,data})=>{const row=match(state.items,where);for(const [key,value] of Object.entries(data))row[key]+=value.increment;return row}},
 creditNote:{create:async()=>({})},
 payment:{findFirst:async()=>null,create:async({data})=>{state.payments.push(data);return data}},paymentRefund:{create:async({data})=>{state.refunds.push(data);return data}},
 posSale:{findUnique:async({where})=>match(state.sales,where),create:async({data})=>{const row={...data,id:state.sales.length+1};state.sales.push(row);return row}},
 posReturn:{findUnique:async({where})=>match(state.returns,where),create:async({data})=>{const row={...data,id:state.returns.length+1};state.returns.push(row);return row}},activityLog:{create:async()=>({})}
};
const key=require.resolve('../dist/lib/prisma');require.cache[key]={id:key,filename:key,loaded:true,exports:{prisma:db}};
const {preparePos,completePos,returnPos,saleSchema,returnSchema}=require('../dist/services/pos/pos.service');const barcode=require('../dist/services/pos/barcode');
const body=()=>saleSchema.parse({sessionId:1,items:[{variantId:1,quantity:2}],expectedTotal:200,tenders:[{method:'CASH',amount:200}],paymentReceived:true});
let count=0;async function test(name,fn){reset();await fn();count++;console.log('PASS '+name)}
(async()=>{
 await test('server price, inclusive tax, no shipping',async()=>{const q=await preparePos(body(),7);assert.equal(q.total,200);assert.equal(q.includedTax,30.51);assert.equal(q.shippingCharge,0)});
 await test('exclusive tax and discounts use server rules',async()=>{state.tax[0].inclusive=false;const q=await preparePos({...body(),discount:20},7);assert.equal(q.total,212.4);assert.equal(q.tax,32.4)});
 await test('sale creates one bill, deducts variant and warehouse once',async()=>{const r=await completePos(body(),7,'key1');assert.equal(r.order.salesChannel,'POS');assert.equal(state.variants[0].stockQuantity,3);assert.equal(state.warehouse[0].quantity,3);assert.equal(state.payments.length,1)});
 await test('same request key reuses bill, changed body is rejected',async()=>{await completePos(body(),7,'key1');assert.equal((await completePos(body(),7,'key1')).reused,true);await assert.rejects(completePos({...body(),customerName:'Changed'},7,'key1'),/another bill/);assert.equal(state.orders.length,1)});
 await test('wrong cashier and closed session rejected',async()=>{await assert.rejects(preparePos(body(),8),/open POS session/);state.sessions[0].closedAt=new Date();await assert.rejects(preparePos(body(),7),/open POS session/)});
 await test('underpaid and stale quote do not deduct stock',async()=>{await assert.rejects(completePos({...body(),tenders:[{method:'CASH',amount:199}]},7,'k'),/allocations/);await assert.rejects(completePos({...body(),expectedTotal:201},7,'k'),/changed/);assert.equal(state.variants[0].stockQuantity,5);assert.equal(state.orders.length,0)});
 await test('unallocated and unavailable stock rejected',async()=>{state.warehouse[0].quantity=1;await assert.rejects(preparePos(body(),7),/allocated stock/);state.warehouse[0].quantity=5;state.variants[0].stockQuantity=1;await assert.rejects(preparePos(body(),7),/Insufficient stock/)});
 await test('UPI reference and explicit collection required',async()=>{await assert.rejects(completePos({...body(),tenders:[{method:'UPI',amount:200}]},7,'k'),/reference/);assert.equal(saleSchema.safeParse({...body(),paymentReceived:false}).success,false)});
 await test('duplicate product lines rejected',async()=>{await assert.rejects(preparePos({...body(),items:[{variantId:1,quantity:1},{variantId:1,quantity:1}]},7),/duplicate/)});
 await test('partial return is idempotent and restocks once',async()=>{await completePos(body(),7,'s');const b=returnSchema.parse({sessionId:1,items:[{orderItemId:1,quantity:1,restock:true}],method:'CASH',reason:'Size return',refundPaid:true});const r=await returnPos(1,b,7,'r');assert.equal(r.amount,100);await returnPos(1,b,7,'r');assert.equal(state.variants[0].stockQuantity,4);assert.equal(state.refunds.length,1);assert.equal(state.orders[0].paymentStatus,'PartiallyRefunded');await returnPos(1,b,7,'r2');assert.equal(state.orders[0].paymentStatus,'Refunded');assert.equal(state.orders[0].paymentDue,0);await assert.rejects(returnPos(1,b,7,'r3'),/quantity/)});
 await test('damaged return refunds without restocking',async()=>{await completePos(body(),7,'s');const b=returnSchema.parse({sessionId:1,items:[{orderItemId:1,quantity:2,restock:false}],method:'CASH',reason:'Damaged item',refundPaid:true});await returnPos(1,b,7,'r');assert.equal(state.variants[0].stockQuantity,3);assert.equal(state.orders[0].status,'Returned')});
 await test('barcodes stable unique checksummed and printable',async()=>{const a=barcode.barcodeForVariant(1),b=barcode.barcodeForVariant(2);assert.equal(a,'2000000000015');assert.notEqual(a,b);assert.equal(barcode.checkDigit('400638133393'),'1');assert.match(barcode.barcodeSvg(a),/<svg/);assert.throws(()=>barcode.barcodeSvg('2000000000016'));assert.throws(()=>barcode.barcodeForVariant(0))});
 await test('HTTP scan requires current staff authorization, not a forged/stale role',async()=>{
 const express=require('express'),jwt=require('jsonwebtoken');const app=express();app.use(express.json());app.use('/pos',require('../dist/routes/pos').default);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/pos/scan/2000000000015`;
 try {assert.equal((await fetch(url)).status,401);
 const token=id=>jwt.sign({userId:id,role:'Admin'},process.env.JWT_SECRET);
 assert.equal((await fetch(url,{headers:{Authorization:`Bearer ${token(8)}`}})).status,403);
 const result=await fetch(url,{headers:{Authorization:`Bearer ${token(7)}`}});assert.equal(result.status,200);assert.equal((await result.json()).data.id,1);
 }finally{server.close();}
 });
 console.log(`${count} POS/barcode checks passed; Prisma operations mocked. Database trigger tested separately.`);
})().catch(e=>{console.error(e);process.exitCode=1});
