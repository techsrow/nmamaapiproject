import crypto from "crypto";
import { changeStock } from "../services/inventory/stock.service";
import { Router, Response } from "express";

import { z } from "zod";

import { prisma } from "../lib/prisma";

import { auth, AuthRequest } from "../middleware/auth";

import { adminOnly } from "../middleware/admin";



const router = Router();

const db: any = prisma;

const ok = (res: Response, data: any, status = 200) =>

  res.status(status).json({ success: true, data });

const fail = (res: Response, e: any, status = 400) =>

  res

    .status(status)

    .json({

      success: false,

      message: e?.issues?.[0]?.message || e?.message || "Request failed",

    });

const n = (v: any) => Number(v || 0);



// Stock writes go through the shared balance and database ledger.
const move = async (tx: any, args: any) => changeStock(tx, args);

const variantInclude = {

  product: {

    select: {

      id: true,

      name: true,

      slug: true,

      imageUrl: true,

      images: { orderBy: { sortOrder: "asc" }, take: 1 },

    },

  },

  images: { orderBy: { sortOrder: "asc" }, take: 1 },

};

const variantView = (v: any) => ({

  ...v,

  displayName: [v.product?.name, v.color, v.size].filter(Boolean).join(" / "),

  imageUrl:

    v.images?.[0]?.url ||

    v.colorImageUrl ||

    v.product?.images?.[0]?.url ||

    v.product?.imageUrl ||

    null,

  inventoryStatus:

    v.stockQuantity <= 0

      ? v.preorderEnabled

        ? "PREORDER"

        : v.allowBackorder

          ? "BACKORDER"

          : "OUT_OF_STOCK"

      : v.stockQuantity <= v.lowStockAlertAt

        ? "LOW_STOCK"

        : "IN_STOCK",

});



// ---------- Stock ----------

