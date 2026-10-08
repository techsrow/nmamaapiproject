// src/routes/checkout.ts

import { Router } from "express";

import { prisma } from "../lib/prisma";

import { auth } from "../middleware/auth";

import { z } from "zod";

import { Prisma, PaymentProvider, PaymentMethod } from "@prisma/client";



import { validateAndComputeCoupon } from "../services/coupon.service";

import { shiprocketRequest } from "../services/shiprocket.service";



const router = Router();



/* ======================================================

   SCHEMAS

\====================================================== */



const ItemSchema = z.object({

  variantId: z.number(),

  quantity: z.number().min(1),

});



const PaymentMethodSchema = z.enum(["COD", "Prepaid"]);



const BaseCheckoutSchema = z.object({

  items: z.array(ItemSchema).min(1),



  shippingAddress: z.string().min(1),

  shippingCity: z.string().min(1),

  shippingCountry: z.string().min(1),

  shippingPostalCode: z.string().min(1),



  // ✅ used to store contact for shiprocket even for logged-in user

  contactPhone: z.string().optional().nullable(),



  deliveryDate: z.string(), // YYYY-MM-DD

  deliveryTimeSlot: z.string(),



  couponCode: z.string().optional().nullable(),



  paymentMethod: z.enum(["COD", "Prepaid"]).optional().default("COD"),

  autoShiprocket: z.boolean().optional().default(false),

  orderNotes: z.string().max(1000).optional().nullable(),

  giftMessage: z.string().max(500).optional().nullable(),

  billingAddress: z.record(z.string(), z.any()).optional().nullable(),

  deliveryOption: z.string().max(100).optional().nullable(),

  expressCheckout: z.boolean().optional().default(false),

});



const GuestSchema = BaseCheckoutSchema.extend({

  customerEmail: z.string().email(),

  customerName: z.string().min(1),



  // guestPhone optional; we still fallback to contactPhone

  guestPhone: z.string().min(10).max(15).optional().nullable(),



  paymentMethod: PaymentMethodSchema.default("COD"),

  autoShiprocket: z.boolean().optional().default(false),

});



/* ======================================================

   HELPERS

\====================================================== */



function toNumber(d: any) {

  if (d == null) return null;

  if (d instanceof Prisma.Decimal) return d.toNumber();

  return Number(d);

}



function unitPriceFromVariant(v: any) {

  const discount = toNumber(v.discountPrice);

  const price = toNumber(v.price);

  return discount ?? price ?? 0;

}



// ✅ Shipping threshold must be based on ORIGINAL subtotal (pre-discount)

// function computeTotals(discountedSubtotal: number, originalSubtotal: number) {

//   const shipping = originalSubtotal >= 500 ? 0 : 50;

//   const tax = discountedSubtotal * 0.0;

//   const total = discountedSubtotal + shipping + tax;

//   return { shipping, tax, total };

// }



function computeTotals(

  discountedSubtotal: number,

  originalSubtotal: number,

  items: {

    quantity: number;

  }[]

) {

  // total quantity

  const totalQuantity =

    items.reduce(

      (sum, item) =>

        sum + item.quantity,

      0

    );



  // shipping rule

  const shipping =

    totalQuantity <= 2

      ? 120

      : totalQuantity <= 4

      ? 240

      : totalQuantity <= 7

      ? 360

      : totalQuantity <= 10

      ? 480

      : 480;



  const tax = 0;



  const total =

    discountedSubtotal +

    shipping +

    tax;



  return {

    shipping,

    tax,

    total,

  };

}



function normalizePhone(phone: string | null | undefined) {

  const s = String(phone || "").replace(/\D/g, "");

  return s.length > 10 ? s.slice(-10) : s;

}



/**

 * ✅ Auto-push to Shiprocket (COD only recommended)

 */

