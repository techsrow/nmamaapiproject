const assert=require('node:assert/strict');
let mode='TEST',token='unit-test-token',calls=[],reply=[];
function inject(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
inject('../dist/services/shipping/provider.service',{credentialsFor:async provider=>{assert.equal(provider,'Shadowfax360');return {config:{mode},credentials:{token}}}});
inject('axios',{post:async(url,payload,options)=>{calls.push({url,payload,options});return {data:reply}},get:async(url,options)=>{calls.push({url,options});return {data:reply}}});
const {testShadowfax,trackShadowfax,createShadowfaxOrder,labelShadowfax,requestShadowfaxCancellation}=require('../dist/services/shipping/shadowfax.service');
(async()=>{
 assert.equal((await testShadowfax()).ok,true);
 assert.match(calls[0].url,/dale.staging.shadowfax.in/);assert.equal(calls[0].options.headers.Authorization,'Token unit-test-token');
 mode='LIVE';reply={message:'Success',data:{awb_number:'SFX123'}};await trackShadowfax('SFX123');assert.equal(calls[1].url,'https://dale.shadowfax.in/api/v4/clients/orders/SFX123/track/');
 await assert.rejects(trackShadowfax('../other'),/Invalid/);
 reply={message:'Failure'};await assert.rejects(trackShadowfax('SFX123'),/could not find/);await assert.rejects(testShadowfax(),/Unexpected/);
 reply={message:'Success',data:{awb_number:'SFX123',id:10}};assert.equal((await createShadowfaxOrder({order_details:{client_order_id:'stable-id'}})).id,10);assert.match(calls.at(-1).url,/v3\/clients\/orders\/$/);assert.equal(calls.at(-1).payload.order_details.client_order_id,'stable-id');
 reply={message:'Failure',errors:{pickup_details:{pincode:['Not serviceable']}}};await assert.rejects(createShadowfaxOrder({}),e=>e.rejected===true&&/pickup_details.pincode.*Not serviceable/.test(e.message));
 reply={message:'Success',data:{label_url:'https://example.com/label.pdf'}};assert.equal(await labelShadowfax('SFX123'),'https://example.com/label.pdf');
 reply={message:'Success',data:{label_url:'javascript:alert(1)'}};await assert.rejects(labelShadowfax('SFX123'),/valid label/);
 reply={responseCode:200};assert.deepEqual(await requestShadowfaxCancellation('SFX123'),{accepted:true,confirmed:false,message:'Cancellation requested. Track the shipment to confirm carrier cancellation.'});
 reply={responseCode:400};await assert.rejects(requestShadowfaxCancellation('SFX123'),/not accepted/);
 token='';await assert.rejects(testShadowfax(),/token is required/);
 console.log('12 Shadowfax checks passed; HTTP and credentials mocked.');
})().catch(e=>{console.error(e);process.exitCode=1});
