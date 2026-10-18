import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { auth } from "../middleware/auth";
import { adminOnly } from "../middleware/admin";

const r = Router();
const admin = [auth as any, adminOnly as any];
const n = (v: any) => Number(v);
const json = (v: any, fallback: any = {}) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};
const date = (v: any) => (v ? new Date(v) : null);
const slug = (s: string) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// Promotions + gift cards: stable admin CRUD contract
r.get("/promotions", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.promotion.findMany({
      orderBy: [{ priority: "desc" }, { id: "desc" }],
    }),
  }),
);
r.post("/promotions", ...admin, async (req, s) => {
  const b = req.body || {};
  const type =
    ({ PERCENTAGE: "PERCENT", FLASH_SALE: "FLASH" } as any)[b.type] ||
    b.type ||
    "PERCENT";
  const value = Number(b.value || 0);
  const benefit = type === "FIXED" ? { amount: value } : { percent: value };
  const x = await prisma.promotion.create({
    data: {
      name: b.name || "Promotion",
      code: b.code || null,
      type,
      rules: json(b.rules, {}),
      benefit: json(b.benefit, benefit),
      startsAt: date(b.startsAt),
      endsAt: date(b.endsAt),
      priority: Number(b.priority || 0),
      isActive: b.isActive !== false,
    },
  });
  s.status(201).json({ success: true, data: x });
});
r.patch("/promotions/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if (b.type)
    b.type =
      ({ PERCENTAGE: "PERCENT", FLASH_SALE: "FLASH" } as any)[b.type] || b.type;
  if ("value" in b) {
    b.benefit =
      b.type === "FIXED"
        ? { amount: Number(b.value || 0) }
        : { percent: Number(b.value || 0) };
    delete b.value;
  }
  if ("automatic" in b) delete b.automatic;
  if ("startsAt" in b) b.startsAt = date(b.startsAt);
  if ("endsAt" in b) b.endsAt = date(b.endsAt);
  if ("rules" in b) b.rules = json(b.rules, {});
  const x = await prisma.promotion.update({
    where: { id: n(req.params.id) },
    data: b,
  });
  s.json({ success: true, data: x });
});
r.delete("/promotions/:id", ...admin, async (req, s) => {
  await prisma.promotion.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/gift-cards", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.giftCard.findMany({ orderBy: { createdAt: "desc" } }),
  }),
);
r.post("/gift-cards", ...admin, async (req, s) => {
  const b = req.body || {},
    v = Number(b.initialValue ?? b.initialBalance ?? b.value ?? 0);
  const x = await prisma.giftCard.create({
    data: {
      code: String(b.code || `NM${Date.now()}`).toUpperCase(),
      initialValue: new Prisma.Decimal(v),
      balance: new Prisma.Decimal(v),
      currency: b.currency || "INR",
      customerEmail: b.customerEmail || null,
      expiresAt: date(b.expiresAt),
      isActive: b.isActive !== false,
    },
  });
  s.status(201).json({ success: true, data: x });
});
r.patch("/gift-cards/:id", ...admin, async (req, s) => {
  const b = req.body || {};
  const data: any = {};
  for (const k of ["customerEmail", "currency", "isActive"])
    if (k in b) data[k] = b[k];
  if ("expiresAt" in b) data.expiresAt = date(b.expiresAt);
  const x = await prisma.giftCard.update({
    where: { id: n(req.params.id) },
    data,
  });
  s.json({ success: true, data: x });
});
r.delete("/gift-cards/:id", ...admin, async (req, s) => {
  await prisma.giftCard.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});