async function pushToShiprocketByOrderId(orderId: number) {

  const order = await prisma.order.findUnique({

    where: { id: orderId },

    include: { orderItems: true },

  });



  if (!order) throw new Error("Order not found");

  if (order.shipmentId) return { already: true, shipmentId: order.shipmentId };



  const phone = normalizePhone(order.guestPhone);

  if (!order.customerName || !phone) throw new Error("Missing customerName/phone");

  if (!order.shippingAddress || !order.shippingCity || !order.shippingPostalCode)

    throw new Error("Missing shipping address/city/pincode");



  const payload = {

    order_id: `ORDER\_${order.id}`,

    order_date: (order.orderDate ? new Date(order.orderDate) : new Date()).toISOString(),



    billing_customer_name: order.customerName || "Customer",

    billing_phone: phone,

    billing_address: order.shippingAddress || "",

    billing_city: order.shippingCity || "",

    billing_pincode: order.shippingPostalCode || "",

    billing_country: order.shippingCountry || "India",



    payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",

    sub_total: Number(order.totalAmount),



    order_items: order.orderItems.map((i) => ({

      name: i.productName,

      sku: i.sku || `SKU-${i.id}`,

      units: i.quantity,

      selling_price: Number(i.unitPrice),

    })),

  };



  const shipment: any = await shiprocketRequest({

    method: "POST",

    url: "/orders/create/adhoc",

    data: payload,

  });



  await prisma.order.update({

    where: { id: order.id },

    data: {

      shippingProvider: "Shiprocket",

      shipmentStatus: "Created",

      shipmentId: shipment?.shipment_id ? String(shipment.shipment_id) : null,

      awbNumber: shipment?.awb_code || null,

      trackingUrl: shipment?.tracking_url || null,

      shippingMeta: shipment,

      shippedAt: new Date(),

    },

  });



  return shipment;

}



/* ======================================================

   USER CHECKOUT (LOGGED IN)

   POST /api/checkout

\====================================================== */

