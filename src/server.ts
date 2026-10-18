import {startShippingWorkflow} from './jobs/shippingWorkflow';
import shippingOperations from './routes/shippingOperations';
import { startShadowfaxCron } from "./jobs/shadowfaxCron";
import "dotenv/config";
import posRoutes from "./routes/pos";
import inventoryReconciliationRoutes from "./routes/inventoryReconciliation";
import express from "express";
import cors from "cors";

// Routes
import AuthRoutes from "./routes/auth";
import ProductRoutes from "./routes/products";
import ProductManagementRoutes from "./routes/productManagement";
import PublicProductsRoutes from "./routes/publicproducts";
import CartRoutes from "./routes/cart";
import CheckoutRoutes from "./routes/checkout";
import OrderRoutes from "./routes/orders";
import BuyNowRoutes from "./routes/buynow";
import UserRoutes from "./routes/users";
import RazorpayRoutes from "./routes/razorpay"; // legacy compatibility
import RazorpayWebhookRoutes from "./routes/razorpayWebhook"; // legacy compatibility
import PaymentRoutes from "./routes/payments";
import GuestOrderRoutes from "./routes/guestOrders";
import PaymentWebhookRoutes from "./routes/paymentWebhooks";
import AdminDashboardRoutes from "./routes/adminDashboard";
import CategoryRoutes from "./routes/categories";
import SubCategoryRoutes from "./routes/subcategories";
import TagRoutes from "./routes/tags";
import CouponRoutes from "./routes/coupons";
import path from "path";
import ReviewRoutes from "./routes/reviews";
import MediaRoutes from "./routes/media";
import analyticsRoutes from "./routes/analytics";
import inventoryRoutes from "./routes/inventory";
import wishlistRoutes from "./routes/wishlist";
import invoiceRoutes from "./routes/invoice";
import shiprocketRoutes from "./routes/shiprocket";
import ShippingUnifiedRoutes from "./routes/shippingUnified";
import deliveryRoutes from "./routes/delivery.manager";
import { startCheckoutMaintenance } from "./jobs/checkoutPayments.job";
import { startShipmentCron } from "./jobs/shipmentCron";
import adminShipment from "./routes/adminShipment";
import adminProductImportExportRoutes
from "./routes/adminProductImportExport.routes";



import shiprocketDebug from "./routes/shiprocketDebug";
import publicCatalogRouter from "./routes/public.catalog";

import publicReviewsRoutes from "./routes/publicReviews"; // ✅ MUST be here
import homeSliderRoutes from "./routes/homeSlider";
import bannerGridRoutes from "./routes/banner-grid";
import colorRoutes from "./routes/adminProductColor";
import commerceV2Routes from "./routes/commerceV2";
import catalogManagementRoutes from "./routes/catalogManagement";
import searchV2Routes from "./routes/searchV2";
import inventoryV2Routes from "./routes/inventoryV2";
import customerAccountRoutes from "./routes/customerAccount";
import cartV2Routes from "./routes/cartV2";
import checkoutV2Routes from "./routes/checkoutV2";
import navigationRoutes from "./routes/navigation";
import adminOperationsRoutes from "./routes/adminOperations";
import commerce913Routes from "./routes/commerce913";
import commerce1417Routes from "./routes/commerce1417";
import commerce1820Routes from "./routes/commerce1820";
import commerce2125Routes from "./routes/commerce2125";
import adminPlatformCompatRoutes from "./routes/adminPlatformCompat";
import mobileAccessibilityRoutes from "./routes/mobileAccessibility";
import { apiRateLimit, requireHttps, securityHeaders, logError } from "./middleware/security";

import {
  getMainImage,
  getEffectivePrice,
  mapProductListItem,
  mapProductDetail
} from "./mappers/product.mapper";

















// Middleware
import { auth } from "./middleware/auth";

const app = express();
app.set("trust proxy", (process.env.TRUST_PROXY || "loopback").split(",").map(value => value.trim()).filter(Boolean));




const PORT = Number(process.env.PORT) || 6103;

/* ======================================================
   GLOBAL MIDDLEWARE
====================================================== */
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true }));
app.use(requireHttps);
app.use(securityHeaders);
app.use(apiRateLimit(Number(process.env.RATE_LIMIT_PER_MINUTE || 180)));


/**
 * ⚠️ Razorpay webhook MUST use raw body
 * This route MUST come BEFORE express.json()
 */
app.use(
  "/api/razorpay/webhook",
  express.raw({ type: "application/json" }),
  RazorpayWebhookRoutes
);

