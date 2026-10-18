import {syncShiprocketShipment} from '../services/shipping/shiprocketLifecycle.service';
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { shiprocketRequest } from "../services/shiprocket.service";

const router = Router();

function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
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

/** =========================================================
 *  CREATE SHIPMENT (Shiprocket Adhoc)
 *  - Works for Paid OR COD
 *  - Saves shipmentId + awb into DB
 *  ========================================================= */
async function createShipmentForOrder(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      payments: { orderBy: { id: "desc" }, take: 1 },
    },
  });

  if (!order) return { ok: false, status: 404, message: "Order not found" };

  const cod = isCOD(order);
  if (order.paymentStatus !== "Paid" && !cod) {
    return {
      ok: false,
      status: 400,
      message: "Only PAID or COD orders can be pushed to Shiprocket",
    };
  }

  if (order.shipmentId) {
    return { ok: false, status: 400, message: "Shipment already created" };
  }

  const orderDate = order.orderDate ? new Date(order.orderDate) : new Date();

  const payload = {
    order_id: `ORDER_${order.id}`,
    order_date: orderDate.toISOString(),

    billing_customer_name: order.customerName || "Customer",
    billing_phone: order.guestPhone || "",
    billing_address: order.shippingAddress || "",
    billing_city: order.shippingCity || "",
    billing_pincode: order.shippingPostalCode || "",
    billing_country: order.shippingCountry || "India",

    payment_method: cod ? "COD" : "Prepaid",
    sub_total: Number(order.totalAmount),

    order_items: order.orderItems.map((i) => ({
      name: i.productName,
      sku: i.sku || `SKU-${i.id}`,
      units: i.quantity,
      selling_price: Number(i.unitPrice),
    })),
  };

  // ✅ shiprocketRequest returns JSON directly
  const shipment: any = await shiprocketRequest({
    method: "POST",
    url: "/orders/create/adhoc",
    data: payload,
  });

  const shipmentId = shipment?.shipment_id ? String(shipment.shipment_id) : null;
  if (!shipmentId) {
    return { ok: false, status: 500, message: "Shiprocket did not return shipment_id" };
  }

  await prisma.order.update({
    where: { id: order.id },
    data: {
      shippingProvider: "Shiprocket",
      shipmentStatus: "Created",
      shipmentId,
      awbNumber: shipment?.awb_code ? String(shipment.awb_code) : null,
      trackingUrl: shipment?.tracking_url || null,
      shippingMeta: shipment,
      shippedAt: new Date(),
    },
  });

  return { ok: true, status: 200, data: shipment };
}

/** =========================================================
 *  SYNC (track by shipmentId)
 *  - Safe: returns 400 if shipment not created
 *  - Saves mapped status + meta
 *  ========================================================= */
async function syncShipmentForOrder(orderId:number){const shipment=await prisma.shipment.findFirst({where:{orderId,provider:'Shiprocket'},orderBy:{id:'desc'}});if(!shipment)return {ok:false,status:409,message:'Reconcile legacy booking in Shipping first.'};const data=await syncShiprocketShipment(shipment.id);return {ok:true,status:200,data,mappedStatus:data.status};}

/* =========================================================
   ROUTES (Mounted at /api/shiprocket and /api/shipping/shiprocket)
========================================================= */

/**
 * Legacy: POST /api/shiprocket/create-shipment/:orderId
 */
router.post("/create-shipment/:orderId", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    const result = await createShipmentForOrder(orderId);

    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e: any) {
    console.error("❌ Shiprocket create shipment error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || "Failed to create shipment",
    });
  }
});

/**
 * ✅ Push: POST /api/shipping/shiprocket/:orderId/push
 * ✅ Push: POST /api/shiprocket/:orderId/push
 */
router.post("/:orderId/push", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    const result = await createShipmentForOrder(orderId);

    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data });
  } catch (e: any) {
    console.error("❌ Shiprocket push error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || "Failed to push shipment",
    });
  }
});

/**
 * ✅ Sync: POST /api/shipping/shiprocket/:orderId/sync
 * ✅ Sync: POST /api/shiprocket/:orderId/sync
 */
router.post("/:orderId/sync", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    const result = await syncShipmentForOrder(orderId);

    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data, mappedStatus: result.mappedStatus });
  } catch (e: any) {
    console.error("❌ Shiprocket sync error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || "Failed to sync shipment",
    });
  }
});

/**
 * ✅ Track (frontend currently calls this)
 * GET /api/shiprocket/track/:orderId
 */
router.get("/track/:orderId", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    const result = await syncShipmentForOrder(orderId); // track == sync (same)

    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data, mappedStatus: result.mappedStatus });
  } catch (e: any) {
    console.error("❌ Shiprocket track error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || "Failed to track shipment",
    });
  }
});

/**
 * Optional: GET /api/shiprocket/track/order/:orderId
 */
router.get("/track/order/:orderId", auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    const result = await syncShipmentForOrder(orderId);

    if (!result.ok) return res.status(result.status).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.data, mappedStatus: result.mappedStatus });
  } catch (e: any) {
    console.error("❌ Shiprocket track(order) error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || "Failed to track shipment",
    });
  }
});

export default router;
