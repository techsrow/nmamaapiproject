import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ShiprocketProvider, DelhiveryProvider } from "../lib/shippingProviders";

const router = Router();

/* ======================================================
   Schemas
====================================================== */

const RatesSchema = z.object({
  toPincode: z.string().min(4),
  cod: z.boolean().optional().default(false),

  // optional override
  totalWeightKg: z.number().optional().default(0.5),
});

const CreateShipmentSchema = z.object({
  orderId: z.number(),
  provider: z.enum(["Shiprocket", "Delhivery"]),
  method: z.enum(["Standard", "Express"]).optional().default("Standard"),
});

const AdminUpdateStatusSchema = z.object({
  shipmentStatus: z.enum([
    "NotCreated",
    "Created",
    "PickedUp",
    "InTransit",
    "OutForDelivery",
    "Delivered",
    "Failed",
    "Cancelled",
  ]),
  trackingUrl: z.string().optional().nullable(),
  trackingCode: z.string().optional().nullable(),
  awbNumber: z.string().optional().nullable(),
  shipmentId: z.string().optional().nullable(),
  shippingMeta: z.any().optional(),
});

/* ======================================================
   Helpers
====================================================== */

function toNumber(d: any) {
  if (d == null) return 0;
  if (d instanceof Prisma.Decimal) return d.toNumber();
  return Number(d);
}

/**
 * Until you store weights in DB:
 * assume each order item weighs 0.25kg (you can change)
 */
function computeWeightKg(orderItems: any[]) {
  let totalQty = 0;
  for (const i of orderItems) totalQty += i.quantity;
  return Math.max(0.25, totalQty * 0.25);
}


function isCOD(order: any) {
  const latest = order?.payments?.[0];
  const method = String(latest?.paymentMethod || "").toLowerCase();
  const provider = String(latest?.provider || "").toLowerCase();

  return (
    method === "cod" ||
    method === "cashondelivery" ||
    method === "cash on delivery" ||
    provider === "cod"
  );
}


