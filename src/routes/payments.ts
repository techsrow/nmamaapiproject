import { Router, type Response } from "express";
import { PaymentProvider, Prisma } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { auth, type AuthRequest } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";

import {
  encryptJson,
  decryptJson,
  maskSecrets,
} from "../services/payments/crypto";

import {
  PROVIDERS,
  testGateway,
} from "../services/payments/providerRegistry";

import {
  createProviderPayment,
  refundPayment,
  syncOrderPayment,
  verifyRazorpay,
} from "../services/payments/paymentService";

const router = Router();
const admin = [auth, adminOnly];
const providerValues = Object.values(PaymentProvider);

function parseProvider(value: unknown): PaymentProvider {
  if (
    typeof value !== "string" ||
    !providerValues.includes(value as PaymentProvider)
  ) {
    throw new Error("Unsupported payment provider.");
  }

  return value as PaymentProvider;
}

function positiveId(value: unknown): number {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error("Invalid ID.");
  }

  return id;
}

function safe(row: any) {
  const credentials = decryptJson<Record<string, any>>(
    row.encryptedCredentials,
  );

  const { encryptedCredentials, ...rest } = row;

  return {
    ...rest,
    credentials: maskSecrets(credentials),
    configured: Object.keys(credentials).length > 0,
  };
}

function message(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to complete the payment request.";
  }

  if (
    /prisma|invocation|database|key_secret|key_id|decrypt|encrypted/i.test(
      error.message,
    )
  ) {
    return "Payment configuration is unavailable.";
  }

  return error.message.slice(0, 180);
}

function ownsOrder(
  req: AuthRequest,
  order: { userId: number | null },
): boolean {
  return (
    req.user?.role === "Admin" ||
    (order.userId !== null &&
      order.userId === req.user?.userId)
  );
}

// PUBLIC: payment methods come directly from admin configuration.
// No secrets or admin configuration are returned.
router.get("/methods", async (_req, res: Response) => {
  try {
    const providers = await prisma.paymentGatewayConfig.findMany({
      where: { isEnabled: true },
      select: {
        provider: true,
        displayName: true,
      },
      orderBy: { id: "asc" },
    });

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      success: true,
      data: providers.map((provider) => ({
        provider: provider.provider,
        name: provider.displayName || provider.provider,
      })),
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Unable to load payment methods.",
    });
  }
});

// ADMIN: available provider configuration definitions.
router.get("/providers/catalog", ...admin, (_req, res) => {
  return res.json({
    success: true,
    data: Object.entries(PROVIDERS).map(([provider, definition]) => ({
      provider,
      ...definition,
    })),
  });
});

router.get("/providers", ...admin, async (_req, res) => {
  try {
    const rows = await prisma.paymentGatewayConfig.findMany({
      orderBy: { id: "asc" },
    });

    return res.json({
      success: true,
      data: rows.map(safe),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: message(error),
    });
  }
});

router.get("/providers/:provider", ...admin, async (req, res) => {
  try {
    const provider = parseProvider(req.params.provider);

    const row = await prisma.paymentGatewayConfig.findUnique({
      where: { provider },
    });

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Provider not configured.",
      });
    }

    return res.json({ success: true, data: safe(row) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: message(error),
    });
  }
});

