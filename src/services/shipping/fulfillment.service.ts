import { PaymentProvider, ShippingProvider, ShipmentStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getShippingRates } from "./rate.service";

const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = [
  "Draft","ReadyToShip","Created","AwbAssigned","PickupScheduled","Picked","InTransit","OutForDelivery","Delivered","DeliveryFailed","NDR","RTOInitiated","RTOInTransit","RTO"
];

function num(v:any){ return Number(v ?? 0); }
function jsonAddress(order:any){
  const x:any = order.shippingAddressJson && typeof order.shippingAddressJson === "object" ? order.shippingAddressJson : {};
  return {
    address1: order.shippingAddress || x.address1 || x.address || x.line1 || "",
    address2: x.address2 || x.line2 || "",
    city: order.shippingCity || x.city || "",
    state: x.state || x.province || "",
    country: order.shippingCountry || x.country || "India",
    pincode: order.shippingPostalCode || x.pincode || x.postalCode || x.zip || "",
    phone: order.guestPhone || x.phone || "",
    name: order.customerName || x.name || "Customer",
    email: order.customerEmail || x.email || "",
  };
}
function weightKg(raw:any){
  const s=String(raw||"").trim().toLowerCase(); if(!s)return 0;
  const m=s.match(/[\d.]+/); if(!m)return 0; const v=Number(m[0]);
  if(s.includes("kg"))return v; if(s.includes("g"))return v/1000; return v;
}
async function allocatedByOrder(orderId:number){
  const shipments=await prisma.shipment.findMany({where:{orderId,status:{in:ACTIVE_SHIPMENT_STATUSES}},select:{id:true}});
  if(!shipments.length)return new Map<number,number>();
  const grouped=await prisma.shipmentItem.groupBy({by:["orderItemId"],where:{shipmentId:{in:shipments.map(s=>s.id)}},_sum:{quantity:true}});
  return new Map(grouped.map(x=>[x.orderItemId,x._sum.quantity||0]));
}

export async function fulfillmentOrder(orderId:number){
  const order=await prisma.order.findUnique({where:{id:orderId},include:{orderItems:{include:{variant:true}},payments:{orderBy:{id:"desc"},take:1}}});
  if(!order)throw new Error("Order not found");
  const allocated=await allocatedByOrder(order.id);
  const items=order.orderItems.map(i=>{
    const allocatedQuantity=allocated.get(i.id)||0;
    return {...i,unitPrice:num(i.unitPrice),variant:{...i.variant,price:num(i.variant.price),discountPrice:i.variant.discountPrice==null?null:num(i.variant.discountPrice)},allocatedQuantity,remainingQuantity:Math.max(0,i.quantity-allocatedQuantity)};
  });
  const remainingQuantity=items.reduce((a,i)=>a+i.remainingQuantity,0);
  const estimatedWeightKg=Math.max(.25,items.reduce((a,i)=>a+(weightKg(i.variant.weight)||.25)*i.remainingQuantity,0));
  const address=jsonAddress(order);
  const latestPayment=order.payments[0]||null;
  const isCod=latestPayment?.provider===PaymentProvider.COD || String(order.paymentMethod||"").toUpperCase()==="COD";
  const shippable=(order.paymentStatus==="Paid"||isCod) && remainingQuantity>0 && order.status!=="Cancelled" && order.status!=="Returned";
  return {
    id:order.id,orderNumber:`NM-${order.id}`,orderDate:order.orderDate,status:order.status,paymentStatus:order.paymentStatus,paymentMethod:order.paymentMethod,
    customerName:order.customerName,customerEmail:order.customerEmail,guestPhone:order.guestPhone,totalAmount:num(order.totalAmount),currency:order.currency,
    address,items,remainingQuantity,estimatedWeightKg,isCod,codAmount:isCod?num(order.paymentDue ?? order.totalAmount):0,shippable,
    shipmentStatus:order.shipmentStatus,shippingProvider:order.shippingProvider,awbNumber:order.awbNumber,trackingUrl:order.trackingUrl
  };
}

export async function listFulfillmentOrders(input:{q?:string;limit?:number;offset?:number;readyOnly?:boolean}){
  const q=input.q?.trim(); const take=Math.min(Math.max(input.limit||50,1),200); const skip=Math.max(input.offset||0,0);
  const where:any={status:{notIn:["Cancelled","Returned","Delivered"]}};
  if(q){const id=Number(q.replace(/\D/g,""));where.OR=[{customerName:{contains:q,mode:"insensitive"}},{customerEmail:{contains:q,mode:"insensitive"}},{guestPhone:{contains:q,mode:"insensitive"}},...(Number.isFinite(id)&&id>0?[{id}]:[])]}
  const orders=await prisma.order.findMany({where,orderBy:{orderDate:"desc"},take,skip,select:{id:true}});
  const rows=[] as any[]; for(const o of orders){const detail=await fulfillmentOrder(o.id);if(!input.readyOnly||detail.shippable)rows.push(detail)}
  return rows;
}

export async function ratesForOrder(orderId:number,input:{pickupLocationId?:number;weightKg?:number;lengthCm?:number;widthCm?:number;heightCm?:number}){
  const order=await fulfillmentOrder(orderId); if(!order.shippable)throw new Error("Order is not ready to ship");
  const pickup=input.pickupLocationId?await prisma.pickupLocation.findFirst({where:{id:input.pickupLocationId,isActive:true}}):await prisma.pickupLocation.findFirst({where:{isActive:true},orderBy:[{isDefault:"desc"},{id:"asc"}]});
  if(!pickup)throw new Error("No active pickup location configured"); if(!order.address.pincode)throw new Error("Order delivery pincode is missing");
  const rates=await getShippingRates({pickupPincode:pickup.pincode,deliveryPincode:order.address.pincode,cod:order.isCod,declaredValue:order.totalAmount,package:{weightKg:input.weightKg||order.estimatedWeightKg,lengthCm:input.lengthCm||10,widthCm:input.widthCm||10,heightCm:input.heightCm||5}});
  return {orderId,pickupLocation:pickup,package:{weightKg:input.weightKg||order.estimatedWeightKg,lengthCm:input.lengthCm||10,widthCm:input.widthCm||10,heightCm:input.heightCm||5},rates};
}

export async function shippingDashboard(){
  const statuses=await prisma.shipment.groupBy({by:["status"],_count:{_all:true}});
  const ready=await listFulfillmentOrders({limit:200,readyOnly:true});
  const total=await prisma.shipment.count();
  return {total,readyToShip:ready.length,byStatus:Object.fromEntries(statuses.map(s=>[s.status,s._count._all])),inTransit:statuses.filter(s=>["Picked","InTransit","OutForDelivery"].includes(s.status)).reduce((a,s)=>a+s._count._all,0),exceptions:statuses.filter(s=>["DeliveryFailed","NDR","RTOInitiated","RTOInTransit","RTO","Failed"].includes(s.status)).reduce((a,s)=>a+s._count._all,0)};
}
