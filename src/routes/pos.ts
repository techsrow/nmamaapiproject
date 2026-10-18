import { Router, Response } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { auth, AuthRequest } from '../middleware/auth';
import { posAccess } from '../middleware/posAccess';
import { prisma } from '../lib/prisma';
import { barcodeForVariant, barcodeSvg, barcodePattern } from '../services/pos/barcode';
import { preparePos, completePos, returnPos, quoteSchema, saleSchema, returnSchema, requestKeySchema, money } from '../services/pos/pos.service';
const router=Router();router.use(auth);
const id=(x:unknown)=>z.coerce.number().int().positive().parse(x);
function fail(res:Response,e:any){const known=e instanceof z.ZodError?e.issues[0]?.message:e?.code==='P2002'?'Duplicate barcode, payment reference or open session.':e?.code?'Database operation failed; check server logs.':e?.message;return res.status(400).json({success:false,message:known||'Operation failed.'});}
const discountAccess=(req:AuthRequest,res:Response,next:any)=>Number(req.body?.discount)>0?posAccess('pos.discount')(req,res,next):next();
const wrap=(permission:string,fn:(req:AuthRequest,res:Response)=>Promise<any>)=>[posAccess(permission),async(req:AuthRequest,res:Response)=>{try{return await fn(req,res);}catch(e){return fail(res,e);}}] as const;
router.get('/variants',...wrap('pos.sell',async(req,res)=>{
 const q=z.string().trim().min(1).max(100).parse(req.query.q);
 const rows=await prisma.productVariant.findMany({where:{isActive:true,product:{isActive:true},OR:[{barcode:q},{sku:{contains:q,mode:'insensitive'}},{product:{name:{contains:q,mode:'insensitive'}}}]},select:{id:true,barcode:true,sku:true,size:true,color:true,price:true,discountPrice:true,stockQuantity:true,product:{select:{id:true,name:true}}},take:30});return res.json({success:true,data:rows});
}));
router.get('/scan/:barcode',...wrap('pos.sell',async(req,res)=>{
 const barcode=z.string().trim().min(1).max(100).parse(req.params.barcode);
 const row=await prisma.productVariant.findUnique({where:{barcode},select:{id:true,barcode:true,sku:true,size:true,color:true,price:true,discountPrice:true,stockQuantity:true,isActive:true,product:{select:{id:true,name:true,isActive:true}}}});
 if(!row?.isActive||!row.product.isActive)return res.status(404).json({success:false,message:'Barcode not found or product inactive.'});return res.json({success:true,data:row});
}));
router.post('/barcodes/generate',...wrap('pos.barcodes',async(req,res)=>{
 const b=z.object({variantIds:z.array(z.number().int().positive()).min(1).max(200)}).parse(req.body);
 const rows=await prisma.$transaction(async tx=>{const result=[];for(const variantId of [...new Set(b.variantIds)].sort((a,b)=>a-b)){
 await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id=${variantId} FOR UPDATE`;
 const v=await tx.productVariant.findUniqueOrThrow({where:{id:variantId}});result.push(v.barcode?{id:v.id,barcode:v.barcode}:await tx.productVariant.update({where:{id:v.id},data:{barcode:barcodeForVariant(v.id)},select:{id:true,barcode:true}}));}return result;});return res.json({success:true,data:rows});
}));
router.put('/barcodes/:variantId',...wrap('pos.barcodes',async(req,res)=>{
 const barcode=z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/).parse(req.body.barcode);
 const row=await prisma.productVariant.update({where:{id:id(req.params.variantId)},data:{barcode},select:{id:true,barcode:true}});return res.json({success:true,data:row});
}));
router.get('/barcodes/:variantId.svg',...wrap('pos.barcodes',async(req,res)=>{
 const row=await prisma.productVariant.findUniqueOrThrow({where:{id:id(req.params.variantId)}});if(!row.barcode)throw new Error('Generate a barcode first.');return res.type('image/svg+xml').set('Cache-Control','no-store').send(barcodeSvg(row.barcode));
}));
router.post('/barcodes/labels.pdf',...wrap('pos.barcodes',async(req,res)=>{
 const b=z.object({variantIds:z.array(z.number().int().positive()).min(1).max(100),copies:z.number().int().min(1).max(10).default(1)}).parse(req.body);
 const rows=await prisma.productVariant.findMany({where:{id:{in:b.variantIds}},include:{product:{select:{name:true}}},orderBy:{id:'asc'}});
 if(rows.length!==new Set(b.variantIds).size)throw new Error('A variant was not found.');
 const labels=rows.flatMap(v=>Array.from({length:b.copies},()=>({v,bits:barcodePattern(v.barcode||'')})));
 const doc=new PDFDocument({size:'A4',margin:25});res.type('application/pdf').set('Cache-Control','no-store').set('Content-Disposition','inline; filename="barcode-labels.pdf"');doc.pipe(res);
 labels.forEach(({v,bits},index)=>{if(index>0&&index%21===0)doc.addPage();const cell=index%21,x=25+(cell%3)*182,y=25+Math.floor(cell/3)*110;
 doc.fontSize(8).text(v.product.name,x+5,y+3,{width:168,height:20,ellipsis:true}).text([v.color,v.size,v.sku].filter(Boolean).join(' / '),x+5,y+24,{width:168,height:12,ellipsis:true}).text(`INR ${Number(v.discountPrice??v.price).toFixed(2)}`,x+5,y+38,{width:168});
 for(let i=0;i<bits.length;i++)if(bits[i]==='1')doc.rect(x+15+i*1.5,y+53,1.5,32).fill('black');
 doc.font('Courier').fontSize(9).text(v.barcode!,x+5,y+89,{width:168,align:'center'}).font('Helvetica');});doc.end();
}));
router.get('/sessions/current',...wrap('pos.sell',async(req,res)=>res.json({success:true,data:await prisma.posSession.findFirst({where:{cashierId:req.user!.userId,closedAt:null}})})));
router.post('/sessions',...wrap('pos.sell',async(req,res)=>{
 const b=z.object({warehouseId:z.number().int().positive(),openingCash:z.number().min(0).max(10000000).refine(n=>money(n)===n*100)}).parse(req.body);
 const w=await prisma.warehouse.findUnique({where:{id:b.warehouseId}});if(!w?.isActive)throw new Error('Active warehouse required.');
 return res.status(201).json({success:true,data:await prisma.posSession.create({data:{...b,cashierId:req.user!.userId}})});
}));
router.get('/sessions/:id/summary',...wrap('pos.sell',async(req,res)=>{
 const sessionId=id(req.params.id);const session=await prisma.posSession.findUniqueOrThrow({where:{id:sessionId}});
 if(session.cashierId!==req.user!.userId&&req.user!.role!=='Admin')return res.status(403).json({success:false,message:'This is not your session.'});
 const sales=await prisma.posSale.findMany({where:{sessionId},select:{tenders:true}});
 const refunds=await prisma.posReturn.findMany({where:{sessionId},select:{method:true,amount:true}});
 const collected:Record<string,number>={CASH:0,UPI:0,CARD:0,BANK_TRANSFER:0},returned={...collected};
 for(const sale of sales)for(const tender of sale.tenders as any[])collected[tender.method]=(collected[tender.method]||0)+money(Number(tender.amount));
 for(const refund of refunds)returned[refund.method]=(returned[refund.method]||0)+money(Number(refund.amount));
 const expectedCash=(money(Number(session.openingCash))+collected.CASH-returned.CASH)/100;
 return res.json({success:true,data:{session,saleCount:sales.length,collected:Object.fromEntries(Object.entries(collected).map(([k,v])=>[k,v/100])),refunded:Object.fromEntries(Object.entries(returned).map(([k,v])=>[k,v/100])),expectedCash,variance:session.closingCash===null?null:(money(Number(session.closingCash))-money(expectedCash))/100}});
}));
router.post('/sessions/:id/close',...wrap('pos.sell',async(req,res)=>{
 const b=z.object({closingCash:z.number().min(0).max(10000000),note:z.string().max(500).optional()}).parse(req.body);const sessionId=id(req.params.id);
 const result=await prisma.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "PosSession" WHERE id=${sessionId} FOR UPDATE`;
 const s=await tx.posSession.findUniqueOrThrow({where:{id:sessionId}});if(s.cashierId!==req.user!.userId)throw new Error('This is not your session.');
 if(s.closedAt){if(money(Number(s.closingCash))!==money(b.closingCash))throw new Error('Session already closed with another cash count.');return s;}
 return tx.posSession.update({where:{id:sessionId},data:{closingCash:b.closingCash,note:b.note,closedAt:new Date()}});});return res.json({success:true,data:result});
}));
router.get('/drafts',...wrap('pos.sell',async(req,res)=>res.json({success:true,data:await prisma.storeSetting.findMany({where:{key:{startsWith:`pos-draft:${req.user!.userId}:`}},orderBy:{updatedAt:'desc'},take:50})})));
router.put('/drafts/:id',...wrap('pos.sell',async(req,res)=>{
 const draftId=z.string().uuid().parse(req.params.id),body=z.object({revision:z.number().int().nonnegative(),quote:quoteSchema}).parse(req.body),key=`pos-draft:${req.user!.userId}:${draftId}`;
 const result=await prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;const old=await tx.storeSetting.findUnique({where:{key}});const revision=(old?.value as any)?.revision||0;if(revision!==body.revision)throw new Error('Draft changed in another tab. Reload first.');
 const value=JSON.parse(JSON.stringify({revision:revision+1,quote:body.quote}));return tx.storeSetting.upsert({where:{key},create:{key,value},update:{value}});});return res.json({success:true,data:result});
}));
router.delete('/drafts/:id',...wrap('pos.sell',async(req,res)=>{const draftId=z.string().uuid().parse(req.params.id);await prisma.storeSetting.deleteMany({where:{key:`pos-draft:${req.user!.userId}:${draftId}`}});return res.json({success:true});}));
router.post('/quote',discountAccess,...wrap('pos.sell',async(req,res)=>res.json({success:true,data:await preparePos(quoteSchema.parse(req.body),req.user!.userId)})));
router.post('/sales',discountAccess,...wrap('pos.sell',async(req,res)=>{
 const result=await completePos(saleSchema.parse(req.body),req.user!.userId,requestKeySchema.parse(req.header('Idempotency-Key')));return res.status(result.reused?200:201).json({success:true,data:result});
}));
router.post('/sales/:id/returns',...wrap('pos.refund',async(req,res)=>res.json({success:true,data:await returnPos(id(req.params.id),returnSchema.parse(req.body),req.user!.userId,requestKeySchema.parse(req.header('Idempotency-Key')))})));
router.get('/sales',...wrap('pos.reports',async(req,res)=>{
 const cursor=req.query.before?id(req.query.before):undefined;
 return res.json({success:true,data:await prisma.posSale.findMany({where:cursor?{id:{lt:cursor}}:{},orderBy:{id:'desc'},take:50})});
}));
router.get('/sales/:id',...wrap('pos.sell',async(req,res)=>{
 const sale=await prisma.posSale.findUniqueOrThrow({where:{id:id(req.params.id)}});
 if(sale.cashierId!==req.user!.userId&&req.user!.role!=='Admin')return res.status(403).json({success:false,message:'This bill belongs to another cashier.'});
 return res.json({success:true,data:{sale,order:await prisma.order.findUnique({where:{id:sale.orderId},include:{orderItems:true}}),returns:await prisma.posReturn.findMany({where:{saleId:sale.id}}),creditNotes:await prisma.creditNote.findMany({where:{orderId:sale.orderId}})}});
}));
router.get('/sales/:id/receipt.pdf',...wrap('pos.sell',async(req,res)=>{
 const sale=await prisma.posSale.findUniqueOrThrow({where:{id:id(req.params.id)}});
 if(sale.cashierId!==req.user!.userId&&req.user!.role!=='Admin')return res.status(403).json({success:false,message:'This bill belongs to another cashier.'});
 const order=await prisma.order.findUniqueOrThrow({where:{id:sale.orderId},include:{orderItems:true}});
 const seller=sale.sellerSnapshot as any;const doc=new PDFDocument({size:'A4',margin:40});
 res.type('application/pdf').set('Cache-Control','no-store').set('Content-Disposition',`inline; filename="POS-${sale.id}.pdf"`);doc.pipe(res);
 doc.fontSize(18).text(seller.name||seller.storeName||'Namama');if(seller.gstin)doc.fontSize(10).text(`GSTIN: ${seller.gstin}`);
 doc.fontSize(12).text(`Bill: ${order.invoiceNumber}`).text(`Date: ${order.orderDate.toISOString()}`).text(`Customer: ${order.customerName}`);if(order.customerGstin)doc.text(`Customer GSTIN: ${order.customerGstin}`);doc.moveDown();
 for(const item of order.orderItems){doc.fontSize(10).text(`${item.productName} / ${item.variantLabel||''}`).text(`${item.quantity} x INR ${Number(item.unitPrice).toFixed(2)} = INR ${(item.quantity*Number(item.unitPrice)).toFixed(2)}`);doc.moveDown(.4);}
 const fmt=(n:any)=>Number(n||0).toFixed(2);doc.moveDown().text(`Subtotal: INR ${fmt(order.subtotal)}`).text(`Discount: INR ${fmt(order.discountAmount)}`);
 for(const tax of order.taxBreakdown as any[])doc.text(`${tax.name} ${tax.rate}% (${tax.inclusive?'included':'additional'}): INR ${fmt(tax.taxAmount)}`);
 doc.fontSize(14).text(`Total: INR ${fmt(order.totalAmount)}`).fontSize(10).text(`Refunded: INR ${fmt(order.refundedAmount)}`).text(`Net paid: INR ${fmt(order.paidAmount)}`);doc.text('Thank you!');doc.end();
}));
export default router;
