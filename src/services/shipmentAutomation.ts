// src/services/shipmentAutomation.ts
import { prisma } from "../lib/prisma";
import { shiprocketService } from "./shiprocket.service";
import { Prisma } from "@prisma/client";

type AutomationResult =
  | { ok: true; message: string; shipmentId?: string | null; awb?: string | null }
  | { ok: false; message: string };

function normalizePhone(phone?: string | null) {
  if (!phone) return "9999999999";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "9999999999";
}

function money(n: any) {
  const x = Number(n ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/** Detect COD from latest payment record (recommended + reliable) */
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

/**
 * If you don't store weight/dimensions per item yet:
 * Assume each item weight is 0.25kg minimum.
 */
function computeWeightKg(orderItems: any[]) {
  let totalQty = 0;
  for (const i of orderItems) totalQty += Number(i.quantity ?? 0);
  return Math.max(0.25, totalQty * 0.25);
}

/**
 * ✅ Auto create Shiprocket shipment for an order if:
 * - order.paymentStatus is "Paid" OR order is COD
 * - shipment not already created (idempotent)
 */
export async function autoCreateShipmentForPaidOrder(orderId: number): Promise<AutomationResult> {
  // NOTE: include latest payment + items needed for payload
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      orderItems: true,
      payments: { orderBy: { id: "desc" }, take: 1 }, // ✅ latest payment
    },
  });

  if (!order) return { ok: false, message: "Order not found" };

  const latestPay = order.payments?.[0];
  const cod = isCODFromLatestPayment(latestPay);
  const isPaid = String(order.paymentStatus) === "Paid";

  // ✅ allow Paid OR COD
  if (!isPaid && !cod) {
    return {
      ok: false,
      message: "Order is neither Paid nor COD. Shipment will be created only for Paid/COD orders.",
    };
  }

  // ✅ idempotent: if already created, do nothing
  if (order.shippingProvider === "Shiprocket" && order.shipmentId) {
    return {
      ok: true,
      message: "Shipment already exists (idempotent).",
      shipmentId: order.shipmentId,
      awb: order.awbNumber ?? null,
    };
  }

  // ✅ require shipping address fields (match your schema)
  const address = String(order.shippingAddress || "").trim();
  const city = String(order.shippingCity || "").trim();
  const pincode = String(order.shippingPostalCode || "").trim();
  const country = String(order.shippingCountry || "India").trim();

  if (!address || !city || !pincode) {
    return { ok: false, message: "Missing shipping address details on order" };
  }

  const customerName = String(order.customerName || "Customer");
  const customerEmail = String(order.customerEmail || "customer@example.com");
  const customerPhone = normalizePhone(order.guestPhone || (order as any)?.user?.phone);

  if (!order.orderItems?.length) return { ok: false, message: "Order has no items" };

  const items = order.orderItems.map((it: any) => ({
    name: it.productName || "Item",
    sku: it.sku || `SKU-${it.id}`,
    units: Number(it.quantity ?? 1),
    selling_price: money(it.unitPrice),
  }));

  // Shiprocket wants date string
  // const orderDateStr = new Date(order.orderDate || order.createdAt || new Date())
  //   .toISOString()
  //   .slice(0, 19)
  //   .replace("T", " ");

  // If your Order has no createdAt, use now() 
  // If your Order has no createdAt / orderDate field, use current time
