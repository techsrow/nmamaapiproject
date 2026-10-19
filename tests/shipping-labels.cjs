const assert=require('node:assert/strict'),axios=require('axios');
function stub(path,exports){const id=require.resolve(path);require.cache[id]={id,filename:id,loaded:true,exports};}
let s={id:1,provider:'Shadowfax360',awb:'123456789012',status:'AwbAssigned',providerMeta:{mode:'LIVE'}},mode='LIVE',url='https://carrier.example/label.pdf',calls=0;
const db={shipment:{findUnique:async()=>s,update:async({data})=>Object.assign(s,data)}};
stub('../dist/lib/prisma',{prisma:db});stub('../dist/services/shipping/provider.service',{credentialsFor:async()=>({config:{mode}})});
stub('../dist/services/shipping/shadowfax.service',{labelShadowfax:async()=>{calls++;return url}});
stub('../dist/services/shipping/shadowfaxLifecycle.service',{syncShadowfaxShipment:async()=>{throw Error('tracking not yet available')}});
stub('../dist/services/shipping/delhivery.service',{labelDelhivery:async()=>url});stub('../dist/services/shipping/rate.service',{shiprocketToken:async()=> 'test'});
axios.post=async()=>({data:{label_url:url}});
const api=require('../dist/services/shipping/shipping.service');
(async()=>{
assert.equal((await api.generateLabel(1)).labelUrl,url);assert.equal(calls,1);
mode='TEST';await assert.rejects(api.generateLabel(1),/original carrier mode/);mode='LIVE';
s.provider='Delhivery';assert.equal((await api.generateLabel(1)).labelUrl,url);
s.provider='Shiprocket';s.providerShipmentId='9';assert.equal((await api.generateLabel(1)).labelUrl,url);
url='https://user:password@example.com/label';await assert.rejects(api.generateLabel(1),/valid HTTPS/);
url='javascript:alert(1)';await assert.rejects(api.generateLabel(1),/valid HTTPS/);
s.status='Cancelled';await assert.rejects(api.generateLabel(1),/cancelled/);s.status='AwbAssigned';s.awb=null;await assert.rejects(api.generateLabel(1),/AWB is missing/);
s.provider='Local';await assert.rejects(api.generateLabel(1),/local delivery label/);
console.log('9 provider label routing/validation checks passed; carrier and database mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
