import { downloadLabelPdf } from '../services/shipping/labelPdf.service';
import {requestNdr} from '../services/shipping/ndr.service';
import crypto from "crypto";
import { recoverShadowfax, retrySavedShadowfax, shadowfaxBookingStatus } from "../services/shipping/shadowfaxBooking.service";
import { shadowfaxErrorMessage } from '../services/shipping/shadowfaxError';
import { Router, Response } from "express";
import { Prisma, ShippingProvider } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import {
  SHIPPING_CATALOG,
  listProviderConfigs,
  saveProviderConfig,
  testProvider,
} from "../services/shipping/provider.service";
import { getShippingRates } from "../services/shipping/rate.service";
import {
  cancelShipment,
  createShipment,
  generateLabel,
  schedulePickup,
  trackShipment,
} from "../services/shipping/shipping.service";
import { fulfillmentOrder, listFulfillmentOrders, ratesForOrder, shippingDashboard } from "../services/shipping/fulfillment.service";
const router = Router();
const admin = (req: AuthRequest, res: Response, next: any) =>
  req.user?.role === "Admin"
    ? next()
    : res.status(403).json({ success: false, message: "Admin only" });
const provider = (x: string) => {
  if (!(Object.values(ShippingProvider) as string[]).includes(x))
    throw new Error("Invalid shipping provider");
  return x as ShippingProvider;
};

// Public/storefront rate lookup. Only enabled providers/rules are returned.
router.post("/rates", async (req, res) => {
  try {
    const b = z
      .object({
        pickupPincode: z.string().min(4),
        deliveryPincode: z.string().min(4),
        cod: z.boolean().default(false),
        declaredValue: z.coerce.number().nonnegative().default(0),
        weightKg: z.coerce.number().positive().default(0.5),
        lengthCm: z.coerce.number().positive().default(10),
        widthCm: z.coerce.number().positive().default(10),
        heightCm: z.coerce.number().positive().default(5),
      })
      .parse(req.body);
    res.json({
      success: true,
      data: await getShippingRates({
        pickupPincode: b.pickupPincode,
        deliveryPincode: b.deliveryPincode,
        cod: b.cod,
        declaredValue: b.declaredValue,
        package: {
          weightKg: b.weightKg,
          lengthCm: b.lengthCm,
          widthCm: b.widthCm,
          heightCm: b.heightCm,
        },
      }),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});

// Callback signals a change; status is verified through authenticated carrier tracking.
router.post('/webhooks/shiprocket',async(req,res)=>{const secret=process.env.SHIPPING_WEBHOOK_SECRET||'',provided=req.header('x-api-key')||'';if(secret.length<32||Buffer.byteLength(secret)!==Buffer.byteLength(provided)||!crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(provided)))return res.status(401).json({success:false});const awb=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).safeParse(req.body?.awb);if(!awb.success)return res.status(400).json({success:false});try{const s=await prisma.shipment.findFirst({where:{provider:'Shiprocket',awb:awb.data}});if(s)await trackShipment(s.id);return res.json({success:true})}catch{return res.status(503).json({success:false})}});

// Configure this shared header with Shadowfax; never trust callback status as payment/shipping proof.
router.post("/webhooks/shadowfax",async(req,res)=>{
 const secret=process.env.SHADOWFAX_WEBHOOK_SECRET||'',provided=req.header('x-api-key')||'';
 if(secret.length<32||Buffer.byteLength(secret)!==Buffer.byteLength(provided)||!crypto.timingSafeEqual(Buffer.from(secret),Buffer.from(provided)))return res.status(401).json({success:false});
 const body=z.object({awb_number:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),client_order_id:z.string().min(1).max(100)}).safeParse(req.body);
 if(!body.success)return res.status(400).json({success:false});
 try{
  const shipment=await prisma.shipment.findFirst({where:{provider:'Shadowfax360',awb:body.data.awb_number}});
  if(!shipment)return res.json({success:true});
  const meta:any=shipment.providerMeta||{};
  if(meta.clientOrderId!==body.data.client_order_id)return res.status(409).json({success:false});
  const key=`shadowfax-sync:${shipment.id}`,value={requestedAt:new Date().toISOString()};
  await prisma.storeSetting.upsert({where:{key},create:{key,value},update:{value}});
  return res.json({success:true});
 }catch{return res.status(503).json({success:false});}
});

