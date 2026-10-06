import { Router, Response } from "express";
import { prisma } from "../lib/prisma";
import { auth, AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { Prisma } from "@prisma/client";

const router = Router();
router.use(auth);

/* ---------------------------
   Helpers
---------------------------- */
function requireAdmin(req: AuthRequest, res: Response) {
  if (req.user?.role !== "Admin") {
    res.status(403).json({ success: false, message: "Admin only" });
    return false;
  }
  return true;
}

function orderNumber(id: number) {
  return `ORD-${id.toString().padStart(6, "0")}`;
}

/* ---------------------------
   Zod Schemas
---------------------------- */
const AllowedOrderStatus = ["Pending", "Confirmed", "Shipped", "Delivered", "Cancelled"] as const;
const AllowedPaymentStatus = ["Pending", "Created", "Paid", "Failed", "Refunded"] as const;

const AllowedShippingProvider = ["Shiprocket", "Delhivery", "Manual"] as const;
const AllowedShipmentStatus = [
  "NotCreated",
  "Created",
  "Picked",
  "InTransit",
  "OutForDelivery",
  "Delivered",
  "RTO",
  "Cancelled",
  "Failed",
] as const;

const UpdateStatusSchema = z.object({
  status: z.enum(AllowedOrderStatus),
});

const UpdateShippingSchema = z.object({
  shippingProvider: z.enum(AllowedShippingProvider).optional().nullable(),
  shipmentStatus: z.enum(AllowedShipmentStatus).optional().nullable(),

  shipmentId: z.string().optional().nullable(),
  awbNumber: z.string().optional().nullable(),

  trackingUrl: z.string().optional().nullable(),
  trackingCode: z.string().optional().nullable(),

  shippingFee: z.number().optional().nullable(), // frontend sends number
  shippingMeta: z.any().optional().nullable(), // JSON

  shippedAt: z.string().datetime().optional().nullable(),
  deliveredAt: z.string().datetime().optional().nullable(),
});

const AdminSetPaymentSchema = z.object({
  paymentStatus: z.enum(AllowedPaymentStatus),
  paidAmount: z.number().optional().nullable(),
});

/* =========================================================
   ADMIN: ALL ORDERS  (MUST be before "/:id")
   GET /api/orders/admin/all
   Query: q, status, paymentStatus, shipmentStatus, provider
========================================================= */
router.get("/admin/all", async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const q = String(req.query.q || "").trim();
  const status = req.query.status ? String(req.query.status) : "";
  const paymentStatus = req.query.paymentStatus ? String(req.query.paymentStatus) : "";
  const shipmentStatus = req.query.shipmentStatus ? String(req.query.shipmentStatus) : "";
  const provider = req.query.provider ? String(req.query.provider) : "";

  const where: Prisma.OrderWhereInput = {};

  if (status) where.status = status as any;
  if (paymentStatus) where.paymentStatus = paymentStatus as any;
  if (shipmentStatus) where.shipmentStatus = shipmentStatus as any;
  if (provider) where.shippingProvider = provider as any;

  if (q) {
    where.OR = [
      { razorpayOrderId: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { customerEmail: { contains: q, mode: "insensitive" } },
      { guestPhone: { contains: q, mode: "insensitive" } },
      { trackingCode: { contains: q, mode: "insensitive" } },
      { awbNumber: { contains: q, mode: "insensitive" } },
      { trackingUrl: { contains: q, mode: "insensitive" } },
      {
        user: {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { id: "desc" },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      orderItems: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          productName: true,
          variantLabel: true,
          sku: true,
          imageUrl: true,
        },
      },
      payments: {
        orderBy: { id: "desc" },
        select: {
          id: true,
          provider: true,
          paymentStatus: true,
          paymentMethod: true,
          razorpayOrderId: true,
          razorpayPaymentId: true,
          amount: true,
          createdAt: true,
        },
      },
    },
  });

  const data = orders.map((o) => ({
    ...o,
    orderNo: orderNumber(o.id),
  }));

  return res.json({ success: true, data });
});

/* =========================================================
   ADMIN: SINGLE ORDER DETAILS
   GET /api/orders/admin/:id
========================================================= */
router.get("/admin/:id", async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      orderItems: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { id: true, name: true, slug: true, imageUrl: true } },
          variant: { select: { id: true, sku: true, price: true, discountPrice: true, weight: true, size: true, color: true } },
        },
      },
      payments: { orderBy: { id: "desc" } },
      coupon: { select: { id: true, code: true, discountType: true } },
    },
  });

  if (!order) return res.status(404).json({ success: false, message: "Order not found" });

  return res.json({
    success: true,
    data: {
      ...order,
      orderNo: orderNumber(order.id),
    },
  });
});

/* =========================================================
   ADMIN: UPDATE ORDER STATUS
   PATCH /api/orders/:id/status
   Body: { status: "Confirmed" | "Shipped" | ... }
========================================================= */
// router.patch("/:id/status", async (req: AuthRequest, res: Response) => {
//   if (!requireAdmin(req, res)) return;

//   const id = Number(req.params.id);
//   if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });

