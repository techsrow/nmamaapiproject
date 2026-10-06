import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { shiprocketService } from "../services/shiprocket.service";

const router = Router();
router.use(auth);

function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

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
  return "Created";
}

function mapShipmentToOrderStatus(shipment: ShipmentStatus) {
  // Your enum OrderStatus: Pending / Confirmed / Shipped / Delivered / Cancelled
  if (shipment === "Delivered") return "Delivered";
  if (
    shipment === "Picked" ||
    shipment === "InTransit" ||
    shipment === "OutForDelivery"
  )
    return "Shipped";

  return null;
}

/**
 * GET /api/delivery/admin/list
 * List orders that are shipped or in progress (shiprocket)
 */
router.get("/admin/list", async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orders = await prisma.order.findMany({
      where: {
        shippingProvider: "Shiprocket",
        shipmentId: { not: null },
        awbNumber: { not: null },
        shipmentStatus: { notIn: ["Delivered", "Cancelled", "Failed"] },
      },
      orderBy: { updatedAt: "desc" },
      include: { orderItems: true },
    });

    return res.json({ success: true, data: orders });
  } catch (e: any) {
    console.error("❌ delivery list error:", e);
    return res.status(500).json({ success: false, message: "Failed to load delivery list" });
  }
});

/**
 * POST /api/delivery/admin/sync/:orderId
 * Sync 1 order
 */
router.post("/admin/sync/:orderId", async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const orderId = Number(req.params.orderId);
    if (!orderId) return res.status(400).json({ success: false, message: "Invalid orderId" });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (order.shippingProvider !== "Shiprocket" || !order.awbNumber) {
      return res.status(400).json({ success: false, message: "Order has no Shiprocket AWB" });
    }

    const trackResp: any = await shiprocketService.trackByAwb(order.awbNumber);

    const rawStatus =
      trackResp?.tracking_data?.shipment_track?.[0]?.current_status ||
      trackResp?.tracking_data?.current_status ||
      trackResp?.current_status ||
      "";

    const mappedShipment = mapShiprocketToShipmentStatus(rawStatus);
    const mappedOrderStatus = mapShipmentToOrderStatus(mappedShipment);

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        shipmentStatus: mappedShipment,
        ...(mappedOrderStatus ? { status: mappedOrderStatus as any } : {}),
        ...(mappedShipment === "Delivered" ? { deliveredAt: new Date() } : {}),
        shippingMeta: trackResp,
      },
    });

    return res.json({ success: true, data: updated, track: trackResp });
  } catch (e: any) {
    console.error("❌ delivery sync order error:", e?.response?.data || e);
    return res.status(500).json({ success: false, message: e.message || "Sync failed" });
  }
});

/**
 * POST /api/delivery/admin/sync-bulk
 * body: { limit?: number }
 */
router.post("/admin/sync-bulk", async (req: AuthRequest, res: Response) => {
  try {
    if (!requireAdmin(req, res)) return;

    const limit = Math.min(Number(req.body?.limit || 25), 100);

    const orders = await prisma.order.findMany({
      where: {
        shippingProvider: "Shiprocket",
        shipmentId: { not: null },
        awbNumber: { not: null },
        shipmentStatus: { notIn: ["Delivered", "Cancelled", "Failed"] },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const results: any[] = [];

    for (const o of orders) {
      try {
        const trackResp: any = await shiprocketService.trackByAwb(o.awbNumber!);

        const rawStatus =
          trackResp?.tracking_data?.shipment_track?.[0]?.current_status ||
          trackResp?.tracking_data?.current_status ||
          trackResp?.current_status ||
          "";

        const mappedShipment = mapShiprocketToShipmentStatus(rawStatus);
        const mappedOrderStatus = mapShipmentToOrderStatus(mappedShipment);

        const updated = await prisma.order.update({
          where: { id: o.id },
          data: {
            shipmentStatus: mappedShipment,
            ...(mappedOrderStatus ? { status: mappedOrderStatus as any } : {}),
            ...(mappedShipment === "Delivered" ? { deliveredAt: new Date() } : {}),
            shippingMeta: trackResp,
          },
        });

        results.push({ id: o.id, ok: true, shipmentStatus: updated.shipmentStatus });
      } catch (err: any) {
        results.push({ id: o.id, ok: false, error: err?.message || "failed" });
      }
    }

    return res.json({ success: true, count: results.length, results });
  } catch (e: any) {
    console.error("❌ delivery sync bulk error:", e);
    return res.status(500).json({ success: false, message: "Bulk sync failed" });
  }
});

export default router;
