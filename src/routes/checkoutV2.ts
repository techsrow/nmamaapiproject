import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import axios from "axios";
import { prisma } from "../lib/prisma";
import { optionalAuth } from "../middleware/optionalAuth";
import { validateAndComputeCoupon } from "../services/coupon.service";
import { getShippingRates } from "../services/shipping/rate.service";
import { calculateCheckoutTax } from "../services/checkoutTax.service";
import crypto from "crypto";
import { PaymentMethod, PaymentProvider, Prisma } from "@prisma/client";
import { issueGuestOrderAccess } from "../services/payments/orderAccess";
const router = Router();
type CheckoutRequest = Request & {
  user?: { userId: number };
};
class CheckoutError extends Error { }
router.use(optionalAuth);
router.use((req, res, next) => {
  if (req.get("authorization") && !(req as CheckoutRequest).user) {
    return res.status(401).json({ success: false, message: "Please sign in again." });
  }
  next();
});
// server.ts must register express.json() before this router.
router.use((req, res, next) => {
  if (req.method !== "POST") return next();
  if (!req.is("application/json")) {
    return res.status(415).json({
      success: false,
      message: "Send Content-Type: application/json.",
    });
  }
  if (
    req.body === null ||
    typeof req.body !== "object" ||
    Array.isArray(req.body) ||
    Buffer.isBuffer(req.body)
  ) {
    return res.status(400).json({
      success: false,
      message: "requestBody: Send a JSON object.",
    });
  }
  next();
});
const tokenSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{16,128}$/, "Invalid guest cart token.");
const addressSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(8).max(20),
  line1: z.string().trim().min(1).max(300),
  line2: z.string().trim().max(300).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, "Enter a valid six-digit PIN code."),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .default("IN")
    .refine((value) => value === "IN", {
      message: "Delivery is currently available within India.",
    }),
});
const checkoutSchema = z
  .object({
    cartToken: tokenSchema.optional(),
    email: z.string().trim().email().optional(),
    shippingAddress: addressSchema,
    billingSameAsShipping: z.boolean().default(true),
    billingAddress: addressSchema.optional(),
    deliveryOption: z.string().trim().min(1).max(300).optional(),
    orderNotes: z.string().trim().max(1000).optional(),
    giftMessage: z.string().trim().max(500).optional(),
    couponCode: z.string().trim().max(100).optional(),
    // Resolve omitted values using enabled providers.
    paymentMethod: z.enum(["COD", "Prepaid"]).optional(),
    paymentProvider: z.string().trim().min(1).max(100).optional(),
    expressCheckout: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.billingSameAsShipping ||
      value.billingAddress !== undefined,
    {
      message: "Billing address is required.",
      path: ["billingAddress"],
    },
  );
function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CheckoutError("Invalid checkout amount.");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
function configuredPositiveNumber(
  key: string,
  fallbackKey?: string,
): number {
  const raw =
    process.env[key]?.trim() ||
    (fallbackKey ? process.env[fallbackKey]?.trim() : "");
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value <= 0) {
    throw new CheckoutError(
      "Package settings are incomplete. Please contact the store.",
    );
  }
  return value;
}
function weightInKg(value: unknown): number {
  const text = String(value ?? "").trim().toLowerCase();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(kg|g)$/);
  if (match) {
    const weight = Number(match[1]);
    const kilograms = match[2] === "g" ? weight / 1000 : weight;
    if (Number.isFinite(kilograms) && kilograms > 0) {
      return kilograms;
    }
  }
  // Explicit store configuration; no guessed product weight.
  return configuredPositiveNumber("SHIPPING_DEFAULT_ITEM_WEIGHT_KG");
}
function errorResponse(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    if (!issue) return "Please check your checkout details.";
    const field = issue.path.length
      ? issue.path.map(String).join(".")
      : "requestBody";
    return `${field}: ${issue.message}`.slice(0, 180);
  }
  if (error instanceof CheckoutError) {
    return error.message.slice(0, 180);
  }
  if (axios.isAxiosError(error)) {
    return "A shipping provider could not return delivery rates.";
  }
  // Existing coupon/rate services return customer-facing Error messages.
  if (error instanceof Error) {
    if (
      /prisma|invocation|database|connect|credential|secret|token not received|sql/i.test(
        error.message,
      )
    ) {
      return "Checkout is temporarily unavailable. Please try again.";
    }
    return error.message.slice(0, 180);
  }
  return "Checkout could not be prepared. Please try again.";
}
function logFailure(error: unknown): void {
  // Do not log request bodies, cart tokens, customer data or credentials.
  console.error("Checkout quote failed", {
    type: error instanceof Error ? error.name : "UnknownError",
    ...(axios.isAxiosError(error)
      ? {
        upstreamStatus: error.response?.status,
        code: error.code,
      }
      : {}),
    ...(error instanceof z.ZodError
      ? {
        fields: error.issues.map((issue) =>
          issue.path.map(String).join("."),
        ),
      }
      : {}),
  });
}
router.post("/validate-address", (req, res) => {
  try {
    const normalized = addressSchema.parse(req.body);
    return res.json({
      success: true,
      data: { valid: true, normalized },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: errorResponse(error),
    });
  }
});
async function prepareQuote(req: CheckoutRequest) {
  const body = checkoutSchema.parse(req.body);
  const include = {
    variant: { include: { product: true } },
  } as const;
  let savedCoupon: string | null = null;
  const cartItems = await (async () => {
    if (req.user) {
      return prisma.cartItem.findMany({
        where: { userId: req.user.userId },
        include,
      });
    }
    const cartToken = tokenSchema.parse(
      body.cartToken || req.get("x-cart-token"),
    );
    const cart = await prisma.guestCart.findUnique({
      where: { token: cartToken },
    });
    if (!cart) {
      throw new CheckoutError(
        "Your bag session has expired. Please reload your bag.",
      );
    }
    savedCoupon = cart.couponCode;
    return prisma.guestCartItem.findMany({
      where: { cartId: cart.id },
      include,
    });
  })();
  if (!cartItems.length) {
    throw new CheckoutError("Your bag is empty.");
  }
  const computedItems = cartItems.map((item) => {
    const variant = item.variant;
    const product = variant.product;
    const quantity = Number(item.quantity);
    if (!variant.isActive || !product.isActive) {
      throw new CheckoutError(
        "A product in your bag is no longer available.",
      );
    }
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 99
    ) {
      throw new CheckoutError("A bag quantity is invalid.");
    }
    if (
      variant.trackInventory &&
      variant.stockQuantity < quantity &&
      !variant.allowBackorder &&
      !variant.preorderEnabled
    ) {
      throw new CheckoutError(
        `${product.name} has insufficient stock.`,
      );
    }
    const unitPrice = roundMoney(
      Number(variant.discountPrice ?? variant.price),
    );
    return {
      variantId: item.variantId,
      productId: product.id,
      categoryId: product.categoryId,
      subCategoryId: product.subCategoryId,
      hsnSac: product.hsnSac,
      quantity,
      name: product.name,
      unitPrice,
      lineTotal: roundMoney(unitPrice * quantity),
      weightKg: weightInKg(variant.weight) * quantity,
    };
  });
  const subtotal = roundMoney(
    computedItems.reduce((sum, item) => sum + item.lineTotal, 0),
  );
  const { coupon, discount } = await validateAndComputeCoupon({
    couponCode:
      body.couponCode !== undefined ? body.couponCode : savedCoupon,
    userId: req.user?.userId ?? null,
    subtotal,
    computedItems,
  });
  const discountAmount = roundMoney(Number(discount));
  if (discountAmount > subtotal) {
    throw new CheckoutError("The coupon discount is invalid.");
  }
  const discountedSubtotal = roundMoney(subtotal - discountAmount);
  const enabledProviders = await prisma.paymentGatewayConfig.findMany({
    where: { isEnabled: true },
    select: { provider: true, displayName: true },
    orderBy: { id: "asc" },
  });
  if (!enabledProviders.length) {
    throw new CheckoutError(
      "No payment method is currently available.",
    );
  }
  // Explicit provider wins. Otherwise resolve from the supplied method,
  // or automatically choose the only enabled provider.
  const candidates = body.paymentProvider
    ? enabledProviders.filter(
      (provider) => provider.provider === body.paymentProvider,
    )
    : body.paymentMethod
      ? enabledProviders.filter((provider) =>
        body.paymentMethod === "COD"
          ? provider.provider === "COD"
          : provider.provider !== "COD",
      )
      : enabledProviders;
  if (!candidates.length) {
    throw new CheckoutError(
      "The selected payment method is not enabled.",
    );
  }
  if (candidates.length !== 1) {
    throw new CheckoutError("Please select a payment method.");
  }
  const selectedProvider = candidates[0];
  const paymentMethod =
    selectedProvider.provider === "COD" ? "COD" : "Prepaid";
  if (
    body.paymentMethod &&
    body.paymentMethod !== paymentMethod
  ) {
    throw new CheckoutError(
      "Payment provider and payment method do not match.",
    );
  }
  const pickup = await prisma.pickupLocation.findFirst({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
  if (!pickup?.pincode) {
    throw new CheckoutError(
      "No active pickup location is configured.",
    );
  }
  const weightKg = computedItems.reduce(
    (sum, item) => sum + item.weightKg,
    0,
  );
  const rates = await getShippingRates({
    pickupPincode: pickup.pincode,
    deliveryPincode: body.shippingAddress.postalCode,
    cod: paymentMethod === "COD",
    // Preserve the existing rule basis: subtotal before coupon.
    declaredValue: subtotal,
    package: {
      weightKg,
      lengthCm: configuredPositiveNumber(
        "SHIPPING_PACKAGE_LENGTH_CM",
        "SHIPROCKET_PACKAGE_LENGTH",
      ),
      widthCm: configuredPositiveNumber(
        "SHIPPING_PACKAGE_WIDTH_CM",
        "SHIPROCKET_PACKAGE_BREADTH",
      ),
      heightCm: configuredPositiveNumber(
        "SHIPPING_PACKAGE_HEIGHT_CM",
        "SHIPROCKET_PACKAGE_HEIGHT",
      ),
    },
  });
  const shippingOptions = rates
    .filter(
      (rate) =>
        Number.isFinite(rate.rate) &&
        rate.rate >= 0 &&
        (paymentMethod !== "COD" || rate.codAvailable),
    )
    .map((rate) => ({
      id: JSON.stringify([
        rate.provider,
        rate.courierCode || rate.courierName,
      ]),
      provider: rate.provider,
      courierName: rate.courierName,
      courierCode: rate.courierCode ?? null,
      amount: roundMoney(rate.rate),
      estimatedDays: rate.estimatedDays ?? null,
      codAvailable: rate.codAvailable,
    }));
  if (!shippingOptions.length) {
    throw new CheckoutError(
      "No delivery option is available for this address and payment method.",
    );
  }
  const selectedShipping = body.deliveryOption
    ? shippingOptions.find(
      (option) => option.id === body.deliveryOption,
    )
    : shippingOptions.length === 1
      ? shippingOptions[0]
      : undefined;
  if (body.deliveryOption && !selectedShipping) {
    throw new CheckoutError(
      "Please select an available delivery option.",
    );
  }
  const shippingCharge = selectedShipping?.amount ?? null;
  const taxResult = await calculateCheckoutTax({
    country: body.shippingAddress.country,
    region: body.shippingAddress.state,
    discount: discountAmount,
    items: computedItems,
  });
  const total =
    shippingCharge === null
      ? null
      : roundMoney(
        discountedSubtotal +
        shippingCharge +
        taxResult.additionalTax,
      );
  return {
    customerType: req.user ? "ACCOUNT" : "GUEST",
    items: computedItems.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      name: item.name,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    subtotal,
    couponCode: coupon?.code ?? null,
    discount: discountAmount,
    discountedSubtotal,
    shippingOptions,
    selectedShipping: selectedShipping ?? null,
    shippingCharge,
    // Included tax is already part of the product prices.
    // Only additional tax is added when calculating total.
    tax: taxResult.tax,
    includedTax: taxResult.includedTax,
    additionalTax: taxResult.additionalTax,
    taxBreakdown: taxResult.breakdown,
    taxConfirmed: true,
    total,
    currency: "INR",
    // This endpoint prepares a quote, not an order.
    readyForPayment: false,
    availablePaymentMethods: enabledProviders.map((provider) => ({
      provider: provider.provider,
      name: provider.displayName || provider.provider,
    })),
    shippingAddress: body.shippingAddress,
    billingAddress: body.billingSameAsShipping
      ? body.shippingAddress
      : body.billingAddress,
    orderNotes: body.orderNotes,
    giftMessage: body.giftMessage,
    paymentMethod,
    paymentProvider: selectedProvider.provider,
    expressCheckout: body.expressCheckout,
    orderCreated: false,
    quotedAt: new Date().toISOString(),
  };
}
router.post("/prepare", async (req, res) => {
  try {
    const data = await prepareQuote(req as CheckoutRequest);
    return res.json({ success: true, data });
  } catch (error) {
    logFailure(error);
    return res.status(400).json({
      success: false,
      message: errorResponse(error),
    });
  }
});
router.post("/delivery-options", async (req, res) => {
  try {
    // Requires the same JSON payload as /prepare.
    const quote = await prepareQuote(req as CheckoutRequest);
    return res.json({
      success: true,
      data: quote.shippingOptions,
    });
  } catch (error) {
    logFailure(error);
    return res.status(400).json({
      success: false,
      message: errorResponse(error),
    });
  }
});
router.post("/place-order", async (request, res) => {
  const req = request as CheckoutRequest;
  try {
    const body = checkoutSchema.parse(req.body);
    const key = z.string().uuid().parse(req.get("Idempotency-Key"));
    const email = z.string().trim().email().parse(body.email);
    const guestToken = req.user ? null : tokenSchema.parse(body.cartToken || req.get("x-cart-token"));
    if (!req.user) issueGuestOrderAccess(1); // Check server configuration before committing.
    const principal = req.user ? `account:${req.user.userId}` : `guest:${guestToken}`;
    const storageKey = "checkout-order:" + crypto.createHash("sha256").update(`${principal}:${key}`).digest("hex");
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ ...body, email, cartToken: undefined })).digest("hex");

    const responseFor = (order: { id: number; totalAmount: Prisma.Decimal; currency: string; paymentStatus: string }, provider: string, reused: boolean) => ({
      orderId: order.id, orderNumber: `NM-${order.id}`, total: Number(order.totalAmount), currency: order.currency,
      paymentStatus: order.paymentStatus, paymentProvider: provider, reused,
      orderAccessToken: req.user ? null : issueGuestOrderAccess(order.id),
    });
    const saved = await prisma.storeSetting.findUnique({ where: { key: storageKey } });
    if (saved) {
      const record = saved.value as { orderId?: number; fingerprint?: string; provider?: string };
      if (record.fingerprint !== fingerprint || !Number.isSafeInteger(record.orderId) || typeof record.provider !== "string") {
        throw new CheckoutError("This order attempt changed. Start a new order attempt.");
      }
      const order = await prisma.order.findUnique({ where: { id: record.orderId! } });
      if (!order || (req.user ? order.userId !== req.user.userId : order.userId !== null)) throw new CheckoutError("Order access is unavailable.");
      return res.json({ success: true, data: responseFor(order, record.provider, true) });
    }

    const quote = await prepareQuote(req);
    if (quote.total === null || quote.shippingCharge === null || !quote.selectedShipping || !quote.taxConfirmed) {
      throw new CheckoutError("Select delivery and confirm the checkout quote first.");
    }
    const expectedTotal = z.number().finite().nonnegative().parse(req.body.expectedTotal);
    if (Math.round(expectedTotal * 100) !== Math.round(quote.total * 100)) {
      return res.status(409).json({ success: false, message: "Your total changed. Refresh the quote before placing the order." });
    }
    const total = quote.total;
    const shippingCharge = quote.shippingCharge;
    const selectedShipping = quote.selectedShipping;
    const provider = z.nativeEnum(PaymentProvider).parse(quote.paymentProvider);
    const order = await prisma.$transaction(async (tx) => {
      if (await tx.storeSetting.findUnique({ where: { key: storageKey } })) throw new CheckoutError("This request is already processing. Retry with the same request key.");
      const gateway = await tx.paymentGatewayConfig.findUnique({ where: { provider } });
      if (!gateway?.isEnabled) throw new CheckoutError("The selected payment provider is disabled.");
      const include = { variant: { include: { product: true } } } as const;
      const guestCart = req.user ? null : await tx.guestCart.findUnique({ where: { token: guestToken! } });
      if (!req.user && !guestCart) throw new CheckoutError("Your bag session expired.");
      const cartItems = req.user
        ? await tx.cartItem.findMany({ where: { userId: req.user.userId }, include })
        : await tx.guestCartItem.findMany({ where: { cartId: guestCart!.id }, include });
      if (!cartItems.length || cartItems.length !== quote.items.length) throw new CheckoutError("Your bag changed. Refresh the quote.");
      for (const item of cartItems) {
        const quoted = quote.items.find((row) => row.variantId === item.variantId);
        const variant = item.variant;
        if (!quoted || quoted.quantity !== item.quantity || !variant.isActive || !variant.product.isActive || Math.round(quoted.unitPrice * 100) !== Math.round(Number(variant.discountPrice ?? variant.price) * 100)) {
          throw new CheckoutError("Your bag changed. Refresh the quote.");
        }
        if (variant.trackInventory && !variant.allowBackorder && !variant.preorderEnabled) {
          const reserved = await tx.productVariant.updateMany({ where: { id: variant.id, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } });
          if (reserved.count !== 1) throw new CheckoutError("An item no longer has sufficient stock.");
        }
      }
      const coupon = quote.couponCode ? await tx.coupon.findUnique({ where: { code: quote.couponCode } }) : null;
      if (quote.couponCode && !coupon) throw new CheckoutError("The coupon is no longer available.");
      if (coupon) {
        const now = new Date();
        if (!coupon.isActive || (coupon.startAt && now < coupon.startAt) || (coupon.endAt && now > coupon.endAt)) throw new CheckoutError("The coupon is no longer available.");
        if (req.user && coupon.usagePerUser !== null) {
          const used = await tx.order.count({ where: { userId: req.user.userId, couponId: coupon.id, status: { not: "Cancelled" } } });
          if (used >= coupon.usagePerUser) throw new CheckoutError("Coupon usage limit per user reached.");
        }
        const claimed = await tx.coupon.updateMany({ where: { id: coupon.id, isActive: true, ...(coupon.usageLimit === null ? {} : { usedCount: { lt: coupon.usageLimit } }) }, data: { usedCount: { increment: 1 } } });
        if (claimed.count !== 1) throw new CheckoutError("Coupon usage limit reached.");
      }
      const created = await tx.order.create({
        data: {
          userId: req.user?.userId ?? null, customerName: quote.shippingAddress.fullName, customerEmail: email, guestPhone: quote.shippingAddress.phone,
          shippingAddress: [quote.shippingAddress.line1, quote.shippingAddress.line2].filter(Boolean).join(", "),
          shippingCity: quote.shippingAddress.city, shippingCountry: quote.shippingAddress.country, shippingPostalCode: quote.shippingAddress.postalCode,
          shippingAddressJson: JSON.parse(JSON.stringify(quote.shippingAddress)), billingAddress: JSON.parse(JSON.stringify(quote.billingAddress)),
          subtotal: new Prisma.Decimal(quote.subtotal), discountAmount: new Prisma.Decimal(quote.discount), couponDiscount: new Prisma.Decimal(quote.discount),
          couponCode: quote.couponCode, couponId: coupon?.id ?? null, shippingFee: new Prisma.Decimal(shippingCharge), taxAmount: new Prisma.Decimal(quote.tax),
          taxBreakdown: JSON.parse(JSON.stringify(quote.taxBreakdown)), taxInclusive: quote.additionalTax === 0,
          totalAmount: new Prisma.Decimal(total), paidAmount: new Prisma.Decimal(0), paymentDue: new Prisma.Decimal(total), currency: quote.currency,
          status: "Pending", paymentStatus: "Pending", paymentMethod: provider === "COD" ? PaymentMethod.COD : provider === "BankTransfer" ? PaymentMethod.BANK_TRANSFER : PaymentMethod.Prepaid,
          deliveryOption: selectedShipping.id, shippingProvider: selectedShipping.provider,
          shippingMeta: { selectedShipping, paymentProvider: provider, inventoryReserved: true, includedTax: quote.includedTax, additionalTax: quote.additionalTax },
          orderNotes: quote.orderNotes, giftMessage: quote.giftMessage, expressCheckout: quote.expressCheckout,
          orderItems: { create: cartItems.map((item) => ({ productId: item.variant.product.id, variantId: item.variantId, quantity: item.quantity, unitPrice: new Prisma.Decimal(item.variant.discountPrice ?? item.variant.price), productName: item.variant.product.name })) },
        }
      });
      await tx.storeSetting.create({ data: { key: storageKey, value: { orderId: created.id, fingerprint, provider } } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
    return res.status(201).json({ success: true, data: responseFor(order, provider, false) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      return res.status(409).json({ success: false, message: "Checkout is being updated. Retry with the same request key." });
    }
    logFailure(error);
    return res.status(400).json({ success: false, message: errorResponse(error) });
  }
});
export default router;