router.post("/", auth, async (req: any, res) => {

  try {

    const body = BaseCheckoutSchema.parse(req.body);

    const userId = req.user!.userId;



    const variantIds = body.items.map((i) => i.variantId);



    const variants = await prisma.productVariant.findMany({

      where: { id: { in: variantIds }, isActive: true },

      include: {

        product: {

          select: {

            id: true,

            name: true,

            imageUrl: true,

            categoryId: true,

            subCategoryId: true,

            isActive: true,

          },

        },

      },

    });



    const map = new Map(variants.map((v) => [v.id, v]));



    let subtotal = 0;

    const orderItems: any[] = [];

    const computedItems: any[] = [];



    for (const it of body.items) {

      const variant = map.get(it.variantId);



      if (!variant || !variant.product?.isActive) {

        return res.status(400).json({ success: false, message: `Variant ${it.variantId} not found` });

      }



      if (variant.stockQuantity < it.quantity) {

        return res.status(400).json({ success: false, message: `Only ${variant.stockQuantity} items available` });

      }



      const unitPrice = unitPriceFromVariant(variant);

      subtotal += unitPrice * it.quantity;



      const variantLabel = [variant.weight, variant.size, variant.color].filter(Boolean).join(" ");



      orderItems.push({

        productId: variant.productId,

        variantId: variant.id,

        quantity: it.quantity,

        unitPrice,

        productName: variant.product.name,

        variantLabel: variantLabel || null,

        sku: variant.sku ?? null,

        imageUrl: variant.product.imageUrl ?? null,

      });



      computedItems.push({

        quantity: it.quantity,

        unitPrice,

        productId: variant.productId,

        categoryId: variant.product.categoryId ?? null,

        subCategoryId: variant.product.subCategoryId ?? null,

      });

    }



    // ✅ Coupon

    const { coupon, discount } = await validateAndComputeCoupon({

      couponCode: body.couponCode ?? null,

      userId,

      subtotal,

      computedItems,

    });



    const discountedSubtotal = Math.max(0, subtotal - discount);

    const {

  shipping,

  tax,

  total,

} = computeTotals(

  discountedSubtotal,

  subtotal,

  body.items

);



    const provider: PaymentProvider =

      body.paymentMethod === "COD" ? PaymentProvider.COD : PaymentProvider.Razorpay;



    const method: PaymentMethod =

      body.paymentMethod === "COD" ? PaymentMethod.COD : PaymentMethod.Prepaid;



    const user = await prisma.user.findUnique({ where: { id: userId } });



    // ✅ IMPORTANT: store phone in order.guestPhone so shiprocket works for logged-in too

    const contactPhone = normalizePhone(body.contactPhone || user?.phone || null);



   const result =

  await prisma.$transaction(

    async (tx) => {

      // Create order

      const created =

        await tx.order.create(

          {

            data: {

              userId,



              totalAmount:

                new Prisma.Decimal(

                  total

                ),



              status:

                "Pending",



              paymentStatus:

                body.paymentMethod ===

                "COD"

                  ? "Pending"

                  : "Created",



              paymentMethod:

                method,



              orderNotes: body.orderNotes ?? null,

              giftMessage: body.giftMessage ?? null,

              billingAddress: body.billingAddress ?? undefined,

              shippingAddressJson: { line1: body.shippingAddress, city: body.shippingCity, country: body.shippingCountry, postalCode: body.shippingPostalCode },

              deliveryOption: body.deliveryOption ?? null,

              expressCheckout: body.expressCheckout ?? false,



              shippingAddress:

                body.shippingAddress,



              shippingCity:

                body.shippingCity,



              shippingCountry:

                body.shippingCountry,



              shippingPostalCode:

                body.shippingPostalCode,



              deliveryDate:

                new Date(

                  body.deliveryDate

                ),



              deliveryTimeSlot:

                body.deliveryTimeSlot,



              customerEmail:

                user?.email ??

                null,



              customerName:

                user

                  ? `${user.firstName} ${user.lastName}`

                  : null,



              // Needed for Shiprocket

              guestPhone:

                contactPhone ||

                null,



              couponId:

                coupon?.id ??

                null,



              couponCode:

                coupon?.code ??

                null,



              couponDiscount:

                coupon

                  ? new Prisma.Decimal(

                      discount

                    )

                  : null,



              orderItems: {

                create:

                  orderItems,

              },

            },

          }

        );



      // Create payment row

      const payment =

        await tx.payment.create(

          {

            data: {

              orderId:

                created.id,



              provider,



              paymentMethod:

                method,

              paymentStatus:

                body.paymentMethod ===

                "COD"

                  ? "Pending"

                  : "Created",



              amount:

                new Prisma.Decimal(

                  total

                ),

              currency: "INR",

              isCaptured: false,

            },

          }

        );



      // COD only:

      // deduct stock + clear cart

      if (

        body.paymentMethod ===

        "COD"

      ) {

        // Deduct stock

        for (const it of body.items) {

          await tx.productVariant.update(

            {

              where: {

                id:

                  it.variantId,

              },

              data: {

                stockQuantity:

                  {

                    decrement:

                      it.quantity,

                  },

              },

            }

          );

        }



        // Clear cart

        await tx.cartItem.deleteMany(

          {

            where: {

              userId,

            },

          }

        );

      }



      // Update coupon usage

      if (coupon) {

        await tx.coupon.update(

          {

            where: {

              id:

                coupon.id,

            },

            data: {

              usedCount:

                {

                  increment: 1,

                },

            },

          }

        );

      }



      return {

        created,

        payment,

      };

    }

  );



    if (body.autoShiprocket && body.paymentMethod === "COD") {

      try {

        await pushToShiprocketByOrderId(result.created.id);

      } catch (e) {

        console.error("Shiprocket auto-push failed:", e);

      }

    }



    return res.json({

      success: true,

      message: "Order created successfully",

      data: {

        orderId: result.created.id,

        paymentId: result.payment.id, // ✅ critical for retry + thank-you

        orderNumber: `ORD-${String(result.created.id).padStart(6, "0")}`,



        subtotal: Number(subtotal.toFixed(2)),

        discountedSubtotal: Number(discountedSubtotal.toFixed(2)),

        couponDiscount: discount,



        shippingFee: shipping,

        taxAmount: tax,

        totalAmount: Number(toNumber(result.created.totalAmount)!.toFixed(2)),



        status: result.created.status,

        orderDate: result.created.orderDate,

        paymentMethod: method,

        paymentStatus: result.created.paymentStatus,



        autoShiprocket: body.autoShiprocket && body.paymentMethod === "COD",

      },

    });

  } catch (err: any) {

    return res.status(400).json({ success: false, message: err.message });

  }

});



/* ======================================================

   GUEST CHECKOUT

   POST /api/checkout/guest

\====================================================== */

