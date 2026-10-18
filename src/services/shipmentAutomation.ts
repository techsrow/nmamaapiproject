import {enqueueOrder} from './shipping/workflow.service';
import {syncShiprocketShipmentStatusForOrder} from './shiprocketAdmin';
export async function autoCreateShipmentForPaidOrder(orderId:number){try{await enqueueOrder(orderId);return {ok:true,message:'Shipping job queued.'}}catch(e:any){return {ok:false,message:e.message}}}
export const syncShipmentStatus=syncShiprocketShipmentStatusForOrder;