// Reviews & Trust
r.get("/reviews", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.review.findMany({
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        product: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  }),
);
r.patch("/reviews/:id", ...admin, async (req, s) =>
  s.json({
    success: true,
    data: await prisma.review.update({
      where: { id: n(req.params.id) },
      data: req.body,
    }),
  }),
);
r.delete("/reviews/:id", ...admin, async (req, s) => {
  await prisma.review.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/trust/testimonials", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.testimonial.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  }),
);
r.post("/content/trust/testimonials", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.testimonial.create({
      data: {
        name: b.name || b.customerName || "Customer",
        title: b.title || null,
        quote: b.quote || b.content || "",
        rating: b.rating ? Number(b.rating) : null,
        imageUrl: b.imageUrl || null,
        source: b.source || null,
        isFeatured: !!b.isFeatured,
        isActive: b.isActive ?? b.isPublished ?? true,
        sortOrder: Number(b.sortOrder || 0),
      },
    }),
  });
});
r.patch("/content/trust/testimonials/:id", ...admin, async (req, s) => {
  const b = req.body || {};
  s.json({
    success: true,
    data: await prisma.testimonial.update({
      where: { id: n(req.params.id) },
      data: {
        name: b.name ?? b.customerName,
        title: b.title,
        quote: b.quote ?? b.content,
        rating: b.rating === undefined ? undefined : Number(b.rating),
        imageUrl: b.imageUrl,
        source: b.source,
        isFeatured: b.isFeatured,
        isActive: b.isActive ?? b.isPublished,
        sortOrder: b.sortOrder === undefined ? undefined : Number(b.sortOrder),
      },
    }),
  });
});
r.delete("/content/trust/testimonials/:id", ...admin, async (req, s) => {
  await prisma.testimonial.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/trust/faqs", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.faq.findMany({ orderBy: { position: "asc" } }),
  }),
);
r.post("/content/trust/faqs", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.faq.create({
      data: {
        question: b.question,
        answer: b.answer,
        category: b.category || null,
        position: Number(b.position ?? b.sortOrder ?? 0),
        isActive: b.isActive ?? b.isPublished ?? true,
      },
    }),
  });
});
r.patch("/content/trust/faqs/:id", ...admin, async (req, s) => {
  const b = req.body || {};
  s.json({
    success: true,
    data: await prisma.faq.update({
      where: { id: n(req.params.id) },
      data: {
        question: b.question,
        answer: b.answer,
        category: b.category,
        position:
          b.position === undefined && b.sortOrder === undefined
            ? undefined
            : Number(b.position ?? b.sortOrder),
        isActive: b.isActive ?? b.isPublished,
      },
    }),
  });
});
r.delete("/content/trust/faqs/:id", ...admin, async (req, s) => {
  await prisma.faq.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/trust/badges", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.trustBadge.findMany({ orderBy: { sortOrder: "asc" } }),
  }),
);
r.post("/content/trust/badges", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.trustBadge.create({
      data: {
        name: b.name,
        description: b.description || null,
        iconUrl: b.iconUrl || b.icon || null,
        linkUrl: b.linkUrl || null,
        placement: b.placement || "PRODUCT",
        isActive: b.isActive !== false,
        sortOrder: Number(b.sortOrder || 0),
      },
    }),
  });
});
r.patch("/content/trust/badges/:id", ...admin, async (req, s) => {
  const b = req.body || {};
  if ("icon" in b && !("iconUrl" in b)) b.iconUrl = b.icon;
  delete b.icon;
  s.json({
    success: true,
    data: await prisma.trustBadge.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/trust/badges/:id", ...admin, async (req, s) => {
  await prisma.trustBadge.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});

// Marketing admin list endpoints
r.get("/content/marketing/campaigns", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.marketingCampaign.findMany({
      orderBy: { createdAt: "desc" },
    }),
  }),
);
r.post("/content/marketing/campaigns", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.marketingCampaign.create({
      data: {
        name: b.name,
        channel: b.channel || "EMAIL",
        subject: b.subject || null,
        content: b.content || "",
        status: b.status || "DRAFT",
        scheduledAt: date(b.scheduledAt),
        meta: json(b.meta, null),
      },
    }),
  });
});
r.patch("/content/marketing/campaigns/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("scheduledAt" in b) b.scheduledAt = date(b.scheduledAt);
  s.json({
    success: true,
    data: await prisma.marketingCampaign.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/marketing/campaigns/:id", ...admin, async (req, s) => {
  await prisma.marketingCampaign.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/marketing/segments", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.customerSegment.findMany({
      orderBy: { createdAt: "desc" },
    }),
  }),
);
r.post("/content/marketing/segments", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.customerSegment.create({
      data: {
        name: b.name,
        description: b.description || null,
        rules: json(b.rules, {}),
        isActive: b.isActive !== false,
      },
    }),
  });
});
r.patch("/content/marketing/segments/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("rules" in b) b.rules = json(b.rules, {});
  s.json({
    success: true,
    data: await prisma.customerSegment.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/marketing/segments/:id", ...admin, async (req, s) => {
  await prisma.customerSegment.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/marketing/abandoned-carts", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.abandonedCart.findMany({
      orderBy: { abandonedAt: "desc" },
      take: 500,
    }),
  }),
);
r.get("/content/marketing/loyalty", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.loyaltyAccount.findMany({
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  }),
);
r.get("/content/marketing/referrals", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.referralCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  }),
);
r.get("/content/marketing/affiliates", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.affiliate.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  }),
);