router.use(auth);
router.get('/shadowfax/orders/:orderId/booking',admin,async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.orderId);return res.json({success:true,data:await shadowfaxBookingStatus(id)});}catch(e){return res.status(400).json({success:false,message:shadowfaxErrorMessage(e)});}
});
router.post('/shadowfax/orders/:orderId/retry-saved',admin,async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.orderId);const expected=z.string().min(1).max(100).parse(req.body.expectedClientOrderId);return res.json({success:true,data:await retrySavedShadowfax(id,expected)});}catch(e){return res.status(409).json({success:false,message:shadowfaxErrorMessage(e)});}
});
router.post('/shadowfax/orders/:orderId/correct-pickup',admin,async(req,res)=>{
 try{const id=z.coerce.number().int().positive().parse(req.params.orderId);const body=z.object({expectedClientOrderId:z.string().min(1).max(100),pickupLocationId:z.number().int().positive(),expectedErrorAt:z.string().datetime()}).parse(req.body);return res.json({success:true,data:await retrySavedShadowfax(id,body.expectedClientOrderId,{pickupLocationId:body.pickupLocationId,expectedErrorAt:body.expectedErrorAt})});}catch(e){return res.status(409).json({success:false,message:shadowfaxErrorMessage(e)});}
});
router.post("/shadowfax/orders/:orderId/recover",admin,async(req,res)=>{
 try{const orderId=z.coerce.number().int().positive().parse(req.params.orderId);const awb=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).parse(req.body.awb);return res.json({success:true,data:await recoverShadowfax(orderId,awb)});}catch(e){return res.status(409).json({success:false,message:shadowfaxErrorMessage(e)});}
});
router.get("/providers/catalog", admin, (_req, res) =>
  res.json({ success: true, data: SHIPPING_CATALOG }),
);
router.get("/providers", admin, async (_req, res) =>
  res.json({ success: true, data: await listProviderConfigs() }),
);
router.put("/providers/:provider", admin, async (req: AuthRequest, res) => {
  try {
    res.json({
      success: true,
      data: await saveProviderConfig(provider(String(req.params.provider)), req.body),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.post(
  "/providers/:provider/test",
  admin,
  async (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        ...(await testProvider(provider(String(req.params.provider)))),
      });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  },
);
router.patch(
  "/providers/:provider/status",
  admin,
  async (req: AuthRequest, res) => {
    try {
      const p = provider(String(req.params.provider));
      const x = await prisma.shippingProviderConfig.update({
        where: { provider: p },
        data: { isEnabled: !!req.body.isEnabled },
      });
      res.json({ success: true, data: x });
    } catch (e: any) {
      res.status(400).json({ success: false, message: e.message });
    }
  },
);

router.get("/pickup-locations", admin, async (_req, res) =>
  res.json({
    success: true,
    data: await prisma.pickupLocation.findMany({
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    }),
  }),
);
router.post("/pickup-locations", admin, async (req: AuthRequest, res) => {
  try {
    const b = req.body;
    if (b.isDefault)
      await prisma.pickupLocation.updateMany({ data: { isDefault: false } });
    res.json({
      success: true,
      data: await prisma.pickupLocation.create({ data: b }),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.put("/pickup-locations/:id", admin, async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (req.body.isDefault)
      await prisma.pickupLocation.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
    res.json({
      success: true,
      data: await prisma.pickupLocation.update({
        where: { id },
        data: req.body,
      }),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.delete("/pickup-locations/:id", admin, async (req, res) => {
  await prisma.pickupLocation.delete({ where: { id: Number(req.params.id) } });
  res.json({ success: true });
});
// =========================================================
// SHIPPING RULES
// =========================================================

const shippingRuleSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Rule name is required"),

    methodName: z
      .string()
      .trim()
      .optional(),

    rate: z.coerce
      .number()
      .nonnegative("Shipping rate cannot be negative")
      .default(0),

    freeAbove: z
      .union([
        z.coerce.number().nonnegative(),
        z.literal(""),
        z.null(),
      ])
      .optional(),

    minOrderValue: z
      .union([
        z.coerce.number().nonnegative(),
        z.literal(""),
        z.null(),
      ])
      .optional(),

    maxOrderValue: z
      .union([
        z.coerce.number().nonnegative(),
        z.literal(""),
        z.null(),
      ])
      .optional(),

    isActive: z
      .boolean()
      .default(true),

    priority: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0),
  })
  .refine(
    (data) => {
      const min =
        data.minOrderValue === "" ||
        data.minOrderValue === null ||
        data.minOrderValue === undefined
          ? null
          : Number(data.minOrderValue);

      const max =
        data.maxOrderValue === "" ||
        data.maxOrderValue === null ||
        data.maxOrderValue === undefined
          ? null
          : Number(data.maxOrderValue);

      if (min === null || max === null) {
        return true;
      }

      return max >= min;
    },
    {
      message:
        "Maximum order value must be greater than or equal to minimum order value",
      path: ["maxOrderValue"],
    },
  );

function nullableShippingNumber(
  value: unknown,
): number | null {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

// =========================================================
// GET SHIPPING RULES
// =========================================================

router.get(
  "/rules",
  admin,
  async (_req, res) => {
    try {
      const rules =
        await prisma.shippingRule.findMany({
          orderBy: [
            { priority: "asc" },
            { id: "asc" },
          ],
        });

      return res.json({
        success: true,
        data: rules,
      });
    } catch (e: any) {
      console.error(
        "GET SHIPPING RULES ERROR:",
        e,
      );

      return res.status(500).json({
        success: false,
        message:
          e?.message ||
          "Failed to load shipping rules",
      });
    }
  },
);

// =========================================================
// CREATE SHIPPING RULE
// =========================================================

router.post(
  "/rules",
  admin,
  async (req: AuthRequest, res) => {
    try {
      /*
       * Current Admin still sends:
       *
       * type
       * codEnabled
       *
       * They are intentionally ignored here because they
       * are not fields in the current Prisma ShippingRule.
       */

      const parsed =
        shippingRuleSchema.parse({
          name: req.body?.name,

          methodName:
            req.body?.methodName,

          rate:
            req.body?.rate,

          freeAbove:
            req.body?.freeAbove,

          minOrderValue:
            req.body?.minOrderValue,

          maxOrderValue:
            req.body?.maxOrderValue,

          isActive:
            req.body?.isActive,

          priority:
            req.body?.priority ?? 0,
        });

      const rule =
        await prisma.shippingRule.create({
          data: {
            name: parsed.name,

            /*
             * Required by Prisma.
             *
             * Until Admin gets its own Delivery Method
             * field, use Rule Name as the fallback.
             */
            methodName:
              parsed.methodName?.trim() ||
              parsed.name,

            rate:
              parsed.rate,

            freeAbove:
              nullableShippingNumber(
                parsed.freeAbove,
              ),

            minOrderValue:
              nullableShippingNumber(
                parsed.minOrderValue,
              ),

            maxOrderValue:
              nullableShippingNumber(
                parsed.maxOrderValue,
              ),

            isActive:
              parsed.isActive,

            priority:
              parsed.priority,
          },
        });

      return res.status(201).json({
        success: true,
        data: rule,
      });
    } catch (e: any) {
      console.error(
        "CREATE SHIPPING RULE ERROR:",
        e,
      );

      if (e instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message:
            e.issues?.[0]?.message ||
            "Invalid shipping rule",
          errors: e.issues,
        });
      }

      return res.status(400).json({
        success: false,
        message:
          e?.message ||
          "Failed to create shipping rule",
      });
    }
  },
);

// =========================================================
// UPDATE SHIPPING RULE
// =========================================================

router.put(
  "/rules/:id",
  admin,
  async (req: AuthRequest, res) => {
    try {
      const id = Number(
        req.params.id,
      );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid shipping rule ID",
        });
      }

      const existing =
        await prisma.shippingRule.findUnique({
          where: {
            id,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Shipping rule not found",
        });
      }

      const parsed =
        shippingRuleSchema.parse({
          name:
            req.body?.name ??
            existing.name,

          methodName:
            req.body?.methodName ??
            existing.methodName,

          rate:
            req.body?.rate ??
            existing.rate.toString(),

          freeAbove:
            req.body?.freeAbove !==
            undefined
              ? req.body.freeAbove
              : existing.freeAbove?.toString() ??
                null,

          minOrderValue:
            req.body?.minOrderValue !==
            undefined
              ? req.body.minOrderValue
              : existing.minOrderValue?.toString() ??
                null,

          maxOrderValue:
            req.body?.maxOrderValue !==
            undefined
              ? req.body.maxOrderValue
              : existing.maxOrderValue?.toString() ??
                null,

          isActive:
            req.body?.isActive ??
            existing.isActive,

          priority:
            req.body?.priority ??
            existing.priority,
        });

      const rule =
        await prisma.shippingRule.update({
          where: {
            id,
          },

          data: {
            name:
              parsed.name,

            methodName:
              parsed.methodName?.trim() ||
              parsed.name,

            rate:
              parsed.rate,

            freeAbove:
              nullableShippingNumber(
                parsed.freeAbove,
              ),

            minOrderValue:
              nullableShippingNumber(
                parsed.minOrderValue,
              ),

            maxOrderValue:
              nullableShippingNumber(
                parsed.maxOrderValue,
              ),

            isActive:
              parsed.isActive,

            priority:
              parsed.priority,
          },
        });

      return res.json({
        success: true,
        data: rule,
      });
    } catch (e: any) {
      console.error(
        "UPDATE SHIPPING RULE ERROR:",
        e,
      );

      if (e instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message:
            e.issues?.[0]?.message ||
            "Invalid shipping rule",
          errors: e.issues,
        });
      }

      return res.status(400).json({
        success: false,
        message:
          e?.message ||
          "Failed to update shipping rule",
      });
    }
  },
);

// =========================================================
// DELETE SHIPPING RULE
// =========================================================

router.delete(
  "/rules/:id",
  admin,
  async (req, res) => {
    try {
      const id = Number(
        req.params.id,
      );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid shipping rule ID",
        });
      }

      const existing =
        await prisma.shippingRule.findUnique({
          where: {
            id,
          },
        });

      if (!existing) {
        return res.status(404).json({
          success: false,
          message:
            "Shipping rule not found",
        });
      }

      await prisma.shippingRule.delete({
        where: {
          id,
        },
      });

      return res.json({
        success: true,
        message:
          "Shipping rule deleted successfully",
      });
    } catch (e: any) {
      console.error(
        "DELETE SHIPPING RULE ERROR:",
        e,
      );

      return res.status(400).json({
        success: false,
        message:
          e?.message ||
          "Failed to delete shipping rule",
      });
    }
  },
);