router.get("/stock", auth, adminOnly, async (req, res) => {

  try {

    const q = String(req.query.q || "").trim();

    const variants = await db.productVariant.findMany({

      where: {

        isActive: true,

        ...(q

          ? {

              OR: [

                { sku: { contains: q, mode: "insensitive" } },

                { color: { contains: q, mode: "insensitive" } },

                { size: { contains: q, mode: "insensitive" } },

                { product: { name: { contains: q, mode: "insensitive" } } },

              ],

            }

          : {}),

      },

      include: variantInclude,

      orderBy: [{ stockQuantity: "asc" }, { id: "desc" }],

      take: Math.min(n(req.query.limit) || 300, 500),

    });

    const ids = variants.map((v: any) => v.id);

    const inv = ids.length

      ? await db.warehouseInventory.findMany({

          where: { variantId: { in: ids } },

          include: {

            warehouse: {

              select: { id: true, name: true, code: true, isActive: true },

            },

          },

        })

      : [];

    const by = new Map<number, any[]>();

    for (const x of inv) {

      if (!by.has(x.variantId)) by.set(x.variantId, []);

      by.get(x.variantId)!.push({

        ...x,

        available: n(x.quantity) - n(x.reserved),

      });

    }

    return ok(

      res,

      variants.map((v: any) => ({

        ...variantView(v),

        warehouses: by.get(v.id) || [],

        reserved: (by.get(v.id) || []).reduce(

          (s: number, x: any) => s + n(x.reserved),

          0,

        ),

        available: (by.get(v.id) || []).reduce(

          (s: number, x: any) => s + n(x.quantity) - n(x.reserved),

          0,

        ),

      })),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.get("/low-stock", auth, adminOnly, async (_req, res) => {

  try {

    const rows = await db.productVariant.findMany({

      where: { isActive: true, trackInventory: true },

      include: variantInclude,

      orderBy: { stockQuantity: "asc" },

    });

    return ok(

      res,

      rows

        .filter((v: any) => v.stockQuantity <= v.lowStockAlertAt)

        .map(variantView),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.patch("/variants/:id/settings", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        lowStockAlertAt: z.coerce.number().int().nonnegative().optional(),

        trackInventory: z.boolean().optional(),

        allowBackorder: z.boolean().optional(),

        preorderEnabled: z.boolean().optional(),

      })

      .parse(req.body);

    return ok(

      res,

      await db.productVariant.update({

        where: { id: n(req.params.id) },

        data: b,

      }),

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.post("/:variantId/threshold", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({ lowStockAlertAt: z.coerce.number().int().nonnegative() })

      .parse(req.body);

    return ok(

      res,

      await db.productVariant.update({

        where: { id: n(req.params.variantId) },

        data: b,

      }),

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.post("/adjust", auth, adminOnly, async (req: AuthRequest, res) => {

  try {

    const b = z

      .object({

        variantId: z.coerce.number().int().positive(),

        warehouseId: z.coerce.number().int().positive(),

        quantityDelta: z.coerce

          .number()

          .int()

          .refine((x) => x !== 0),

        note: z.string().max(500).optional(),

      })

      .parse(req.body);

    return ok(

      res,

      await db.$transaction((tx: any) =>

       move(tx, {
  variantId: b.variantId,
  warehouseId: b.warehouseId,
  delta: b.quantityDelta,
  type: "ADJUSTMENT",
  note: b.note,
  userId: req.user!.userId,
})

      ),

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.get("/movements", auth, adminOnly, async (req, res) => {

  try {

    return ok(

      res,

      await db.inventoryMovement.findMany({

        where: {

          ...(req.query.variantId ? { variantId: n(req.query.variantId) } : {}),

          ...(req.query.warehouseId

            ? { warehouseId: n(req.query.warehouseId) }

            : {}),

        },

        orderBy: { createdAt: "desc" },

        take: Math.min(n(req.query.limit) || 100, 500),

      }),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});



// Variant picker for PO / transfers

router.get("/variants", auth, adminOnly, async (req, res) => {

  try {

    const q = String(req.query.q || "").trim();

    const rows = await db.productVariant.findMany({

      where: {

        isActive: true,

        ...(q

          ? {

              OR: [

                { sku: { contains: q, mode: "insensitive" } },

                { product: { name: { contains: q, mode: "insensitive" } } },

                { color: { contains: q, mode: "insensitive" } },

                { size: { contains: q, mode: "insensitive" } },

              ],

            }

          : {}),

      },

      include: variantInclude,

      orderBy: { id: "desc" },

      take: Math.min(n(req.query.limit) || 100, 200),

    });

    return ok(res, rows.map(variantView));

  } catch (e) {

    return fail(res, e, 500);

  }

});



// ---------- Warehouses ----------

router.get("/warehouses", auth, adminOnly, async (_req, res) => {

  try {

    return ok(res, await db.warehouse.findMany({ orderBy: { name: "asc" } }));

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.post("/warehouses", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        name: z.string().trim().min(1),

        code: z

          .string()

          .trim()

          .min(1)

          .transform((x) => x.toUpperCase()),

        address: z.any().optional(),

        isActive: z.boolean().default(true),

      })

      .parse(req.body);

    return ok(res, await db.warehouse.create({ data: b }), 201);

  } catch (e) {

    return fail(res, e);

  }

});

router.patch("/warehouses/:id", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        name: z.string().trim().min(1).optional(),

        code: z

          .string()

          .trim()

          .min(1)

          .transform((x) => x.toUpperCase())

          .optional(),

        address: z.any().optional(),

        isActive: z.boolean().optional(),

      })

      .parse(req.body);

    return ok(

      res,

      await db.warehouse.update({ where: { id: n(req.params.id) }, data: b }),

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.delete("/warehouses/:id", auth, adminOnly, async (req, res) => {

  try {

    const id = n(req.params.id);

    const [inv, from, to] = await Promise.all([

      db.warehouseInventory.count({

        where: {

          warehouseId: id,

          OR: [{ quantity: { not: 0 } }, { reserved: { not: 0 } }],

        },

      }),

      db.stockTransfer.count({ where: { fromWarehouseId: id } }),

      db.stockTransfer.count({ where: { toWarehouseId: id } }),

    ]);

    if (inv || from || to)

      throw new Error(

        "Warehouse has inventory or transfer history. Disable it instead of deleting it.",

      );

    await db.warehouse.delete({ where: { id } });

    return ok(res, { deleted: true });

  } catch (e) {

    return fail(res, e);

  }

});

router.get("/warehouses/:id/stock", auth, adminOnly, async (req, res) => {

  try {

    const rows = await db.warehouseInventory.findMany({

      where: { warehouseId: n(req.params.id) },

      orderBy: { quantity: "asc" },

    });

    const ids = rows.map((x: any) => x.variantId);

    const vars = ids.length

      ? await db.productVariant.findMany({

          where: { id: { in: ids } },

          include: variantInclude,

        })

      : [];

    const m = new Map(vars.map((v: any) => [v.id, variantView(v)]));

    return ok(

      res,

      rows.map((x: any) => ({

        ...x,

        available: n(x.quantity) - n(x.reserved),

        variant: m.get(x.variantId),

      })),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});



// ---------- Suppliers ----------

router.get("/suppliers", auth, adminOnly, async (_req, res) => {

  try {

    return ok(res, await db.supplier.findMany({ orderBy: { name: "asc" } }));

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.post("/suppliers", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        name: z.string().trim().min(1),

        email: z

          .union([z.string().email(), z.literal("")])

          .nullable()

          .optional(),

        phone: z.string().nullable().optional(),

        gstin: z.string().nullable().optional(),

        address: z.any().optional(),

      })

      .parse(req.body);

    return ok(

      res,

      await db.supplier.create({ data: { ...b, email: b.email || null } }),

      201,

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.patch("/suppliers/:id", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        name: z.string().trim().min(1).optional(),

        email: z

          .union([z.string().email(), z.literal("")])

          .nullable()

          .optional(),

        phone: z.string().nullable().optional(),

        gstin: z.string().nullable().optional(),

        address: z.any().optional(),

      })

      .parse(req.body);

    return ok(

      res,

      await db.supplier.update({

        where: { id: n(req.params.id) },

        data: { ...b, ...("email" in b ? { email: b.email || null } : {}) },

      }),

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.delete("/suppliers/:id", auth, adminOnly, async (req, res) => {

  try {

    const id = n(req.params.id);

    if (await db.purchaseOrder.count({ where: { supplierId: id } }))

      throw new Error("Supplier has purchase orders and cannot be deleted");

    await db.supplier.delete({ where: { id } });

    return ok(res, { deleted: true });

  } catch (e) {

    return fail(res, e);

  }

});



// ---------- Purchase Orders ----------

const poItem = z.object({

  variantId: z.coerce.number().int().positive(),

  quantity: z.coerce.number().int().positive(),

  unitCost: z.coerce.number().nonnegative().default(0),

});

router.get("/purchase-orders", auth, adminOnly, async (_req, res) => {

  try {

    const rows = await db.purchaseOrder.findMany({

      orderBy: { createdAt: "desc" },

      include: { supplier: true },

    });

    const ids = [

      ...new Set(

        rows.flatMap((x: any) =>

          (x.items || []).map((i: any) => n(i.variantId)),

        ),

      ),

    ];

    const vars = ids.length

      ? await db.productVariant.findMany({

          where: { id: { in: ids } },

          include: variantInclude,

        })

      : [];

    const vm = new Map(vars.map((v: any) => [v.id, variantView(v)]));

    return ok(

      res,

      rows.map((po: any) => ({

        ...po,

        items: (po.items || []).map((i: any) => ({

          ...i,

          variant: vm.get(n(i.variantId)) || null,

        })),

      })),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.post("/purchase-orders", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        supplierId: z.coerce.number().int().positive(),

        warehouseId: z.coerce.number().int().positive().optional(),

        items: z.array(poItem).min(1),

        expectedAt: z.coerce.date().nullable().optional(),

        notes: z.string().max(1000).optional(),

      })

      .parse(req.body);

    const items = b.items.map((i) => ({

      ...i,

      receivedQuantity: 0,

      ...(b.warehouseId ? { warehouseId: b.warehouseId } : {}),

      ...(b.notes ? { notes: b.notes } : {}),

    }));

    const total = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);

    return ok(

      res,

      await db.purchaseOrder.create({

        data: {

          supplierId: b.supplierId,

          items,

          total,

          expectedAt: b.expectedAt,

          status: "DRAFT",

        },

      }),

      201,

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.patch(

  "/purchase-orders/:id/status",

  auth,

  adminOnly,

  async (req, res) => {

    try {

      const id = n(req.params.id),

        { status } = z

          .object({ status: z.enum(["DRAFT", "ORDERED", "CANCELLED"]) })

          .parse(req.body);

      const po = await db.purchaseOrder.findUnique({ where: { id } });

      if (!po) throw new Error("Purchase order not found");

      if (["RECEIVED", "CANCELLED"].includes(po.status))

        throw new Error("Closed purchase order cannot be changed");

      return ok(

        res,

        await db.purchaseOrder.update({ where: { id }, data: { status } }),

      );

    } catch (e) {

      return fail(res, e);

    }

  },

);

router.post(

  "/purchase-orders/:id/receive",

  auth,

  adminOnly,

  async (req: AuthRequest, res) => {

    try {

      const id = n(req.params.id),

        b = z

          .object({

            warehouseId: z.coerce.number().int().positive(),

            items: z

              .array(

                z.object({

                  variantId: z.coerce.number().int().positive(),

                  quantity: z.coerce.number().int().positive(),

                }),

              )

              .min(1),

          })

          .parse(req.body);

      const requestKey = z.string().uuid().parse(req.header("Idempotency-Key"));
      const receiptKey = `inventory-receive:${req.user!.userId}:${id}:${requestKey}`;
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(b)).digest("hex");
      const result = await db.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receiptKey},0))::text`;
        const receipt = await tx.storeSetting.findUnique({where:{key:receiptKey}});
        if(receipt){if(receipt.value.fingerprint!==fingerprint)throw new Error("Receipt key already used for another delivery.");return receipt.value.result;}


        await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;
        const po = await tx.purchaseOrder.findUnique({ where: { id } });

        if (!po) throw new Error("Purchase order not found");

        if (po.status === "CANCELLED")

          throw new Error("Purchase order is cancelled");

        if (po.status === "RECEIVED")

          throw new Error("Purchase order is already fully received");

        const ordered: any[] = (po.items || []) as any[];

        for (const r of b.items) {

          const o = ordered.find((x) => n(x.variantId) === r.variantId);

          if (!o)

            throw new Error(

              `Variant ${r.variantId} is not on this purchase order`,

            );

          const received = n(o.receivedQuantity);

          if (received + r.quantity > n(o.quantity))

            throw new Error(

              `Received quantity exceeds ordered quantity for variant ${r.variantId}`,

            );

          await move(tx, {

            variantId: r.variantId,

            warehouseId: b.warehouseId,

            type: "IN",

            delta: r.quantity,

            referenceType: "PURCHASE_ORDER",

            referenceId: String(id),

            userId: req.user!.userId,

          });

          o.receivedQuantity = received + r.quantity;

          o.lastReceivedWarehouseId = b.warehouseId;

        }

        const complete = ordered.every(

          (x) => n(x.receivedQuantity) >= n(x.quantity),

        );

        const any = ordered.some((x) => n(x.receivedQuantity) > 0);

        const updated = await tx.purchaseOrder.update({

          where: { id },

          data: {

            items: ordered,

            status: complete ? "RECEIVED" : any ? "PARTIAL" : po.status,

            receivedAt: complete ? new Date() : null,

          },

        });

        await tx.storeSetting.create({data:{key:receiptKey,value:JSON.parse(JSON.stringify({fingerprint,result:updated}))}});
        return updated;
      });

      return ok(res, result);

    } catch (e) {

      return fail(res, e);

    }

  },

);



// ---------- Stock Transfers ----------

const transferItem = z.object({

  variantId: z.coerce.number().int().positive(),

  quantity: z.coerce.number().int().positive(),

});

router.get("/transfers", auth, adminOnly, async (_req, res) => {

  try {

    const rows = await db.stockTransfer.findMany({

      orderBy: { createdAt: "desc" },

      include: { fromWarehouse: true, toWarehouse: true },

    });

    const ids = [

      ...new Set(

        rows.flatMap((x: any) =>

          (x.items || []).map((i: any) => n(i.variantId)),

        ),

      ),

    ];

    const vars = ids.length

      ? await db.productVariant.findMany({

          where: { id: { in: ids } },

          include: variantInclude,

        })

      : [];

    const vm = new Map(vars.map((v: any) => [v.id, variantView(v)]));

    return ok(

      res,

      rows.map((t: any) => ({

        ...t,

        items: (t.items || []).map((i: any) => ({

          ...i,

          variant: vm.get(n(i.variantId)) || null,

        })),

      })),

    );

  } catch (e) {

    return fail(res, e, 500);

  }

});

router.post("/transfers", auth, adminOnly, async (req, res) => {

  try {

    const b = z

      .object({

        fromWarehouseId: z.coerce.number().int().positive(),

        toWarehouseId: z.coerce.number().int().positive(),

        items: z.array(transferItem).min(1),

        notes: z.string().max(1000).optional(),

      })

      .parse(req.body);

    if (b.fromWarehouseId === b.toWarehouseId)

      throw new Error("Source and destination warehouses must differ");

    return ok(

      res,

      await db.stockTransfer.create({

        data: { ...b, items: b.items, status: "DRAFT" },

      }),

      201,

    );

  } catch (e) {

    return fail(res, e);

  }

});

router.patch(

  "/transfers/:id/status",

  auth,

  adminOnly,

  async (req: AuthRequest, res) => {

    try {

      const id = n(req.params.id),

        { status } = z

          .object({ status: z.enum(["IN_TRANSIT", "COMPLETED", "CANCELLED"]) })

          .parse(req.body);

      const result = await db.$transaction(async (tx: any) => {

        await tx.$queryRaw`SELECT id FROM "StockTransfer" WHERE id = ${id} FOR UPDATE`;
        const t = await tx.stockTransfer.findUnique({ where: { id } });

        if (!t) throw new Error("Transfer not found");

        if (["COMPLETED", "CANCELLED"].includes(t.status))

          throw new Error("Transfer is already closed");

        const items: any[] = t.items as any[];

        if (status === "IN_TRANSIT") {

          if (t.status !== "DRAFT")

            throw new Error("Only draft transfers can be dispatched");

          for (const i of items)

            await move(tx, {

              variantId: n(i.variantId),

              warehouseId: t.fromWarehouseId,

              type: "TRANSFER_OUT",

              delta: -n(i.quantity),

              referenceType: "STOCK_TRANSFER",

              referenceId: String(id),

              note: "Transfer dispatched",

              userId: req.user!.userId,

            });

        }

        if (status === "COMPLETED") {

          if (t.status !== "IN_TRANSIT")

            throw new Error(

              "Transfer must be in transit before it can be received",

            );

          for (const i of items)

            await move(tx, {

              variantId: n(i.variantId),

              warehouseId: t.toWarehouseId,

              type: "TRANSFER_IN",

              delta: n(i.quantity),

              referenceType: "STOCK_TRANSFER",

              referenceId: String(id),

              note: "Transfer received",

              userId: req.user!.userId,

            });

        }

        if (status === "CANCELLED" && t.status === "IN_TRANSIT") {

          for (const i of items)

            await move(tx, {

              variantId: n(i.variantId),

              warehouseId: t.fromWarehouseId,

              type: "IN",

              delta: n(i.quantity),

              referenceType: "STOCK_TRANSFER",

              referenceId: String(id),

              note: "In-transit transfer cancelled",

              userId: req.user!.userId,

            });

        }

        return tx.stockTransfer.update({

          where: { id },

          data: {

            status,

            completedAt: status === "COMPLETED" ? new Date() : null,

          },

        });

      });

      return ok(res, result);

    } catch (e) {

      return fail(res, e);

    }

  },

);



export default router;