router.post("/guest", async (req, res) => {

  try {

    const body = GuestSchema.parse(req.body);



    const variantIds = body.items.map((i) => i.variantId);



    const variants = await prisma.productVariant.findMany({

      where: { id: { in: variantIds }, isActive: true },

      include: {

        product: {

          select: {

            id: true,

            name: true,

            imageUrl: true,

            categoryId: true,

            subCategoryId: true,

            isActive: true,

          },

        },

      },

    });



    const map = new Map(variants.map((v) => [v.id, v]));



    let subtotal = 0;

    const orderItems: any[] = [];

    const computedItems: any[] = [];



    for (const it of body.items) {

      const variant = map.get(it.variantId);



      if (!variant || !variant.product?.isActive) {

        return res.status(400).json({ success: false, message: `Variant ${it.variantId} not found` });

      }



      if (variant.stockQuantity < it.quantity) {

        return res.status(400).json({ success: false, message: `Only ${variant.stockQuantity} items available` });

      }



      const unitPrice = unitPriceFromVariant(variant);

      subtotal += unitPrice * it.quantity;



      const variantLabel = [variant.weight, variant.size, variant.color].filter(Boolean).join(" ");



      orderItems.push({

        productId: variant.productId,

        variantId: variant.id,

        quantity: it.quantity,

        unitPrice,

        productName: variant.product.name,

        variantLabel: variantLabel || null,

        sku: variant.sku ?? null,

        imageUrl: variant.product.imageUrl ?? null,

      });



      computedItems.push({

        quantity: it.quantity,

        unitPrice,

        productId: variant.productId,

        categoryId: variant.product.categoryId ?? null,

        subCategoryId: variant.product.subCategoryId ?? null,

      });

    }



    const { coupon, discount } = await validateAndComputeCoupon({

      couponCode: body.couponCode ?? null,

      userId: null,

      subtotal,

      computedItems,

    });



    const discountedSubtotal = Math.max(0, subtotal - discount);

    const {

  shipping,

  tax,

  total,

} = computeTotals(

  discountedSubtotal,

  subtotal,

  body.items

);



    const provider: PaymentProvider =

      body.paymentMethod === "COD" ? PaymentProvider.COD : PaymentProvider.Razorpay;



    const method: PaymentMethod =

      body.paymentMethod === "COD" ? PaymentMethod.COD : PaymentMethod.Prepaid;



    // ✅ choose guest phone fallback

    const guestPhone = normalizePhone(body.guestPhone || body.contactPhone || null);



   const result =

  await prisma.$transaction(

    async (tx) => {

      const created =

        await tx.order.create(

          {

            data: {

              userId:

                null,



              totalAmount:

                new Prisma.Decimal(

                  total

                ),



              status:

                "Pending",



              paymentStatus:

                body.paymentMethod ===

                "COD"

                  ? "Pending"

                  : "Created",



              paymentMethod:

                method,



              orderNotes: body.orderNotes ?? null,

              giftMessage: body.giftMessage ?? null,

              billingAddress: body.billingAddress ?? undefined,

              shippingAddressJson: { line1: body.shippingAddress, city: body.shippingCity, country: body.shippingCountry, postalCode: body.shippingPostalCode },

              deliveryOption: body.deliveryOption ?? null,

              expressCheckout: body.expressCheckout ?? false,



              shippingAddress:

                body.shippingAddress,



              shippingCity:

                body.shippingCity,



              shippingCountry:

                body.shippingCountry,



              shippingPostalCode:

                body.shippingPostalCode,



              deliveryDate:

                new Date(

                  body.deliveryDate

                ),



              deliveryTimeSlot:

                body.deliveryTimeSlot,



              customerEmail:

                body.customerEmail,



              customerName:

                body.customerName,



              guestPhone:

                guestPhone ||

                null,



              couponId:

                coupon?.id ??

                null,



              couponCode:

                coupon?.code ??

                null,



              couponDiscount:

                coupon

                  ? new Prisma.Decimal(

                      discount

                    )

                  : null,



              orderItems: {

                create:

                  orderItems,

              },

            },

          }

        );



      const payment =

        await tx.payment.create(

          {

            data: {

              orderId:

                created.id,



              provider,



              paymentMethod:

                method,

              paymentStatus:

                body.paymentMethod ===

                "COD"

                  ? "Pending"

                  : "Created",



              amount:

                new Prisma.Decimal(

                  total

                ),

              currency: "INR",

              isCaptured: false,

            },

          }

        );



      // Deduct stock ONLY for COD

      if (

        body.paymentMethod ===

        "COD"

      ) {

        for (const it of body.items) {

          await tx.productVariant.update(

            {

              where: {

                id:

                  it.variantId,

              },

              data: {

                stockQuantity:

                  {

                    decrement:

                      it.quantity,

                  },

              },

            }

          );

        }

      }



      // Update coupon usage

      if (coupon) {

        await tx.coupon.update(

          {

            where: {

              id:

                coupon.id,

            },

            data: {

              usedCount:

                {

                  increment: 1,

                },

            },

          }

        );

      }



      return {

        created,

        payment,

      };

    }

  );



    if (body.autoShiprocket && body.paymentMethod === "COD") {

      try {

        await pushToShiprocketByOrderId(result.created.id);

      } catch (e) {

        console.error("Shiprocket auto-push failed:", e);

      }

    }



    return res.json({

      success: true,

      message: "Order created successfully",

      data: {

        orderId: result.created.id,

        paymentId: result.payment.id,

        orderNumber: `ORD-${String(result.created.id).padStart(6, "0")}`,



        subtotal: Number(subtotal.toFixed(2)),

        discountedSubtotal: Number(discountedSubtotal.toFixed(2)),

        couponDiscount: discount,



        shippingFee: shipping,

        taxAmount: tax,

        totalAmount: Number(toNumber(result.created.totalAmount)!.toFixed(2)),



        status: result.created.status,

        orderDate: result.created.orderDate,

        paymentMethod: method,

        paymentStatus: result.created.paymentStatus,



        autoShiprocket: body.autoShiprocket && body.paymentMethod === "COD",

      },

    });

  } catch (err: any) {

    return res.status(400).json({ success: false, message: err.message });

  }

});



