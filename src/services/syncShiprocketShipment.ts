import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { shiprocketRequest } from "./shiprocket.service";

/**
 * Sync all non-delivered shipments from Shiprocket
 * Shipment fields are on Order (no Shipment model).
 */
export async function syncShiprocketShipments() {
  const orders = await prisma.order.findMany({
    where: {
      awbNumber: { not: null },
      shipmentStatus: { not: "Delivered" },
      shippingProvider: "Shiprocket", // ✅ only shiprocket orders
    },
    select: {
      id: true,
      awbNumber: true,
      shipmentStatus: true,
      status: true,
    },
    take: 200, // ✅ safety limit (optional)
    orderBy: { id: "asc" },
  });

  if (!orders.length) return;

  for (const order of orders) {
    const awb = order.awbNumber!;
    try {
      // ✅ uses token-cache + retry-on-401
      const sr: any = await shiprocketRequest({
        method: "GET",
        url: `/courier/track/awb/${encodeURIComponent(awb)}`,
      });

      // Shiprocket status can be in multiple places
      const currentStatusRaw =
        sr?.tracking_data?.shipment_track?.[0]?.current_status ||
        sr?.tracking_data?.shipment_status ||
        sr?.tracking_data?.current_status ||
        sr?.current_status ||
        "";

      if (!currentStatusRaw) continue;

      const normalized = String(currentStatusRaw).toLowerCase();

      let mapped:
        | "Created"
        | "Picked"
        | "InTransit"
        | "OutForDelivery"
        | "Delivered"
        | "RTO"
        | "Cancelled"
        | "Failed" = "InTransit";

      if (normalized.includes("delivered")) mapped = "Delivered";
      else if (normalized.includes("out for delivery")) mapped = "OutForDelivery";
      else if (normalized.includes("in transit") || normalized.includes("in_transit")) mapped = "InTransit";
      else if (normalized.includes("picked")) mapped = "Picked";
      else if (normalized.includes("rto")) mapped = "RTO";
      else if (normalized.includes("cancel")) mapped = "Cancelled";
      else if (normalized.includes("fail")) mapped = "Failed";
      else mapped = "InTransit";

      // ✅ single DB update
      await prisma.order.update({
        where: { id: order.id },
        data: {
          shipmentStatus: mapped,
          trackingCode: awb,
          shippingMeta: sr as unknown as Prisma.JsonObject, // ✅ store full meta for admin
          deliveredAt: mapped === "Delivered" ? new Date() : undefined,
          status: mapped === "Delivered" ? "Delivered" : undefined, // ✅ auto order status
        } as any,
      });
    } catch (err) {
      console.error(
        `❌ Shipment sync failed for order ${order.id} (AWB ${awb})`,
        err
      );
    }
  }
}
