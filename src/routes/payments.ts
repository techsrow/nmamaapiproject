import { Router, Response } from "express";
import { PaymentProvider, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";
import { encryptJson, decryptJson, maskSecrets } from "../services/payments/crypto";
import { PROVIDERS, testGateway } from "../services/payments/providerRegistry";
import { createProviderPayment, refundPayment, syncOrderPayment, verifyRazorpay } from "../services/payments/paymentService";

const router=Router(); const admin=[auth,adminOnly] as any;
const providerValues=Object.values(PaymentProvider);
const safe=(row:any)=>{const credentials=decryptJson<Record<string,any>>(row.encryptedCredentials); const {encryptedCredentials,...rest}=row; return {...rest,credentials:maskSecrets(credentials),configured:Object.keys(credentials).length>0};};
// Public storefront endpoint.
// Returns only providers enabled in admin.
router.get("/methods", async (_req, res: Response) => {
  try {
    const providers = await prisma.paymentGatewayConfig.findMany({
      where: {
        isEnabled: true,
      },
      select: {
        provider: true,
        displayName: true,
      },
      orderBy: {
        id: "asc",
      },
    });

    return res.json({
      success: true,
      data: providers.map((item) => ({
        provider: item.provider,
        name: item.displayName || item.provider,
      })),
    });
  } catch (error) {
    console.error("Payment methods fetch failed", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load payment methods.",
    });
  }
});
router.get("/providers/catalog",...admin,(_req:AuthRequest,res:Response)=>res.json({success:true,data:Object.entries(PROVIDERS).map(([provider,x])=>({provider,...x}))}));
router.get("/providers",...admin,async(_req:AuthRequest,res:Response)=>{const rows=await prisma.paymentGatewayConfig.findMany({orderBy:{id:"asc"}});res.json({success:true,data:rows.map(safe)});});
router.get("/providers/:provider",...admin,async(req:AuthRequest,res:Response)=>{const provider=req.params.provider as PaymentProvider;if(!providerValues.includes(provider))return res.status(400).json({success:false,message:"Unsupported provider"});const row=await prisma.paymentGatewayConfig.findUnique({where:{provider}});return row?res.json({success:true,data:safe(row)}):res.status(404).json({success:false,message:"Provider not configured"});});
router.put("/providers/:provider",...admin,async(req:AuthRequest,res:Response)=>{try{const provider=req.params.provider as PaymentProvider;if(!providerValues.includes(provider))throw new Error("Unsupported provider");const old=await prisma.paymentGatewayConfig.findUnique({where:{provider}});let encryptedCredentials=old?.encryptedCredentials||null;if(req.body.credentials&&Object.keys(req.body.credentials).length)encryptedCredentials=encryptJson(req.body.credentials);const meta=PROVIDERS[provider];const row=await prisma.paymentGatewayConfig.upsert({where:{provider},create:{provider,displayName:req.body.displayName||meta?.label||provider,isEnabled:!!req.body.isEnabled,mode:req.body.mode||"TEST",encryptedCredentials,publicConfig:req.body.publicConfig||{}},update:{displayName:req.body.displayName||undefined,isEnabled:req.body.isEnabled===undefined?undefined:!!req.body.isEnabled,mode:req.body.mode||undefined,encryptedCredentials,publicConfig:req.body.publicConfig===undefined?undefined:req.body.publicConfig}});res.json({success:true,data:safe(row)});}catch(e:any){res.status(400).json({success:false,message:e.message});}});
router.post("/providers/:provider/test",...admin,async(req:AuthRequest,res:Response)=>{try{const provider=req.params.provider as PaymentProvider;const row=await prisma.paymentGatewayConfig.findUnique({where:{provider}});if(!row)throw new Error("Provider not configured");const credentials=decryptJson<Record<string,string>>(row.encryptedCredentials);const result=await testGateway(provider,credentials,row.mode);await prisma.paymentGatewayConfig.update({where:{provider},data:{lastTestedAt:new Date(),lastTestOk:true,lastError:null}});res.json({success:true,data:result});}catch(e:any){const provider=req.params.provider as PaymentProvider;if(providerValues.includes(provider))await prisma.paymentGatewayConfig.updateMany({where:{provider},data:{lastTestedAt:new Date(),lastTestOk:false,lastError:e.message}});res.status(400).json({success:false,message:e.message});}});
router.patch("/providers/:provider/status",...admin,async(req:AuthRequest,res:Response)=>{try{const provider=req.params.provider as PaymentProvider;const row=await prisma.paymentGatewayConfig.update({where:{provider},data:{isEnabled:!!req.body.isEnabled}});res.json({success:true,data:safe(row)});}catch(e:any){res.status(400).json({success:false,message:e.message});}});

