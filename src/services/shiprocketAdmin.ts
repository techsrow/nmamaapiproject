// src/services/shiprocketAdmin.ts
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import {
  shiprocketCreateOrder,
  shiprocketGetOrderDetailsByAwb,
} from "./shiprocket.service";

/** Detect COD from latest payment record */
function isCODFromLatestPayment(payment?: any) {
  const method = String(payment?.paymentMethod || "").toLowerCase();
  const provider = String(payment?.provider || "").toLowerCase();

  return (
    method === "cod" ||
    method === "cashondelivery" ||
    method === "cash on delivery" ||
    provider === "cod"
  );
}

function money(n: any) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function normalizePhone(phone?: string | null) {
  if (!phone) return "9999999999";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "9999999999";
}

/**
 * Admin: Retry Shipment Creation
 * - Creates Shiprocket order (adhoc)
 * - Saves shipmentId, awbNumber, trackingUrl (if provided)
 * - ✅ Allows Paid OR COD (blocks unpaid-online)
 */
export async function createShiprocketShipmentForOrder(
  orderId: number,
  opts: { force?: boolean } = {}
) {
  const force = !!opts.force;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      payments: { orderBy: { id: "desc" }, take: 1 }, // ✅ latest payment
    },
  });

  if (!order) return { ok: false, message: "Order not found" };

  // ✅ idempotent (unless force)
  if (!force && (order.shipmentId || order.awbNumber)) {
    return { ok: true, message: "Shipment already exists. No action taken.", order };
  }

  const latestPay = order.payments?.[0];
  const cod = isCODFromLatestPayment(latestPay);
  const isPaid = String(order.paymentStatus) === "Paid";

  // ✅ Allow Paid OR COD
  if (!isPaid && !cod) {
    return {
      ok: false,
      message: "Only PAID or COD orders can be pushed to Shiprocket.",
    };
  }

  // ✅ Use real order shipping fields from your schema
  const name = String(order.customerName || "Customer");
  const email = String(order.customerEmail || "customer@example.com");
  const phone = normalizePhone(order.guestPhone || "");
  const address = String(order.shippingAddress || "").trim();
  const city = String(order.shippingCity || "").trim();
  const pincode = String(order.shippingPostalCode || "").trim();
  const country = String(order.shippingCountry || "India").trim();

  // Basic validation
  if (!phone || !pincode || !address || !city) {
    return {
      ok: false,
      message: "Order missing phone/address/city/pincode. Fill these in order first.",
    };
  }

  if (!order.orderItems?.length) {
    return { ok: false, message: "Order has no items" };
  }

  const order_items = order.orderItems.map((it) => ({
    name: it.productName || "Item",
    sku: it.sku || `SKU-${it.id}`,
    units: Number(it.quantity ?? 1),
    selling_price: money(it.unitPrice),
  }));

  // ✅ Shiprocket likes "YYYY-MM-DD HH:mm:ss" (we keep safe now())
  const order_date = new Date().toISOString().slice(0, 19).replace("T", " ");

  // ✅ Build Shiprocket payload
  const payload: any = {
    order_id: `ORD-${order.id}`,
    order_date,

    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",

    billing_customer_name: name,
    billing_last_name: "",
    billing_address: address,
    billing_address_2: "",
    billing_city: city,
    billing_pincode: pincode,
    billing_state: "NA", // if you store state later, replace
    billing_country: country,
    billing_email: email,
    billing_phone: phone,

    shipping_is_billing: true,
    order_items,

    // ✅ COD support
    payment_method: cod ? "COD" : "Prepaid",
    sub_total: money(order.totalAmount),

    // default dimensions (can move to env)
    length: Number(process.env.SHIPROCKET_PACKAGE_LENGTH ?? 10),
    breadth: Number(process.env.SHIPROCKET_PACKAGE_BREADTH ?? 10),
    height: Number(process.env.SHIPROCKET_PACKAGE_HEIGHT ?? 5),
    weight: Number(process.env.SHIPROCKET_PACKAGE_WEIGHT ?? 0.5),
  };

  try {
    // shiprocketCreateOrder returns JSON body (not {data:...})
    const created: any = await shiprocketCreateOrder(payload);

    const shipmentId = created?.shipment_id ?? created?.shipmentId ?? null;
    const awb = created?.awb_code ?? created?.awb ?? null;
    const trackingUrl = created?.tracking_url ?? null;

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        shippingProvider: "Shiprocket",
        shipmentStatus: "Created",
        shipmentId: shipmentId ? String(shipmentId) : null,
        awbNumber: awb ? String(awb) : null,
        trackingUrl: trackingUrl ? String(trackingUrl) : null,
        trackingCode: awb ? String(awb) : null,
        shippingMeta: created as unknown as Prisma.JsonObject,
        shippedAt: new Date(),
        status: "Shipped",
      } as any,
    });

    return { ok: true, message: "Shipment created successfully", order: updated };
  } catch (e: any) {
    return {
      ok: false,
      message: e?.response?.data?.message || e?.message || "Shipment creation failed",
      error: String(e),
    };
  }
}

/**
 * Admin: Sync Shipment Now
 * - Tracks by AWB
 * - Updates shipmentStatus + stores meta
 */
export async function syncShiprocketShipmentStatusForOrder(orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      awbNumber: true,
      shipmentStatus: true,
      shippingProvider: true,
    },
  });

  if (!order) return { ok: false, message: "Order not found" };

  if (order.shippingProvider !== "Shiprocket") {
    return { ok: false, message: "Order is not a Shiprocket shipment" };
  }

  if (!order.awbNumber) {
    return { ok: false, message: "No AWB found. Retry shipment creation first." };
  }

  try {
    const tracking: any = await shiprocketGetOrderDetailsByAwb(order.awbNumber);

    const raw =
      tracking?.tracking_data?.shipment_track?.[0]?.current_status ||
      tracking?.tracking_data?.shipment_status ||
      tracking?.tracking_data?.track_status ||
      tracking?.current_status ||
      "Unknown";

    const delivered = String(raw).toLowerCase().includes("deliver");

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        shipmentStatus: delivered ? "Delivered" : (order.shipmentStatus as any),
        shippingMeta: tracking as unknown as Prisma.JsonObject,
        ...(delivered ? { status: "Delivered", deliveredAt: new Date() } : {}),
      } as any,
    });

    return { ok: true, message: "Shipment synced", order: updated };
  } catch (e: any) {
    return {
      ok: false,
      message: e?.response?.data?.message || e?.message || "Sync failed",
      error: String(e),
    };
  }
}