// =========================================================
// ORDER FULFILLMENT / READY-TO-SHIP WORKFLOW
// =========================================================
router.get("/dashboard",admin,async(_req,res)=>{try{return res.json({success:true,data:await shippingDashboard()})}catch(e:any){return res.status(400).json({success:false,message:e.message})}});
router.get("/fulfillment/orders",admin,async(req,res)=>{try{return res.json({success:true,data:await listFulfillmentOrders({q:req.query.q?String(req.query.q):undefined,limit:req.query.limit?Number(req.query.limit):50,offset:req.query.offset?Number(req.query.offset):0,readyOnly:String(req.query.readyOnly??"true")!=="false"})})}catch(e:any){return res.status(400).json({success:false,message:e.message})}});
router.get("/fulfillment/orders/:orderId",admin,async(req,res)=>{try{return res.json({success:true,data:await fulfillmentOrder(Number(req.params.orderId))})}catch(e:any){return res.status(404).json({success:false,message:e.message})}});
router.post("/fulfillment/orders/:orderId/rates",admin,async(req:AuthRequest,res)=>{try{return res.json({success:true,data:await ratesForOrder(Number(req.params.orderId),req.body||{})})}catch(e:any){return res.status(400).json({success:false,message:e?.response?.data?.message||e.message})}});
router.post("/fulfillment/orders/:orderId/create",admin,async(req:AuthRequest,res)=>{try{return res.status(201).json({success:true,data:await createShipment({...req.body,orderId:Number(req.params.orderId),provider:provider(req.body.provider)})})}catch(e:any){return res.status(400).json({success:false,message:e?.response?.data?.message||e.message})}});

