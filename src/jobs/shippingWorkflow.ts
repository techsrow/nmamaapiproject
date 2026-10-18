import cron from 'node-cron';
import {runShippingWorker} from '../services/shipping/workflow.service';
export function startShippingWorkflow(){cron.schedule('*/30 * * * * *',()=>runShippingWorker().catch(()=>console.error('Shipping worker failed; inspect database and job queue.')));}