/* ======================================================
   PUBLIC: GET SHIPPING RATES
   POST /api/shipping/rates
====================================================== */
router.post("/rates", async (req: Request, res: Response) => {
  try {
    const body = RatesSchema.parse(req.body);

    const totalWeightKg = body.totalWeightKg ?? 0.5;

    const [shiprocket, delhivery] = await Promise.all([
      ShiprocketProvider.getRates({
        toPincode: body.toPincode,
        totalWeightKg,
        cod: body.cod,
      }),
      DelhiveryProvider.getRates({
        toPincode: body.toPincode,
        totalWeightKg,
        cod: body.cod,
      }),
    ]);

    return res.json({
      success: true,
      data: [...shiprocket, ...delhivery],
    });
  } catch (e: any) {
    console.error("❌ SHIPPING RATES ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   ADMIN: CREATE SHIPMENT (AFTER PAYMENT PAID)
   POST /api/shipping/create-shipment
====================================================== */
router.post("/create-shipment", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const body = CreateShipmentSchema.parse(req.body);

    // const order = await prisma.order.findUnique({
    //   where: { id: body.orderId },
    //   include: { orderItems: true },
    // });

    const order = await prisma.order.findUnique({
  where: { id: body.orderId },
  include: {
    orderItems: true,
    payments: { orderBy: { id: "desc" }, take: 1 }, // ✅ add
  },
});


    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // if (order.paymentStatus !== "Paid") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Order paymentStatus must be Paid before creating shipment",
    //   });
    // }

    const cod = isCOD(order);

if (order.paymentStatus !== "Paid" && !cod) {
  return res.status(400).json({
    success: false,
    message: "Only PAID or COD orders can be shipped",
  });
}


    if (!order.shippingPostalCode || !order.shippingAddress || !order.shippingCity) {
      return res.status(400).json({
        success: false,
        message: "Missing shipping address details on order",
      });
    }

    if (order.shipmentStatus !== "NotCreated") {
      return res.status(400).json({
        success: false,
        message: `Shipment already exists: ${order.shipmentStatus}`,
      });
    }

    const totalWeightKg = computeWeightKg(order.orderItems);

    const toName = order.customerName || "Customer";
    const toPhone = order.guestPhone || process.env.STORE_PHONE || "9999999999";

    const shipmentReq = {
      orderId: order.id,
      toName,
      toPhone,
      toAddress: order.shippingAddress,
      toCity: order.shippingCity,
      toPincode: order.shippingPostalCode,
      toCountry: order.shippingCountry || "India",
      amount: toNumber(order.totalAmount),
      cod:cod,
      totalWeightKg,
      items: order.orderItems.map((i) => ({
        name: i.productName,
        qty: i.quantity,
        price: toNumber(i.unitPrice),
      })),
    };

    const created =
      body.provider === "Shiprocket"
        ? await ShiprocketProvider.createShipment(shipmentReq)
        : await DelhiveryProvider.createShipment(shipmentReq);

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingProvider: created.provider, // enum matches string
        shipmentStatus: created.shipmentStatus,
        shipmentId: created.shipmentId,
        awbNumber: created.awbNumber,
        trackingUrl: created.trackingUrl,
        trackingCode: created.trackingCode ?? null,
        shippingFee: new Prisma.Decimal(created.shippingFee),
        shippingMeta: created.meta ?? undefined,
        shippedAt: new Date(), // created shipment => consider shipped
        status: "Shipped",
      },
    });

    return res.json({
      success: true,
      message: "Shipment created",
      data: {
        orderId: updated.id,
        shippingProvider: updated.shippingProvider,
        shipmentStatus: updated.shipmentStatus,
        shipmentId: updated.shipmentId,
        awbNumber: updated.awbNumber,
        trackingUrl: updated.trackingUrl,
        trackingCode: updated.trackingCode,
        shippingFee: updated.shippingFee,
      },
    });
  } catch (e: any) {
    console.error("❌ CREATE SHIPMENT ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   USER/ADMIN: TRACK ORDER
   GET /api/shipping/track/:orderId
====================================================== */
router.get("/track/:orderId", auth, async (req: AuthRequest, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,

        shippingProvider: true,
        shipmentStatus: true,
        shipmentId: true,
        awbNumber: true,
        trackingUrl: true,
        trackingCode: true,
        shippingFee: true,
        shippingMeta: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (req.user?.role !== "Admin" && order.userId !== req.user?.userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return res.json({ success: true, data: order });
  } catch (e: any) {
    console.error("❌ TRACK ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

/* ======================================================
   ADMIN: UPDATE SHIPMENT STATUS (manual)
   PUT /api/shipping/admin/orders/:orderId/status
====================================================== */
router.put("/admin/orders/:orderId/status", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== "Admin") {
      return res.status(403).json({ success: false, message: "Admin only" });
    }

    const orderId = Number(req.params.orderId);
    const body = AdminUpdateStatusSchema.parse(req.body);

    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) return res.status(404).json({ success: false, message: "Order not found" });

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        shipmentStatus: body.shipmentStatus as any,
        trackingUrl: body.trackingUrl ?? undefined,
        trackingCode: body.trackingCode ?? undefined,
        awbNumber: body.awbNumber ?? undefined,
        shipmentId: body.shipmentId ?? undefined,
        shippingMeta: body.shippingMeta ?? undefined,

        deliveredAt: body.shipmentStatus === "Delivered" ? new Date() : undefined,
        status: body.shipmentStatus === "Delivered" ? "Delivered" : undefined,
      },
    });

    return res.json({ success: true, message: "Shipment updated", data: updated });
  } catch (e: any) {
    console.error("❌ ADMIN STATUS UPDATE ERROR:", e);
    return res.status(400).json({ success: false, message: e.message });
  }
});

export default router;
