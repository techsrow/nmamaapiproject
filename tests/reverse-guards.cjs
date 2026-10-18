const assert=require('node:assert/strict');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let mode='LIVE',remote={client_order_number:'OTHER',client_request_id:'AWB'},status='APPROVED',received=false,gets=0;
const state={mode:'LIVE',payload:{client_order_number:'NAMAMA-RETURN-1'},awb:'AWB'};
const tx={$queryRaw:async()=>[],returnRequest:{findUniqueOrThrow:async()=>({id:1,orderId:2,status,reversePickup:received?{receivedAt:'already'}:{}})},storeSetting:{findUniqueOrThrow:async()=>({value:state})}};
stub('../dist/lib/prisma',{prisma:{...tx,$transaction:async fn=>fn(tx)}});
stub('../dist/services/shipping/provider.service',{credentialsFor:async()=>({config:{mode,publicConfig:{}},credentials:{token:'test'}})});
stub('../dist/services/inventory/stock.service',{changeStock:async()=>{throw Error('must not change stock')}});
const axios=require('axios');axios.get=async()=>{gets++;return {data:remote}};
const r=require('../dist/services/shipping/reversePickup.service');
(async()=>{
await assert.rejects(r.syncReverse(1),/does not match/);
mode='TEST';await assert.rejects(r.syncReverse(1),/original carrier mode/);assert.equal(gets,1);mode='LIVE';
await assert.rejects(r.syncReverse(1,'../../invalid'),/Actual reverse AWB/);
remote={client_order_number:'NAMAMA-RETURN-1',client_request_id:'DIFFERENT'};await assert.rejects(r.syncReverse(1),/conflict/);
const receipt={warehouseId:1,note:'Physical inspection',items:[{orderItemId:1,quantity:1,restock:true}]};
await assert.rejects(r.receiveReverse(1,receipt,1),/completion and physical receipt/);
status='PICKUP_SCHEDULED';received=true;await assert.rejects(r.receiveReverse(1,receipt,1),/completion and physical receipt/);
console.log('6 reverse recovery and receipt guards passed; database/carrier mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