// Unified payment webhooks. Raw body is required for signature verification.
app.use(
  "/api/payments/webhooks",
  express.raw({ type: "application/json" }),
  PaymentWebhookRoutes
);

// Normal JSON parser for rest of app
app.use(express.json());
app.get("/api/me", auth, (req: any, res) => {
  res.json({ ok: true, user: req.user });
});

/* ======================================================
   PUBLIC ROUTES (NO AUTH)
====================================================== */
app.use("/api/auth", AuthRoutes);
app.use("/api/publicproducts", PublicProductsRoutes);
app.use("/api/buy-now", BuyNowRoutes);     // public buy now
app.use("/api/checkout", CheckoutRoutes); // guest + user checkout
app.use("/api/razorpay", RazorpayRoutes); // legacy; migrate storefront to /api/payments
app.use("/api/payments", PaymentRoutes);
app.use("/api/guest-orders", GuestOrderRoutes);
app.use("/api/publicreviews", publicReviewsRoutes);



/* ======================================================
   PROTECTED ROUTES (AUTH REQUIRED)
====================================================== */
app.use("/api/admin/product-management", ProductManagementRoutes);
app.use("/api/products",  ProductRoutes);
app.use("/api/cart", auth, CartRoutes);
app.use("/api/orders", auth, OrderRoutes);
app.use("/api/users", auth, UserRoutes);
app.use("/api/admin/dashboard", auth, AdminDashboardRoutes);
app.use("/api/categories", CategoryRoutes);
app.use("/api/subcategories", SubCategoryRoutes);
app.use("/api/tags", TagRoutes);
app.use("/api/coupons", CouponRoutes);
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/api/reviews", ReviewRoutes);
app.use("/api/media", auth, MediaRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/pos", posRoutes);
app.use("/api/inventory", inventoryReconciliationRoutes);
app.use("/api/inventory-legacy", inventoryRoutes);
app.use("/api/inventory", inventoryV2Routes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/invoice", invoiceRoutes);
app.use("/api/shiprocket", auth, shiprocketRoutes);
app.use("/api/shipping/operations", shippingOperations);
app.use("/api/shipping", ShippingUnifiedRoutes);

app.use("/api/delivery", deliveryRoutes);
app.use("/api/admin/shipments", adminShipment);
app.use("/api/shipping/shiprocket", auth, shiprocketRoutes);
app.use("/api/public", publicCatalogRouter);
app.use("/api/banner-grid", bannerGridRoutes);

app.use("/api", shiprocketDebug);

app.use("/api/home-slider", homeSliderRoutes);


app.use("/api/admin/product-colors", colorRoutes);
app.use("/api/v2", commerceV2Routes);
// Commerce modules 3-5: catalog, search/filtering and advanced inventory
app.use("/api/catalog", catalogManagementRoutes);
app.use("/api/search", searchV2Routes);
app.use("/api/inventory-v2", inventoryV2Routes);
app.use("/api/account", customerAccountRoutes);
app.use("/api/cart-v2", cartV2Routes);
app.use("/api/checkout-v2", checkoutV2Routes);
// Commerce modules 9-13
app.use("/api", adminOperationsRoutes);
app.use("/api/commerce", commerce913Routes);
// Commerce modules 14-17: trust, marketing, SEO and CMS
app.use("/api/content", navigationRoutes);
app.use("/api/content", commerce1417Routes);
// Commerce modules 18-20: support, analytics/reports, tracking & ads
app.use("/api/platform", commerce1820Routes);
// Commerce modules 21-25
app.use("/api/platform", commerce2125Routes);
app.use("/api", adminPlatformCompatRoutes);
// Commerce module 26: mobile/PWA support, push notifications and accessibility content APIs
app.use("/api/platform", mobileAccessibilityRoutes);


app.use(
  "/api/admin/products",
  adminProductImportExportRoutes
);



/* ======================================================
   HEALTH CHECK
====================================================== */
app.get("/", (_req, res) => {
  res.send("✅ Ecommerce API is running...");
});

app.get("/api", (_req, res) => {
  res.send("✅ Ecommerce API is running...");
});

app.use(logError);

/* ======================================================
   START SERVER
====================================================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


if (process.env.DISABLE_JOBS !== "true") {
  console.log("✅ Jobs enabled");
  startShipmentCron();
  startShippingWorkflow();
  startShadowfaxCron();
  startCheckoutMaintenance();
} else {
  console.log("⛔ Jobs disabled (DISABLE_JOBS=true)");
}