router.put("/providers/:provider", ...admin, async (req, res) => {
  try {
    const provider = parseProvider(req.params.provider);
    const body = req.body ?? {};

    if (
      body.isEnabled !== undefined &&
      typeof body.isEnabled !== "boolean"
    ) {
      throw new Error("isEnabled must be a boolean.");
    }

    if (
      body.mode !== undefined &&
      !["TEST", "LIVE"].includes(body.mode)
    ) {
      throw new Error("Mode must be TEST or LIVE.");
    }

    if (
      body.displayName !== undefined &&
      (typeof body.displayName !== "string" ||
        !body.displayName.trim())
    ) {
      throw new Error("Display name is required.");
    }

    const old = await prisma.paymentGatewayConfig.findUnique({
      where: { provider },
    });

    let encryptedCredentials = old?.encryptedCredentials ?? null;

    if (body.credentials !== undefined) {
      if (
        !body.credentials ||
        typeof body.credentials !== "object" ||
        Array.isArray(body.credentials)
      ) {
        throw new Error("Credentials must be an object.");
      }

      // Preserve saved secrets when the admin leaves fields blank
      // or submits their masked display values.
      const previous = decryptJson<Record<string, unknown>>(
        old?.encryptedCredentials,
      );

      const next = { ...previous };

      for (const [key, value] of Object.entries(body.credentials)) {
        if (typeof value !== "string") {
          throw new Error("Credential values must be strings.");
        }

        if (!value.trim() || value.includes("••")) continue;
        next[key] = value;
      }

      if (Object.keys(next).length) {
        encryptedCredentials = encryptJson(next);
      }
    }

    const displayName =
      typeof body.displayName === "string"
        ? body.displayName.trim()
        : undefined;

    const row = await prisma.paymentGatewayConfig.upsert({
      where: { provider },
      create: {
        provider,
        displayName:
          displayName || PROVIDERS[provider]?.label || provider,
        isEnabled: body.isEnabled ?? false,
        mode: body.mode ?? "TEST",
        encryptedCredentials,
        publicConfig: body.publicConfig ?? {},
      },
      update: {
        displayName,
        isEnabled: body.isEnabled,
        mode: body.mode,
        encryptedCredentials,
        publicConfig: body.publicConfig,
      },
    });

    return res.json({ success: true, data: safe(row) });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: message(error),
    });
  }
});

router.post(
  "/providers/:provider/test",
  ...admin,
  async (req, res) => {
    let provider: PaymentProvider | undefined;

    try {
      provider = parseProvider(req.params.provider);

      const row = await prisma.paymentGatewayConfig.findUnique({
        where: { provider },
      });

      if (!row) throw new Error("Provider not configured.");

      const credentials = decryptJson<Record<string, string>>(
        row.encryptedCredentials,
      );

      const result = await testGateway(
        provider,
        credentials,
        row.mode,
      );

      await prisma.paymentGatewayConfig.update({
        where: { provider },
        data: {
          lastTestedAt: new Date(),
          lastTestOk: true,
          lastError: null,
        },
      });

      return res.json({ success: true, data: result });
    } catch (error) {
      if (provider) {
        try {
          await prisma.paymentGatewayConfig.updateMany({
            where: { provider },
            data: {
              lastTestedAt: new Date(),
              lastTestOk: false,
              lastError: message(error),
            },
          });
        } catch {
          console.error("Could not save payment provider test result.");
        }
      }

      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

router.patch(
  "/providers/:provider/status",
  ...admin,
  async (req, res) => {
    try {
      const provider = parseProvider(req.params.provider);

      if (typeof req.body?.isEnabled !== "boolean") {
        throw new Error("isEnabled must be a boolean.");
      }

      const row = await prisma.paymentGatewayConfig.update({
        where: { provider },
        data: { isEnabled: req.body.isEnabled },
      });

      return res.json({ success: true, data: safe(row) });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

// ADMIN: payment history.
router.get("/", ...admin, async (req, res) => {
  try {
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);

    const page =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;

    const limit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 25;

    const where: Prisma.PaymentWhereInput = {};

    if (req.query.orderId !== undefined) {
      where.orderId = positiveId(req.query.orderId);
    }

    if (req.query.provider !== undefined) {
      where.provider = parseProvider(req.query.provider);
    }

    if (req.query.status !== undefined) {
      where.paymentStatus =
        String(req.query.status) as Prisma.PaymentWhereInput["paymentStatus"];
    }

    const [data, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              customerName: true,
              customerEmail: true,
              totalAmount: true,
            },
          },
        },
        orderBy: { id: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: message(error),
    });
  }
});

router.get("/refunds", ...admin, async (req, res) => {
  try {
    const data = await prisma.paymentRefund.findMany({
      where:
        req.query.orderId !== undefined
          ? { orderId: positiveId(req.query.orderId) }
          : {},
      orderBy: { id: "desc" },
    });

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: message(error),
    });
  }
});