/* ======================================================

   PUBLIC THANK YOU SAFE ENDPOINT (Guest only)

   GET /api/checkout/public/:id?phone=XXXXXXXXXX

\====================================================== */

router.get("/public/:id", async (req, res) => {

  try {

    const id = Number(req.params.id);

    if (!id) return res.status(400).json({ success: false, message: "Invalid order id" });



    const phone = String(req.query.phone || "").replace(/\D/g, "");



    const order = await prisma.order.findUnique({

      where: { id },

      select: {

        id: true,

        status: true,

        paymentStatus: true,

        paymentMethod: true,

        totalAmount: true,

        currency: true,

        customerName: true,

        customerEmail: true,

        guestPhone: true,

        shippingAddress: true,

        shippingCity: true,

        shippingCountry: true,

        shippingPostalCode: true,

        orderDate: true,

        orderItems: {

          orderBy: { id: "asc" },

          select: {

            quantity: true,

            unitPrice: true,

            productName: true,

            variantLabel: true,

            imageUrl: true,

          },

        },

      },

    });



    if (!order) return res.status(404).json({ success: false, message: "Order not found" });



    const guestPhone = String(order.guestPhone || "").replace(/\D/g, "");

    if (!guestPhone) return res.status(403).json({ success: false, message: "Unauthorized" });



    const last10 = (s: string) => (s.length > 10 ? s.slice(-10) : s);

    if (last10(phone) !== last10(guestPhone)) {

      return res.status(403).json({ success: false, message: "Unauthorized" });

    }



    return res.json({

      success: true,

      data: { ...order, orderNumber: `ORD-${String(order.id).padStart(6, "0")}` },

    });

  } catch (e: any) {

    return res.status(400).json({ success: false, message: e.message });

  }

});



/* ======================================================

   LOGGED-IN THANK YOU / ORDER FETCH

   GET /api/checkout/order/:orderId (auth required)

\====================================================== */

router.get("/order/:orderId", auth, async (req: any, res) => {

  try {

    const orderId = Number(req.params.orderId);

    if (!orderId) return res.status(400).json({ success: false, message: "Invalid order id" });



    const userId = req.user!.userId;



    const order = await prisma.order.findFirst({

      where: { id: orderId, userId },

      include: {

        orderItems: { orderBy: { id: "asc" } },

        payments: { orderBy: { createdAt: "desc" } },

      },

    });



    if (!order) return res.status(404).json({ success: false, message: "Order not found" });



    return res.json({

      success: true,

      data: {

        ...order,

        orderNumber: `ORD-${String(order.id).padStart(6, "0")}`,

        payment: order.payments?.[0] || null,

      },

    });

  } catch (e: any) {

    return res.status(400).json({ success: false, message: e.message });

  }

});



export default router;