// SEO admin CRUD
r.get("/content/seo/metadata", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.seoMeta.findMany({ orderBy: { updatedAt: "desc" } }),
  }),
);
r.post("/content/seo/metadata", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.seoMeta.upsert({
      where: {
        entityType_entityId: {
          entityType: b.entityType,
          entityId: String(b.entityId),
        },
      },
      create: { ...b, entityId: String(b.entityId) },
      update: b,
    }),
  });
});
r.patch("/content/seo/metadata/:id", ...admin, async (req, s) =>
  s.json({
    success: true,
    data: await prisma.seoMeta.update({
      where: { id: n(req.params.id) },
      data: req.body,
    }),
  }),
);
r.delete("/content/seo/metadata/:id", ...admin, async (req, s) => {
  await prisma.seoMeta.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/seo/redirects", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.seoRedirect.findMany({ orderBy: { id: "desc" } }),
  }),
);
r.post("/content/seo/redirects", ...admin, async (req, s) =>
  s
    .status(201)
    .json({
      success: true,
      data: await prisma.seoRedirect.create({
        data: { ...req.body, statusCode: Number(req.body.statusCode || 301) },
      }),
    }),
);
r.patch("/content/seo/redirects/:id", ...admin, async (req, s) =>
  s.json({
    success: true,
    data: await prisma.seoRedirect.update({
      where: { id: n(req.params.id) },
      data: {
        ...req.body,
        statusCode:
          req.body.statusCode === undefined
            ? undefined
            : Number(req.body.statusCode),
      },
    }),
  }),
);
r.delete("/content/seo/redirects/:id", ...admin, async (req, s) => {
  await prisma.seoRedirect.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/seo/audit/products", ...admin, async (_q, s) => {
  const ps = await prisma.product.findMany({
    where: { isActive: true },
    include: { images: true },
  });
  const data = ps
    .map((p) => ({
      productId: p.id,
      name: p.name,
      issues: [
        !p.metaTitle && "MISSING_META_TITLE",
        !p.metaDescription && "MISSING_META_DESCRIPTION",
        !p.canonicalUrl && "MISSING_CANONICAL",
        p.images.some((i) => !i.altText) && "MISSING_IMAGE_ALT",
      ].filter(Boolean),
    }))
    .filter((x) => x.issues.length);
  s.json({ success: true, data });
});

