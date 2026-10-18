import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { syncShadowfaxBatch, syncShadowfaxShipment } from '../services/shipping/shadowfaxLifecycle.service';
let running=false;
export function startShadowfaxCron(){
 cron.schedule('* * * * *',async()=>{
  if(running)return;running=true;
  try{
   const queue=await prisma.storeSetting.findMany({where:{key:{startsWith:'shadowfax-sync:'}},orderBy:{updatedAt:'asc'},take:100});
   for(const job of queue){try{await syncShadowfaxShipment(Number(job.key.split(':')[1]));await prisma.storeSetting.deleteMany({where:{key:job.key,value:{equals:job.value!}}});}catch{console.warn('Shadowfax queued sync failed; will retry',job.key);}}
   if(new Date().getMinutes()%5===0){const result=await syncShadowfaxBatch();if(result.failed)console.warn('Shadowfax polling failures',result.failed);}
  }catch{console.error('Shadowfax reconciliation job failed');}finally{running=false;}
 });
}