//   const { status } = UpdateStatusSchema.parse(req.body);

//   const existing = await prisma.order.findUnique({ where: { id } });
//   if (!existing) return res.status(404).json({ success: false, message: "Order not found" });

//   // Optional guard: don't ship if not paid
//   if ((status === "Shipped" || status === "Delivered") && existing.paymentStatus !== "Paid") {
//     return res.status(400).json({
//       success: false,
//       message: "Cannot mark as Shipped/Delivered until payment is Paid",
//     });
//   }

//   const dataToUpdate: Prisma.OrderUpdateInput = { status };

//   // useful timestamps
//   if (status === "Shipped" && !existing.shippedAt) dataToUpdate.shippedAt = new Date();
//   if (status === "Delivered" && !existing.deliveredAt) dataToUpdate.deliveredAt = new Date();

//   const updated = await prisma.order.update({
//     where: { id },
//     data: dataToUpdate,
//   });

//   return res.json({ success: true, data: updated });
// });

router.patch("/:id/status", async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });

  const { status } = UpdateStatusSchema.parse(req.body);

  const existing = await prisma.order.findUnique({
    where: { id },
    include: {
      payments: { orderBy: { id: "desc" }, take: 1 }, // ✅ latest payment
    },
  });

  if (!existing) return res.status(404).json({ success: false, message: "Order not found" });

  // ✅ detect COD using latest payment record
  const latestPay = existing.payments?.[0];
  const pm = String(latestPay?.paymentMethod || "").toLowerCase();
  const provider = String(latestPay?.provider || "").toLowerCase();

  const isCOD =
    pm === "cod" ||
    pm === "cashondelivery" ||
    pm === "cash on delivery" ||
    provider === "cod";

  // ✅ allow Shipped/Delivered if Paid OR COD
  if ((status === "Shipped" || status === "Delivered") && existing.paymentStatus !== "Paid" && !isCOD) {
    return res.status(400).json({
      success: false,
      message: "Cannot mark as Shipped/Delivered unless payment is Paid or order is COD",
    });
  }

  const dataToUpdate: Prisma.OrderUpdateInput = { status };

  // useful timestamps
  if (status === "Shipped" && !existing.shippedAt) dataToUpdate.shippedAt = new Date();
  if (status === "Delivered" && !existing.deliveredAt) dataToUpdate.deliveredAt = new Date();

  const updated = await prisma.order.update({
    where: { id },
    data: dataToUpdate,
  });

  return res.json({ success: true, data: updated });
});


/* =========================================================
   ADMIN: UPDATE SHIPPING FIELDS + SHIPMENT STATUS
   PATCH /api/orders/:id/shipping
========================================================= */
router.patch("/:id/shipping", async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });

  const body = UpdateShippingSchema.parse(req.body);

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ success: false, message: "Order not found" });

  const update: Prisma.OrderUpdateInput = {
    shippingProvider: body.shippingProvider ?? undefined,
    shipmentStatus: body.shipmentStatus ?? undefined,

    shipmentId: body.shipmentId ?? undefined,
    awbNumber: body.awbNumber ?? undefined,

    trackingUrl: body.trackingUrl ?? undefined,
    trackingCode: body.trackingCode ?? undefined,

    shippingMeta: body.shippingMeta ?? undefined,
  };

  // convert number -> Decimal
  if (body.shippingFee !== undefined) {
    update.shippingFee = body.shippingFee === null ? null : new Prisma.Decimal(body.shippingFee);
  }

  if (body.shippedAt !== undefined) update.shippedAt = body.shippedAt ? new Date(body.shippedAt) : null;
  if (body.deliveredAt !== undefined) update.deliveredAt = body.deliveredAt ? new Date(body.deliveredAt) : null;

  // auto timestamps when shipmentStatus changes
  if (body.shipmentStatus === "Delivered" && !existing.deliveredAt) update.deliveredAt = new Date();
  if (
    (body.shipmentStatus === "Picked" ||
      body.shipmentStatus === "InTransit" ||
      body.shipmentStatus === "OutForDelivery" ||
      body.shipmentStatus === "Delivered") &&
    !existing.shippedAt
  ) {
    update.shippedAt = new Date();
  }

  const updated = await prisma.order.update({ where: { id }, data: update });

  return res.json({ success: true, data: updated });
});

/* =========================================================
   ADMIN: MANUAL PAYMENT SET (optional but useful)
   PATCH /api/orders/:id/payment
========================================================= */
router.patch("/:id/payment", async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });

  const body = AdminSetPaymentSchema.parse(req.body);

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ success: false, message: "Order not found" });

  const update: Prisma.OrderUpdateInput = {
    paymentStatus: body.paymentStatus,
  };

  if (body.paidAmount !== undefined) {
    update.paidAmount = body.paidAmount === null ? null : new Prisma.Decimal(body.paidAmount);
  }

  // convenience: if paid then confirm
  if (body.paymentStatus === "Paid" && existing.status === "Pending") {
    update.status = "Confirmed";
  }

  const updated = await prisma.order.update({ where: { id }, data: update });
  return res.json({ success: true, data: updated });
});

export default router;
