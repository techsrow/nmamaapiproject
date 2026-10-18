import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auth, AuthRequest } from '../middleware/auth';
import { adminOnly } from '../middleware/admin';
const router=Router();router.use(auth,adminOnly);
router.get('/reconciliation',async(req,res)=>{
 try{
 const after=z.coerce.number().int().nonnegative().parse(req.query.after||0);
 const variants=await prisma.productVariant.findMany({where:{id:{gt:after}},select:{id:true,sku:true,stockQuantity:true},orderBy:{id:'asc'},take:200});
 const rows=await prisma.warehouseInventory.findMany({where:{variantId:{in:variants.map(v=>v.id)}}});
 return res.json({success:true,data:variants.map(v=>{const allocations=rows.filter(r=>r.variantId===v.id);return {...v,allocations,allocated:allocations.reduce((s,r)=>s+r.quantity,0),legacyReserved:allocations.reduce((s,r)=>s+r.reserved,0),needsReconciliation:allocations.length===0||allocations.some(r=>r.reserved!==0)||allocations.reduce((s,r)=>s+r.quantity,0)!==v.stockQuantity};}),nextAfter:variants.length===200?variants[199].id:null});
 }catch{return res.status(400).json({success:false,message:'Unable to read reconciliation. Check the request and server logs.'});}
});
router.post('/reconciliation/:variantId',async(req:AuthRequest,res)=>{
 try{
 const variantId=z.coerce.number().int().positive().parse(req.params.variantId);
 const b=z.object({expectedStock:z.number().int().nonnegative(),reason:z.string().trim().min(5).max(500),allocations:z.array(z.object({warehouseId:z.number().int().positive(),quantity:z.number().int().nonnegative()})).min(1).max(100)}).parse(req.body);
 if(new Set(b.allocations.map(x=>x.warehouseId)).size!==b.allocations.length)throw new Error('Duplicate warehouses.');
 const result=await prisma.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id=${variantId} FOR UPDATE`;
 const variant=await tx.productVariant.findUniqueOrThrow({where:{id:variantId}});
 if(variant.stockQuantity!==b.expectedStock||b.allocations.reduce((s,r)=>s+r.quantity,0)!==variant.stockQuantity)throw new Error('Allocations must equal the current available stock. Refresh first.');
 const before=await tx.warehouseInventory.findMany({where:{variantId}});if(before.some(r=>r.reserved!==0))throw new Error('Legacy reservations require a reviewed migration before reconciliation.');
 const warehouses=await tx.warehouse.count({where:{id:{in:b.allocations.map(x=>x.warehouseId)},isActive:true}});if(warehouses!==b.allocations.length)throw new Error('Active warehouses required.');
 await tx.warehouseInventory.deleteMany({where:{variantId}});await tx.warehouseInventory.createMany({data:b.allocations.map(r=>({...r,variantId,reserved:0}))});
 await tx.activityLog.create({data:{userId:req.user!.userId,action:'RECONCILE_ALLOCATIONS',entity:'ProductVariant',entityId:String(variantId),meta:{before,after:b.allocations,reason:b.reason}}});return {variantId,available:variant.stockQuantity,allocations:b.allocations};
 });return res.json({success:true,data:result});
 }catch(e:any){return res.status(400).json({success:false,message:e instanceof z.ZodError?e.issues[0]?.message:e.code?'Reconciliation failed.':e.message});}
});
export default router;