router.get("/shipments", admin, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const q = req.query.q ? String(req.query.q) : undefined;
  const where: any = {};
  if(req.query.orderId){const id=Number(req.query.orderId);if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({success:false,message:"Invalid order ID"});where.orderId=id;}
  if (status) where.status = status;
  if (q)
    where.OR = [
      { awb: { contains: q, mode: "insensitive" } },
      { courierName: { contains: q, mode: "insensitive" } },
      { providerShipmentId: { contains: q, mode: "insensitive" } },
    ];
  res.json({
    success: true,
    data: await prisma.shipment.findMany({
      where,
      orderBy: { id: "desc" },
      take: 200,
    }),
  });
});
router.get("/shipments/:id", admin, async (req, res) => {
  const id = Number(req.params.id);
  res.json({
    success: true,
    data: {
      shipment: await prisma.shipment.findUnique({ where: { id } }),
      items: await prisma.shipmentItem.findMany({ where: { shipmentId: id } }),
      tracking: await prisma.shipmentTrackingEvent.findMany({
        where: { shipmentId: id },
        orderBy: { createdAt: "desc" },
      }),
    },
  });
});
router.post("/shipments", admin, async (req: AuthRequest, res) => {
  try {
    res.json({
      success: true,
      data: await createShipment({
        ...req.body,
        provider: provider(req.body.provider),
      }),
    });
  } catch (e: any) {
    res
      .status(400)
      .json({
        success: false,
        message: e?.response?.data?.message || e.message,
      });
  }
});
router.post("/shipments/:id/pickup", admin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await schedulePickup(Number(req.params.id),req.body),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.post("/shipments/:id/label", admin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await generateLabel(Number(req.params.id)),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
// Generate only a label for the existing booking, never a new shipment.
router.post('/shipments/:id/label-pdf', admin, async (req, res) => {
  let labelUrl:string|undefined;
  try {
    const id=z.coerce.number().int().positive().parse(req.params.id);
    const shipment=await generateLabel(id);
    labelUrl=shipment.labelUrl||undefined;
    const pdf=await downloadLabelPdf(shipment.labelUrl!);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`inline; filename="shipping-label-${id}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(pdf);
  } catch(e:any) {
    res.status(400).json({success:false,labelUrl,message:typeof e?.response?.data?.message==='string'?e.response.data.message:e.message||'Unable to generate the carrier label PDF.'});
  }
});
router.post("/shipments/:id/track", admin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await trackShipment(Number(req.params.id)),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.post("/shipments/:id/cancel", admin, async (req, res) => {
  try {
    res.json({
      success: true,
      data: await cancelShipment(Number(req.params.id)),
    });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
});
router.post('/shipments/:id/manual-status',admin,(_req,res)=>res.status(409).json({success:false,message:'Use local operations transitions. Carrier status requires authenticated tracking.'}));
router.post('/shipments/:id/ndr',admin,async(req:AuthRequest,res)=>{try{return res.json({success:true,data:await requestNdr(z.coerce.number().int().positive().parse(req.params.id),req.body,req.user!.userId)})}catch(e:any){return res.status(400).json({success:false,message:e.message})}});
export default router;