const orderDateStr = new Date()
  .toISOString()
  .slice(0, 19)
  .replace("T", " ");


  const totalWeightKg = computeWeightKg(order.orderItems);

  // ✅ Shiprocket payload
  const shiprocketPayload: any = {
    order_id: `ORD-${order.id.toString().padStart(6, "0")}`,
    order_date: orderDateStr,
    pickup_location: process.env.SHIPROCKET_PICKUP_LOCATION || "Primary",

    billing_customer_name: customerName,
    billing_last_name: "",
    billing_address: address,
    billing_address_2: "",
    billing_city: city,
    billing_pincode: pincode,
    billing_state: "NA", // if you store state, replace here
    billing_country: country,
    billing_email: customerEmail,
    billing_phone: customerPhone,

    shipping_is_billing: true,
    order_items: items,

    // ✅ KEY FIX: COD vs Prepaid
    payment_method: cod ? "COD" : "Prepaid",
    sub_total: money(order.totalAmount),

    // dimensions/weight (fallbacks)
    length: Number(process.env.SHIPROCKET_PACKAGE_LENGTH ?? 10),
    breadth: Number(process.env.SHIPROCKET_PACKAGE_BREADTH ?? 10),
    height: Number(process.env.SHIPROCKET_PACKAGE_HEIGHT ?? 5),
    weight: Number(process.env.SHIPROCKET_PACKAGE_WEIGHT ?? totalWeightKg ?? 0.5),
  };

  // ✅ Create in Shiprocket
  const srResp: any = await shiprocketService.createOrderAdhoc(shiprocketPayload);

  // NOTE: your shiprocket.service returns res.data already,
  // so srResp should directly contain shipment_id, awb_code, tracking_url etc.
  const shipmentId = srResp?.shipment_id ?? srResp?.shipmentId ?? null;
  const awb = srResp?.awb_code ?? srResp?.awb ?? null;
  const trackingUrl = srResp?.tracking_url ?? null;

  if (!shipmentId) {
    return { ok: false, message: "Shiprocket shipment creation failed: missing shipment_id" };
  }

  // ✅ Save shipment fields directly on Order (matches your API routes)
  await prisma.order.update({
    where: { id: order.id },
    data: {
      shippingProvider: "Shiprocket",
      shipmentStatus: "Created",
      shipmentId: String(shipmentId),
      awbNumber: awb ? String(awb) : null,
      trackingUrl: trackingUrl ? String(trackingUrl) : null,
      trackingCode: awb ? String(awb) : null,
      shippingMeta: srResp as unknown as Prisma.JsonObject,
      shippedAt: new Date(),
      // optional: move order status to Shipped when shipment created
      status: "Shipped",
    } as any,
  });

  return {
    ok: true,
    message: cod ? "COD shipment created successfully." : "Prepaid shipment created successfully.",
    shipmentId: String(shipmentId),
    awb: awb ? String(awb) : null,
  };
}

/**
 * ✅ Sync shipment status from Shiprocket (using AWB tracking)
 * ✅ If delivered, mark order Delivered
 */
export async function syncShipmentStatus(orderId: number): Promise<AutomationResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      awbNumber: true,
      shipmentId: true,
      shipmentStatus: true,
      shippingProvider: true,
    },
  });

  if (!order) return { ok: false, message: "Order not found" };

  if (order.shippingProvider !== "Shiprocket") {
    return { ok: false, message: "Order is not a Shiprocket shipment" };
  }

  if (!order.awbNumber) return { ok: false, message: "AWB missing; cannot sync status" };

  const details: any = await shiprocketService.trackByAwb(String(order.awbNumber));

  const newStatus: string =
    details?.tracking_data?.shipment_track?.[0]?.current_status ||
    details?.tracking_data?.shipment_track?.[0]?.current_status_body ||
    details?.tracking_data?.current_status ||
    details?.current_status ||
    details?.status ||
    "Unknown";

  const delivered = /delivered/i.test(newStatus);

  await prisma.order.update({
    where: { id: order.id },
    data: {
      shipmentStatus: delivered ? "Delivered" : (order.shipmentStatus as any),
      shippingMeta: details as unknown as Prisma.JsonObject,
      deliveredAt: delivered ? new Date() : undefined,
      status: delivered ? "Delivered" : undefined,
    } as any,
  });

  return {
    ok: true,
    message: delivered ? "Shipment delivered. Order marked Delivered." : `Shipment status synced: ${newStatus}`,
    shipmentId: order.shipmentId ?? null,
    awb: order.awbNumber ?? null,
  };
}
