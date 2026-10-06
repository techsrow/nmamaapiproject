// src/routes/shipping.shiprocket.ts
import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { shiprocketService } from "../services/shiprocket.service";
import { Prisma } from "@prisma/client";

const router = Router();
router.use(auth);

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


function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

// ✅ IMPORTANT: DO NOT use Prisma.ShipmentStatus (it will error).
// Use generated enum from "@prisma/client" OR string union.
type ShipmentStatus =
  | "NotCreated"
  | "Created"
  | "Picked"
  | "InTransit"
  | "OutForDelivery"
  | "Delivered"
  | "RTO"
  | "Cancelled"
  | "Failed";

function mapShiprocketToShipmentStatus(input: any): ShipmentStatus {
  const s = String(input || "").toLowerCase();

  if (s.includes("delivered")) return "Delivered";
  if (s.includes("out for delivery")) return "OutForDelivery";
  if (s.includes("in transit") || s.includes("in_transit")) return "InTransit";
  if (s.includes("picked")) return "Picked";
  if (s.includes("rto")) return "RTO";
  if (s.includes("cancel")) return "Cancelled";
  if (s.includes("fail")) return "Failed";

  // default safe
  return "Created";
}

/**
 * POST /api/shipping/shiprocket/:orderId/push
 * Push paid order to Shiprocket
 */
router.post("/:orderId/push", async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid orderId" });
    }

    // const order = await prisma.order.findUnique({
    //   where: { id: orderId },
    //   include: {
    //     orderItems: { include: { product: true, variant: true } },
    //   },
    // });

    const order = await prisma.order.findUnique({
  where: { id: orderId },
  include: {
    orderItems: { include: { product: true, variant: true } },
    payments: { orderBy: { id: "desc" }, take: 1 }, // ✅ add
  },
});


    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // ✅ Only paid orders can be pushed
    // if (order.paymentStatus !== "Paid") {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Order is not paid. Only paid orders can be pushed to Shiprocket.",
    //   });
    // }

    const cod = isCOD(order);

if (order.paymentStatus !== "Paid" && !cod) {
  return res.status(400).json({
    success: false,
    message: "Only PAID or COD orders can be pushed to Shiprocket.",
  });
}


    // ✅ prevent duplicates
    if (order.shippingProvider === "Shiprocket" && order.shipmentId) {
      return res.json({
        success: true,
        message: "Already pushed to Shiprocket",
        data: order,
      });
    }

    const items = order.orderItems.map((it) => ({
      name: it.productName,
      sku: it.sku || it.variant?.sku || `SKU-${it.variantId}`,
      units: it.quantity,
      selling_price: Number(it.unitPrice),
    }));

    // ⚠️ Shiprocket needs State. If you don’t have it in schema, store in shippingMeta later.
    // For now set "NA" to avoid hard fail in some accounts.
    const payload: any = {
      order_id: String(order.id),
      order_date: new Date(order.orderDate).toISOString().slice(0, 10),

      billing_customer_name: order.customerName || "Customer",
      billing_last_name: "",
      billing_address: order.shippingAddress || "",
      billing_city: order.shippingCity || "",
      billing_pincode: order.shippingPostalCode || "",
      billing_state: "NA",
      billing_country: order.shippingCountry || "India",
      billing_email: order.customerEmail || "",
      billing_phone: order.guestPhone || "",

      shipping_is_billing: true,
      order_items: items,

      // payment_method: "Prepaid",
      payment_method: cod ? "COD" : "Prepaid",

      sub_total: Number(order.totalAmount),
    };

    const srResp = await shiprocketService.createOrderAdhoc(payload);

    const shipmentId = srResp?.shipment_id || srResp?.shipmentId || null;
    const awb = srResp?.awb_code || srResp?.awb || null;
    const trackingUrl = srResp?.tracking_url || null;

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        shippingProvider: "Shiprocket",
        shipmentStatus: "Created",
        shipmentId: shipmentId ? String(shipmentId) : null,
        awbNumber: awb ? String(awb) : null,
        trackingUrl: trackingUrl ? String(trackingUrl) : null,
        trackingCode: awb ? String(awb) : null,
        shippingMeta: srResp as unknown as Prisma.JsonObject,
        shippedAt: new Date(),
      },
    });

    return res.json({ success: true, data: updated, shiprocket: srResp });
  } catch (e: any) {
    console.error("❌ Shiprocket push error:", e?.response?.data || e);
    return res.status(500).json({
      success: false,
      message: e?.response?.data?.message || e.message || "Shiprocket push failed",
    });
  }
});

/**
 * POST /api/shipping/shiprocket/:orderId/sync
 * Sync tracking from Shiprocket using AWB
 */
router.post("/:orderId/sync", async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Invalid orderId" });
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.shippingProvider !== "Shiprocket" || !order.awbNumber) {
      return res.status(400).json({ success: false, message: "Order has no Shiprocket AWB" });
    }

    const trackResp: any = await shiprocketService.trackByAwb(order.awbNumber);

    // Shiprocket response varies; try multiple keys for status
    const rawStatus =
      trackResp?.tracking_data?.shipment_track?.[0]?.current_status ||
      trackResp?.tracking_data?.shipment_track?.[0]?.current_status_id ||
      trackResp?.tracking_data?.current_status ||
      trackResp?.current_status ||
      "";

    const mapped = mapShiprocketToShipmentStatus(rawStatus);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        shipmentStatus: mapped,
        shippingMeta: trackResp as unknown as Prisma.JsonObject,
        ...(mapped === "Delivered" ? { deliveredAt: new Date() } : {}),
      },
    });

    return res.json({ success: true, data: updated, track: trackResp });
  } catch (e: any) {
    console.error("❌ Shiprocket sync error:", e?.response?.data || e);
    return res.status(500).json({ success: false, message: e.message || "Sync failed" });
  }
});

export default router;
