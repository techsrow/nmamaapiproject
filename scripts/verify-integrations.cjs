// Read-only account authentication probe. Never creates/captures/refunds a payment or books a shipment.
require('dotenv').config({quiet:true});
const {prisma}=require('../dist/lib/prisma');
const {gateway,testGateway}=require('../dist/services/payments/providerRegistry');
const {testShadowfax}=require('../dist/services/shipping/shadowfax.service');
async function check(name,fn){try{const details=await fn();console.log(JSON.stringify({check:name,result:'PASS',...details}));}catch(e){process.exitCode=1;console.log(JSON.stringify({check:name,result:'BLOCKED',errorType:e.name||'Error',code:e.code||null}));}}
(async()=>{
 await check('database',async()=>{await prisma.$queryRaw`SELECT 1`;return {}});
 if(process.exitCode)return;
 await check('razorpay-readonly-auth',async()=>{const cfg=await gateway('Razorpay');await testGateway('Razorpay',cfg.credentials,cfg.mode);return {mode:cfg.mode,transactionsCreated:0}});
 await check('shadowfax-readonly-auth',async()=>{await testShadowfax();return {shipmentsCreated:0}});
 console.log(JSON.stringify({endToEndPayment:'NOT_TESTED',endToEndShipment:'NOT_TESTED',note:'Authentication checks do not verify payment capture, callbacks, shipment booking or delivery.'}));
})().finally(()=>prisma.$disconnect()).catch(()=>{process.exitCode=1});