// CMS admin CRUD using stable /content paths
r.get("/content/pages", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.cmsPage.findMany({ orderBy: { updatedAt: "desc" } }),
  }),
);
r.post("/content/pages", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.cmsPage.create({
      data: {
        title: b.title,
        slug: b.slug || slug(b.title),
        content: json(b.content, {}),
        metaTitle: b.metaTitle || null,
        metaDescription: b.metaDescription || null,
        isPublished: !!b.isPublished,
      },
    }),
  });
});
r.patch("/content/pages/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("content" in b) b.content = json(b.content, {});
  s.json({
    success: true,
    data: await prisma.cmsPage.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/pages/:id", ...admin, async (req, s) => {
  await prisma.cmsPage.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/blogs", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.blogPost.findMany({ orderBy: { updatedAt: "desc" } }),
  }),
);
r.post("/content/blogs", ...admin, async (req, s) => {
  const b = req.body || {},
    status = b.status || (b.isPublished ? "PUBLISHED" : "DRAFT");
  s.status(201).json({
    success: true,
    data: await prisma.blogPost.create({
      data: {
        title: b.title,
        slug: b.slug || slug(b.title),
        excerpt: b.excerpt || null,
        content: json(b.content, {}),
        status,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    }),
  });
});
r.patch("/content/blogs/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("content" in b) b.content = json(b.content, {});
  if ("isPublished" in b) {
    b.status = b.isPublished ? "PUBLISHED" : "DRAFT";
    delete b.isPublished;
  }
  s.json({
    success: true,
    data: await prisma.blogPost.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/blogs/:id", ...admin, async (req, s) => {
  await prisma.blogPost.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/content/templates", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.pageTemplate.findMany({
      orderBy: { createdAt: "desc" },
    }),
  }),
);
r.post("/content/templates", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.pageTemplate.create({
      data: {
        name: b.name,
        type: b.type || "LANDING",
        schema: json(b.schema, {}),
        isActive: b.isActive !== false,
      },
    }),
  });
});
r.patch("/content/templates/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("schema" in b) b.schema = json(b.schema, {});
  s.json({
    success: true,
    data: await prisma.pageTemplate.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/content/templates/:id", ...admin, async (req, s) => {
  await prisma.pageTemplate.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
// Navigation management is handled by the validated navigation router.

// Support (Contact Inbox intentionally excluded)
r.get("/support/tickets", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.supportTicket.findMany({
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  }),
);
r.post("/support/tickets", ...admin, async (req: any, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.supportTicket.create({
      data: {
        userId: b.userId ?? b.customerId ?? null,
        orderId: b.orderId ? Number(b.orderId) : null,
        subject: b.subject,
        message: b.message || "",
        priority: b.priority || "NORMAL",
        status: b.status || "OPEN",
      },
    }),
  });
});
r.patch("/support/tickets/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  delete b.customerId;
  s.json({
    success: true,
    data: await prisma.supportTicket.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/support/tickets/:id", ...admin, async (req, s) => {
  await prisma.supportTicket.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});

// Tracking admin facade. One settings form maps to provider-specific records.
r.get("/tracking/settings", ...admin, async (_q, s) => {
  const rows = await prisma.trackingIntegration.findMany();
  const by = (p: string) => rows.find((x) => x.provider === p);
  const pub = (p: string) => (by(p)?.publicConfig || {}) as any;
  resSafe(s, {
    id: 1,
    ga4MeasurementId: pub("GA4").measurementId || "",
    gtmContainerId: pub("GTM").containerId || "",
    googleAdsId: pub("GOOGLE_ADS").adsId || "",
    metaPixelId: pub("META").pixelId || "",
    metaAccessToken: by("META")?.secretConfig ? "••••••••" : "",
    enabled: rows.some((x) => x.isEnabled),
  });
});
function resSafe(s: any, data: any) {
  return s.json({ success: true, data: [data] });
}
r.post("/tracking/settings", ...admin, saveTracking);
r.patch("/tracking/settings/:id", ...admin, saveTracking);
async function saveTracking(req: any, s: any) {
  const b = req.body || {};
  const defs = [
    ["GA4", { measurementId: b.ga4MeasurementId }, {}],
    ["GTM", { containerId: b.gtmContainerId }, {}],
    ["GOOGLE_ADS", { adsId: b.googleAdsId }, {}],
    [
      "META",
      { pixelId: b.metaPixelId },
      {
        accessToken:
          b.metaAccessToken && !String(b.metaAccessToken).includes("•")
            ? b.metaAccessToken
            : undefined,
      },
    ],
  ] as const;
  for (const [provider, publicConfig, secret] of defs) {
    const old = await prisma.trackingIntegration.findUnique({
      where: { provider },
    });
    const secretConfig = {
      ...((old?.secretConfig || {}) as any),
      ...Object.fromEntries(Object.entries(secret).filter(([, v]) => v)),
    };
    await prisma.trackingIntegration.upsert({
      where: { provider },
      create: { provider, isEnabled: !!b.enabled, publicConfig, secretConfig },
      update: { isEnabled: !!b.enabled, publicConfig, secretConfig },
    });
  }
  return s.json({ success: true, data: b });
}
r.get("/tracking/events", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.conversionEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  }),
);
r.get("/tracking/product-feed", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.productFeed.findMany({ orderBy: { createdAt: "desc" } }),
  }),
);

