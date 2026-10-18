import {prisma} from '../lib/prisma';
import {enqueueOrder} from './shipping/workflow.service';
import {syncShiprocketShipment} from './shipping/shiprocketLifecycle.service';
export async function createShiprocketShipmentForOrder(orderId:number,_options?:{force?:boolean}){try{return {ok:true,message:'Shipping job queued.',job:await enqueueOrder(orderId)}}catch(e:any){return {ok:false,message:e.message}}}
export async function syncShiprocketShipmentStatusForOrder(orderId:number){const s=await prisma.shipment.findFirst({where:{orderId,provider:'Shiprocket'},orderBy:{id:'desc'}});if(!s)return {ok:false,message:'No unified shipment exists. Reconcile the legacy booking first.'};return {ok:true,message:'Shipment synced',shipment:await syncShiprocketShipment(s.id)};}
