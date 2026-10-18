import {prisma} from '../lib/prisma';
import {syncShiprocketShipment} from './shipping/shiprocketLifecycle.service';
export async function syncShiprocketShipments(){const rows=await prisma.shipment.findMany({where:{provider:'Shiprocket',awb:{not:null},status:{notIn:['Delivered','Cancelled','RTO']}},orderBy:{updatedAt:'asc'},take:100});for(const s of rows)try{await syncShiprocketShipment(s.id)}catch{await prisma.shipment.update({where:{id:s.id},data:{updatedAt:new Date()}}).catch(()=>{});}}
