# Namama API — Modules 21–25

## 21 Taxes & Invoicing
Tax rules and tax calculator support inclusive/exclusive tax, country/region and HSN/SAC matching. Products now store HSN/SAC and tax class. Orders support GSTIN, immutable invoice number/date and tax snapshot. Admin endpoints issue sequential FY GST invoice numbers, create credit notes and return tax reports.

Key endpoints: `GET/POST /api/platform/tax/rules`, `POST /api/platform/tax/calculate`, `POST /api/platform/invoices/:orderId/issue`, `POST /api/platform/credit-notes`, `GET /api/platform/tax/reports`.

## 22 Admin & Staff
Staff accounts reuse secure User authentication and attach a StaffProfile with configurable StaffRole permissions. Includes staff CRUD foundation, roles/permissions, activity logs, approval requests, product bulk actions and per-user notification settings.

Key endpoints: `/api/platform/admin/roles`, `/admin/staff`, `/admin/activity`, `/admin/approvals`, `/admin/bulk/products`, `/admin/notifications`.

## 23 Security & Reliability
Adds production HTTPS enforcement behind a trusted reverse proxy, security response headers, in-memory API rate limiting, staff MFA enrollment state, fraud scoring records, DB-backed incident/error logging, backup registry and database health endpoint. Production backup execution remains infrastructure/provider-specific; this API records and monitors jobs rather than pretending to create off-server backups.

## 24 International Selling
Currency configs, locales, markets, translated product content, regional product/variant prices, country-market payment/shipping configuration and existing tax/shipping rule integration.

## 25 Integrations
Generic secure integration registry for payment/shipping/accounting/CRM/ERP/email/marketplace adapters plus existing Razorpay, Shiprocket, Delhivery, mail and tracking integrations. Webhook endpoints, event queue, HMAC signing, delivery status and retry scheduling are included.

## Migration
Use a backup/staging PostgreSQL database first:

```bash
npm install
npx prisma format
npx prisma migrate dev --name modules_21_25
npx prisma generate
npm run build
```

Provider credentials are never returned by the integrations list endpoint. Actual external accounting/CRM/ERP/marketplace synchronization requires the relevant provider credentials and mapping rules.