// International admin list CRUD
r.get("/platform/international/markets", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.market.findMany({ orderBy: { name: "asc" } }),
  }),
);
r.post("/platform/international/markets", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.market.create({
      data: {
        name: b.name,
        countries: json(b.countries, []),
        currencyCode: b.currencyCode || b.currency || "INR",
        localeCode: b.localeCode || b.locale || "en-IN",
        priceAdjustment: Number(b.priceAdjustment || 0),
        taxInclusive: b.taxInclusive !== false,
        paymentMethods: json(b.paymentMethods, null),
        shippingConfig: json(b.shippingConfig, null),
        isActive: b.isActive !== false,
      },
    }),
  });
});
r.patch("/platform/international/markets/:id", ...admin, async (req, s) => {
  const b = { ...req.body };
  if ("countries" in b) b.countries = json(b.countries, []);
  if ("currency" in b) {
    b.currencyCode = b.currency;
    delete b.currency;
  }
  if ("locale" in b) {
    b.localeCode = b.locale;
    delete b.locale;
  }
  s.json({
    success: true,
    data: await prisma.market.update({
      where: { id: n(req.params.id) },
      data: b,
    }),
  });
});
r.delete("/platform/international/markets/:id", ...admin, async (req, s) => {
  await prisma.market.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});
r.get("/platform/international/currencies", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.currencyConfig.findMany({ orderBy: { code: "asc" } }),
  }),
);
r.get("/platform/international/locales", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.localeConfig.findMany({ orderBy: { code: "asc" } }),
  }),
);
r.get("/platform/international/prices", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.regionalPrice.findMany({
      orderBy: { id: "desc" },
      take: 500,
    }),
  }),
);