router.get("/",...admin,async(req:AuthRequest,res:Response)=>{const page=Math.max(1,Number(req.query.page)||1),limit=Math.min(100,Math.max(1,Number(req.query.limit)||25));const where:any={};if(req.query.orderId)where.orderId=Number(req.query.orderId);if(req.query.provider)where.provider=String(req.query.provider);if(req.query.status)where.paymentStatus=String(req.query.status);const [data,total]=await Promise.all([prisma.payment.findMany({where,include:{order:{select:{id:true,customerName:true,customerEmail:true,totalAmount:true}}},orderBy:{id:"desc"},skip:(page-1)*limit,take:limit}),prisma.payment.count({where})]);res.json({success:true,data,meta:{page,limit,total,pages:Math.ceil(total/limit)}});});
router.get("/refunds",...admin,async(req:AuthRequest,res:Response)=>{const data=await prisma.paymentRefund.findMany({where:req.query.orderId?{orderId:Number(req.query.orderId)}:{},orderBy:{id:"desc"}});res.json({success:true,data});});
router.get("/order/:orderId",auth,async(req:AuthRequest,res:Response)=>{const id=Number(req.params.orderId);const o=await prisma.order.findUnique({where:{id},include:{payments:true}});if(!o)return res.status(404).json({success:false,message:"Order not found"});if(req.user?.role!=="Admin"&&o.userId!==req.user?.userId)return res.status(403).json({success:false,message:"Forbidden"});const refunds=await prisma.paymentRefund.findMany({where:{orderId:id}});res.json({success:true,data:{order:o,payments:o.payments,refunds}});});
router.post("/create",auth,async(req:AuthRequest,res:Response)=>{try{const orderId=Number(req.body.orderId),provider=req.body.provider as PaymentProvider;if(!providerValues.includes(provider))throw new Error("Unsupported provider");const o=await prisma.order.findUnique({where:{id:orderId}});if(!o)throw new Error("Order not found");if(req.user?.role!=="Admin"&&o.userId!==req.user?.userId) return res.status(403).json({success:false,message:"Forbidden"});res.status(201).json({success:true,data:await createProviderPayment(orderId,provider)});}catch(e:any){res.status(400).json({success:false,message:e.message});}});
router.post("/verify/razorpay",auth,async(req:AuthRequest,res:Response)=>{try{const data=await verifyRazorpay({providerOrderId:req.body.providerOrderId||req.body.razorpay_order_id,providerPaymentId:req.body.providerPaymentId||req.body.razorpay_payment_id,signature:req.body.signature||req.body.razorpay_signature});res.json({success:true,data});}catch(e:any){res.status(400).json({success:false,message:e.message});}});
router.post("/manual",...admin,async(req:AuthRequest,res:Response)=>{try{const provider=(req.body.provider||"Manual") as PaymentProvider;if(!["Manual","BankTransfer","COD"].includes(String(provider)))throw new Error("Manual endpoint supports Manual, BankTransfer or COD only");const p=await prisma.payment.create({data:{orderId:Number(req.body.orderId),amount:new Prisma.Decimal(req.body.amount),currency:req.body.currency||"INR",provider,paymentMethod:req.body.paymentMethod||undefined,paymentStatus:req.body.status||"Paid",isCaptured:(req.body.status||"Paid")==="Paid",providerPaymentId:req.body.reference||null,providerMeta:req.body.meta||undefined}});const order=await syncOrderPayment(p.orderId);res.status(201).json({success:true,data:{payment:p,order}});}catch(e:any){res.status(400).json({success:false,message:e.message});}});
router.post("/:paymentId/refund",...admin,async(req:AuthRequest,res:Response)=>{try{const p=await prisma.payment.findUnique({where:{id:Number(req.params.paymentId)}});if(!p)throw new Error("Payment not found");const amount=Number(req.body.amount||p.amount);const refund=await refundPayment(p.id,amount,req.body.reason,req.user?.userId);res.status(201).json({success:true,data:refund});}catch(e:any){res.status(400).json({success:false,message:e.message});}});

export default router;
