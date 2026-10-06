# Ecommerce API V2 Upgrade

## Critical fixes
- Removed duplicate `Coupon.usagePerUser` Prisma field (schema-breaking bug).
- Removed insecure JWT fallback secret; `JWT_SECRET` is now mandatory.
- Replaced open CORS with `CORS_ORIGINS` allow-list.
- Fixed shipment cron startup so `DISABLE_JOBS=true` is respected.

## Shopify-like variable products
V2 adds `ProductOption` plus `ProductVariant.optionValues` JSON. A product can define up to 3 arbitrary options (e.g. Size, Color, Material) and each variant stores the exact option combination, independent SKU, price, compare-at price, sale price, barcode, stock, backorder/preorder flags and images. Existing size/color/weight fields remain for backward compatibility.

Endpoints:
- PUT `/api/v2/admin/products/:id/options`
- POST `/api/v2/admin/products/:id/variants`
- PATCH `/api/v2/admin/variants/:id`

## Added foundations/endpoints
Collections/seasonal merchandising, autocomplete/search history, customer address book, recently viewed, warehouse inventory/stock transfers, suppliers/purchase orders, returns/exchanges, promotions, CMS pages, FAQ, SEO redirects, shipping zones, tax rules, support tickets and central store settings for tracking, consent, localization and integrations.

## Existing modules retained
Products/media/import-export, categories/subcategories/tags, cart, checkout, Razorpay/COD, orders, coupons, reviews, wishlist, invoices, analytics, Shiprocket/delivery and home merchandising.

## Required deployment steps
1. Set `JWT_SECRET` and `CORS_ORIGINS`.
2. Run `npm ci`.
3. Run `npx prisma format && npx prisma validate`.
4. Create migration: `npx prisma migrate dev --name commerce_v2` (staging/dev) or deploy an already-reviewed migration in production.
5. Run `npx prisma generate` and `npm run build`.
6. Back up the production database before migration.

External providers (social login/OTP, SMS/WhatsApp, additional payment gateways, accounting/ERP/marketplaces, push notifications, mobile apps) require provider credentials and cannot be made live from source code alone; `StoreSetting`/webhook foundations are included for those integrations.