// Complete International CRUD used by generic Admin screens
r.post("/platform/international/currencies", ...admin, async (req, s) => {
  const b = req.body || {},
    code = String(b.code || "").toUpperCase();
  s.status(201).json({
    success: true,
    data: await prisma.currencyConfig.upsert({
      where: { code },
      create: {
        code,
        name: b.name || code,
        symbol: b.symbol || code,
        rateToBase: Number(b.rateToBase ?? b.exchangeRate ?? 1),
        isBase: !!(b.isBase ?? b.isDefault),
        isEnabled: b.isEnabled ?? b.isActive ?? true,
        decimals: Number(b.decimals ?? 2),
      },
      update: {
        name: b.name || code,
        symbol: b.symbol || code,
        rateToBase: Number(b.rateToBase ?? b.exchangeRate ?? 1),
        isBase: !!(b.isBase ?? b.isDefault),
        isEnabled: b.isEnabled ?? b.isActive ?? true,
        decimals: Number(b.decimals ?? 2),
      },
    }),
  });
});
r.patch(
  "/platform/international/currencies/:code",
  ...admin,
  async (req, s) => {
    const b = req.body || {};
    s.json({
      success: true,
      data: await prisma.currencyConfig.update({
        where: { code: req.params.code.toUpperCase() },
        data: {
          name: b.name,
          symbol: b.symbol,
          rateToBase:
            b.rateToBase === undefined && b.exchangeRate === undefined
              ? undefined
              : Number(b.rateToBase ?? b.exchangeRate),
          isBase: b.isBase ?? b.isDefault,
          isEnabled: b.isEnabled ?? b.isActive,
          decimals: b.decimals === undefined ? undefined : Number(b.decimals),
        },
      }),
    });
  },
);
r.delete(
  "/platform/international/currencies/:code",
  ...admin,
  async (req, s) => {
    await prisma.currencyConfig.delete({
      where: { code: req.params.code.toUpperCase() },
    });
    s.json({ success: true });
  },
);
r.post("/platform/international/locales", ...admin, async (req, s) => {
  const b = req.body || {},
    code = String(b.code || "");
  s.status(201).json({
    success: true,
    data: await prisma.localeConfig.upsert({
      where: { code },
      create: {
        code,
        name: b.name || code,
        isDefault: !!b.isDefault,
        isEnabled: b.isEnabled ?? b.isActive ?? true,
        fallbackCode: b.fallbackCode || null,
      },
      update: {
        name: b.name || code,
        isDefault: !!b.isDefault,
        isEnabled: b.isEnabled ?? b.isActive ?? true,
        fallbackCode: b.fallbackCode || null,
      },
    }),
  });
});
r.patch("/platform/international/locales/:code", ...admin, async (req, s) => {
  const b = req.body || {};
  s.json({
    success: true,
    data: await prisma.localeConfig.update({
      where: { code: req.params.code },
      data: {
        name: b.name,
        isDefault: b.isDefault,
        isEnabled: b.isEnabled ?? b.isActive,
        fallbackCode: b.fallbackCode,
      },
    }),
  });
});
r.delete("/platform/international/locales/:code", ...admin, async (req, s) => {
  await prisma.localeConfig.delete({ where: { code: req.params.code } });
  s.json({ success: true });
});
r.post("/platform/international/prices", ...admin, async (req, s) => {
  const b = req.body || {};
  s.status(201).json({
    success: true,
    data: await prisma.regionalPrice.create({
      data: {
        productId: Number(b.productId),
        variantId: b.variantId ? Number(b.variantId) : null,
        marketId: Number(b.marketId),
        currency: b.currency || "INR",
        price: new Prisma.Decimal(Number(b.price || 0)),
        compareAtPrice:
          (b.compareAtPrice ?? b.salePrice)
            ? new Prisma.Decimal(Number(b.compareAtPrice ?? b.salePrice))
            : null,
      },
    }),
  });
});
r.patch("/platform/international/prices/:id", ...admin, async (req, s) => {
  const b = req.body || {};
  s.json({
    success: true,
    data: await prisma.regionalPrice.update({
      where: { id: n(req.params.id) },
      data: {
        price:
          b.price === undefined
            ? undefined
            : new Prisma.Decimal(Number(b.price)),
        compareAtPrice:
          b.compareAtPrice === undefined && b.salePrice === undefined
            ? undefined
            : new Prisma.Decimal(Number(b.compareAtPrice ?? b.salePrice)),
        currency: b.currency,
      },
    }),
  });
});
r.delete("/platform/international/prices/:id", ...admin, async (req, s) => {
  await prisma.regionalPrice.delete({ where: { id: n(req.params.id) } });
  s.json({ success: true });
});

// Missing list endpoints for Taxes/Admin & Staff generic screens
r.get('/platform/credit-notes', ...admin, async (_q, s) => {
  const data = await prisma.creditNote.findMany({
    orderBy: {
      id: "desc",
    },
    take: 500,
  });

  return s.json({
    success: true,
    data,
  });
});

r.get("/platform/admin/approvals", ...admin, async (_q, s) =>
  s.json({
    success: true,
    data: await prisma.approvalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  }),
);
r.get("/platform/admin/notifications", auth as any, async (req: any, s) =>
  s.json({
    success: true,
    data: await prisma.staffNotificationSetting.findMany({
      where: { userId: req.user.userId },
    }),
  }),
);

export default r;
