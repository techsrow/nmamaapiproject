import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { shiprocketService } from "../services/shiprocket.service";

function mapShiprocketToShipmentStatus(input: any) {
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

export function startDeliveryAutoSyncJob() {
  cron.schedule("*/30 * * * *", async () => {
    try {
      const orders = await prisma.order.findMany({
        where: {
          shippingProvider: "Shiprocket",
          awbNumber: { not: null },
          shipmentStatus: { notIn: ["Delivered", "Cancelled", "Failed"] },
        },
        take: 20,
        orderBy: { updatedAt: "asc" },
      });

      for (const o of orders) {
        const track: any = await shiprocketService.trackByAwb(o.awbNumber!);
        const raw =
          track?.tracking_data?.shipment_track?.[0]?.current_status ||
          track?.tracking_data?.current_status ||
          track?.current_status ||
          "";

        const mapped = mapShiprocketToShipmentStatus(raw);

        await prisma.order.update({
          where: { id: o.id },
          data: {
            shipmentStatus: mapped,
            ...(mapped === "Delivered" ? { status: "Delivered", deliveredAt: new Date() } : {}),
            shippingMeta: track,
          },
        });
      }

      console.log(`✅ Delivery Auto Sync done (${orders.length})`);
    } catch (e) {
      console.error("❌ Delivery Auto Sync failed", e);
    }
  });
}