router.get(
  "/order/:orderId",
  auth,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = positiveId(req.params.orderId);

      const order = await prisma.order.findUnique({
        where: { id },
        include: { payments: true },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      if (!ownsOrder(req, order)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden.",
        });
      }

      const refunds = await prisma.paymentRefund.findMany({
        where: { orderId: id },
      });

      return res.json({
        success: true,
        data: { order, payments: order.payments, refunds },
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

// ACCOUNT: provider comes from the customer's selection.
// The payment service must implement that provider's adapter.
router.post(
  "/create",
  auth,
  async (req: AuthRequest, res: Response) => {
    try {
      const orderId = positiveId(req.body?.orderId);
      const provider = parseProvider(req.body?.provider);

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found.",
        });
      }

      if (!ownsOrder(req, order)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden.",
        });
      }

      if (["Cancelled", "Returned"].includes(String(order.status))) {
        throw new Error("This order cannot accept payment.");
      }

      // Recheck admin status at payment creation, not only in /methods.
      const config = await prisma.paymentGatewayConfig.findUnique({
        where: { provider },
      });

      if (!config?.isEnabled) {
        throw new Error("The selected payment provider is disabled.");
      }

      const data = await createProviderPayment(orderId, provider);

      return res.status(201).json({ success: true, data });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

router.post(
  "/verify/razorpay",
  auth,
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body ?? {};

      const providerOrderId =
        body.providerOrderId || body.razorpay_order_id;
      const providerPaymentId =
        body.providerPaymentId || body.razorpay_payment_id;
      const signature =
        body.signature || body.razorpay_signature;

      if (
        typeof providerOrderId !== "string" ||
        !providerOrderId ||
        providerOrderId.length > 200 ||
        typeof providerPaymentId !== "string" ||
        !providerPaymentId ||
        providerPaymentId.length > 200 ||
        typeof signature !== "string" ||
        !/^[a-fA-F0-9]{64}$/.test(signature)
      ) {
        throw new Error("Invalid payment verification details.");
      }

      const payment = await prisma.payment.findFirst({
        where: {
          provider: PaymentProvider.Razorpay,
          OR: [
            { providerOrderId },
            { razorpayOrderId: providerOrderId },
          ],
        },
        include: { order: true },
        orderBy: { id: "desc" },
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment not found.",
        });
      }

      if (!ownsOrder(req, payment.order)) {
        return res.status(403).json({
          success: false,
          message: "Forbidden.",
        });
      }

      const data = await verifyRazorpay({
        providerOrderId,
        providerPaymentId,
        signature,
      });

      return res.json({ success: true, data });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

router.post(
  "/manual",
  ...admin,
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body ?? {};
      const provider = parseProvider(body.provider ?? "Manual");

      if (!["Manual", "BankTransfer", "COD"].includes(provider)) {
        throw new Error(
          "Manual endpoint supports Manual, BankTransfer or COD only.",
        );
      }

      const orderId = positiveId(body.orderId);
      const amount = Number(body.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter a valid positive payment amount.");
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) throw new Error("Order not found.");

      const status = body.status ?? "Paid";

      // Validate against your generated Prisma enum values.
      const paymentStatusType =
        Prisma.PaymentScalarFieldEnum.paymentStatus;

      // The field-name reference above does not validate enum values;
      // preserve Prisma's runtime enum validation for this admin route.
      void paymentStatusType;

      const payment = await prisma.payment.create({
        data: {
          orderId,
          amount: new Prisma.Decimal(amount),
          currency: body.currency || order.currency || "INR",
          provider,
          paymentMethod: body.paymentMethod || undefined,
          paymentStatus: status,
          isCaptured: status === "Paid",
          providerPaymentId: body.reference || null,
          providerMeta: body.meta || undefined,
        },
      });

      const updatedOrder = await syncOrderPayment(orderId);

      return res.status(201).json({
        success: true,
        data: { payment, order: updatedOrder },
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

router.post(
  "/:paymentId/refund",
  ...admin,
  async (req: AuthRequest, res: Response) => {
    try {
      const paymentId = positiveId(req.params.paymentId);

      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: "Payment not found.",
        });
      }

      const amount = Number(req.body?.amount ?? payment.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter a valid refund amount.");
      }

      const data = await refundPayment(
        payment.id,
        amount,
        req.body?.reason,
        req.user?.userId,
      );

      return res.status(201).json({ success: true, data });
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: message(error),
      });
    }
  },
);

export default router;