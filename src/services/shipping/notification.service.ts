import {prisma} from '../../lib/prisma';
import {z} from 'zod';

const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const messages:Record<string,[string,string]>={
 AwbAssigned:['Shipment booked','Your shipment has been booked. Tracking scans will appear after the courier processes your parcel.'],
 Picked:['Picked up','Your parcel has been picked up by the delivery team.'],
 InTransit:['In transit','Your parcel is on its way.'],
 OutForDelivery:['Out for delivery','Your parcel is out for delivery. Please keep your phone available.'],
 Delivered:['Delivered','Your parcel is marked as delivered. We hope you enjoy your purchase!'],
 NDR:['Delivery needs attention','The courier reported a delivery issue. Please contact us for assistance.'],
 DeliveryFailed:['Delivery attempt unsuccessful','The delivery attempt was unsuccessful. Please contact us for assistance.'],
 RTO:['Returned to sender','The parcel is marked as returned to sender. Please contact us about the next steps.'],
 Cancelled:['Shipment cancelled','This shipment has been cancelled. Please contact us if you need help with your order.'],
};
export function shippingEmail(order:any,shipment:any){
 const [status,description]=messages[shipment.status]||['Shipment update',`Your shipment status is ${shipment.status}.`];
 let link='';try{const u=new URL(shipment.trackingUrl||'');if(u.protocol==='https:'&&!u.username&&!u.password)link=u.href}catch{}
 if(!link&&shipment.provider==='Shadowfax360')link='https://www.shadowfax.in/track';
 if(!link&&shipment.provider==='Shiprocket')link='https://www.shiprocket.in/shipment-tracking/';
 if(!link&&shipment.provider==='Delhivery'&&shipment.awb)link=`https://www.delhivery.com/track/package/${encodeURIComponent(shipment.awb)}`;
 const name=String(order.customerName||'there').replace(/[\r\n]/g,' ').slice(0,120),carrier=shipment.courierName||(shipment.provider==='Shadowfax360'?'Shadowfax 360':shipment.provider),awb=shipment.awb||'Awaiting assignment';
 const subject=`Namama order NM-${order.id}: ${status}`;
 const text=`Hi ${name},\n\nThank you for shopping with Namama!\n\n${description}\n\nOrder: NM-${order.id}\nCarrier: ${carrier}\nTracking number: ${awb}\nStatus: ${status}${link?`\nTrack your parcel: ${link}\nIf asked, enter the tracking number above.`:''}\n\nNeed help? Contact the Namama store.\n\nWarm regards,\nTeam Namama`;
 const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#20352c;line-height:1.6"><h1>Namama</h1><p>Hi ${escape(name)},</p><p>Thank you for shopping with Namama!</p><h2>${escape(status)}</h2><p>${escape(description)}</p><p><b>Order:</b> NM-${escape(order.id)}<br><b>Carrier:</b> ${escape(carrier)}<br><b>Tracking number:</b> ${escape(awb)}</p>${link?`<p><a href="${escape(link)}" style="background:#20352c;color:white;padding:12px 20px;display:inline-block;text-decoration:none">Track your parcel</a></p><p>If asked, enter the tracking number above.</p>`:''}<p>Need help? Contact the Namama store.</p><p>Warm regards,<br><b>Team Namama</b></p></div>`;
 return {subject,text,html};
}

export async function queueShipmentEmail(shipmentId:number,manual=false){
 const s=await prisma.shipment.findUniqueOrThrow({where:{id:shipmentId}});
 if(!s.awb)throw Error('Save the shipment AWB before sending tracking email.');
 const o=await prisma.order.findUniqueOrThrow({where:{id:s.orderId},include:{user:{select:{email:true}}}});
 const parsed=z.email().safeParse(o.customerEmail||o.user?.email);if(!parsed.success)throw Error('This order has no valid customer email address. Correct the customer email before sending.');const to=parsed.data;
 const key=`EMAIL:${s.id}:${s.status}`,payload={to,...shippingEmail(o,s),manual};
 const job=await prisma.shippingJob.upsert({where:{key},create:{key,kind:'EMAIL',orderId:s.orderId,shipmentId:s.id,payload},update:{}});
 // Promote an unsent automatic notification when an admin explicitly requests it.
 if(manual&&job.state==='QUEUED')await prisma.shippingJob.updateMany({where:{id:job.id,state:'QUEUED'},data:{payload}});
 return {jobId:job.id,state:job.state,message:job.state==='DONE'?'This shipment status email was already submitted to SMTP.':job.state==='REVIEW'?'Email outcome needs review. Inspect SMTP logs before retrying.':job.state==='BLOCKED'?'Email is blocked. Correct SMTP/settings and retry it in the job queue.':'Tracking email queued. Check Automation & Operations for its delivery submission status.'};
}
