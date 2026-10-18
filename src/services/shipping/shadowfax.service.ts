import axios from "axios";
import { credentialsFor } from "./provider.service";
import { ShadowfaxBookingError, shadowfaxResponseErrors } from './shadowfaxError';

// SFX 360 Forward Logistics. Customer charges come from ShippingRule;
// serviceability is not a price quote and does not create a shipment.
async function client(existingShipment=false) {
  const { config, credentials } = await credentialsFor("Shadowfax360",existingShipment);
  const token = String(credentials.token || "").trim();
  if (!token) throw new Error("Shadowfax 360 API token is required.");
  return {
    base: config.mode === "LIVE"
      ? "https://dale.shadowfax.in/api"
      : "https://dale.staging.shadowfax.in/api",
    options: { headers: { Authorization: `Token ${token}` }, timeout: 15000 },
  };
}

export async function testShadowfax() {
  const { base, options } = await client();
  const response = await axios.get(`${base}/v1/clients/serviceability/`, {
    ...options, params: { service: "customer_delivery", page: 1, count: 1 },
  });
  if (!Array.isArray(response.data)) throw new Error("Unexpected Shadowfax serviceability response.");
  return { ok: true, message: "Shadowfax 360 authentication successful. Checkout uses shipping rules. Booking must be enabled separately after staging verification." };
}

export async function trackShadowfax(awb: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(awb)) throw new Error("Invalid Shadowfax AWB.");
  const { base, options } = await client(true);
  const response = await axios.get(`${base}/v4/clients/orders/${encodeURIComponent(awb)}/track/`, options);
  if (response.data?.message === "Failure") throw new Error("Shadowfax could not find tracking for this AWB.");
  return response.data;
}

export async function createShadowfaxOrder(payload: unknown) {
  const {base,options}=await client();
  const response=await axios.post(`${base}/v3/clients/orders/`,payload,options);
  if(response.data?.message==='Failure')throw new ShadowfaxBookingError(`Shadowfax rejected booking. ${shadowfaxResponseErrors(response.data)||'Check the carrier account and shipment details.'}`,true);
  if(response.data?.message!=='Success'||!response.data?.data?.awb_number)throw new Error('Shadowfax did not confirm booking. Check the portal and reconcile the saved booking intent.');
  return response.data.data;
}
export async function labelShadowfax(awb:string) {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(awb))throw new Error('Invalid AWB.');
  const {base,options}=await client(true);const response=await axios.post(`${base}/client/generate_label/`,{awb_number:awb,file_type:'pdf'},options);
  const url=response.data?.data?.label_url;
  if(response.data?.message!=='Success'||typeof url!=='string'||!url.startsWith('https://'))throw new Error('Shadowfax did not return a valid label.');return url;
}
export async function requestShadowfaxCancellation(awb:string) {
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(awb))throw new Error('Invalid AWB.');
  const {base,options}=await client(true);const response=await axios.post(`${base}/v3/clients/orders/cancel/`,{request_id:awb,cancel_remarks:'Requested by store administrator'},options);
  if(response.data?.responseCode!==200)throw new Error('Shadowfax has not accepted the cancellation request.');
  // Acceptance can be queued; do not restore fulfillment/stock until confirmed.
  return {accepted:true,confirmed:false,message:'Cancellation requested. Track the shipment to confirm carrier cancellation.'};
}

export async function updateShadowfaxOrder(payload:Record<string,unknown>) {
 const {base,options}=await client(true);
 const response=await axios.post(`${base}/v3/clients/order_update/`,payload,options);
 if(response.data?.message!=='Success')throw new Error('Shadowfax did not confirm the update. Reconcile carrier tracking before retrying.');
 return {accepted:true};
}

export async function shadowfaxServiceability(pickup:string,delivery:string){
 if(![pickup,delivery].every(p=>/^[1-9]\d{5}$/.test(p)))throw Error('Valid pickup and delivery PIN codes required.');
 const {base,options}=await client();const legs=[['seller_pickup',pickup],['customer_delivery',delivery],['seller_delivery',pickup]];
 const results=await Promise.all(legs.map(async([service,pincode])=>{const r=await axios.get(`${base}/v1/clients/serviceability/`,{...options,params:{service,pincodes:pincode,page:1,count:10}});if(!Array.isArray(r.data))throw Error('Invalid serviceability response.');return {service,pincode,available:r.data.some((x:any)=>String(x.code)===pincode&&x.services?.some((v:any)=>String(v).toLowerCase()==='regular'))}}));return {serviceable:results.every(x=>x.available),message:results.filter(x=>!x.available).map(x=>`${x.service} PIN ${x.pincode} not serviceable`).join('; '),legs:results};
}
