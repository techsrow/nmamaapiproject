# Namama API — Modules 14–17

Base route: `/api/content`

## 14. Reviews & Trust
- `GET /trust/reviews/product/:productId` approved reviews + computed verified-purchase flag + photo/video media
- `POST /trust/reviews/:id/media` customer photo/video review media
- `PATCH /trust/reviews/:id/moderate` admin moderation
- `GET|POST|PATCH|DELETE /trust/testimonials...` testimonials
- `GET|POST|PATCH /trust/badges...` trust badges
- `GET|POST|PATCH|DELETE /trust/faqs...` FAQs
Existing `/api/reviews` remains compatible.

## 15. Marketing & Retention
- Campaigns for EMAIL/SMS/WHATSAPP with scheduling/status/delivery queue
- Customer segments with JSON rules
- Abandoned-cart list/reminder tracking
- Product recommendations, upsells and cross-sells
- Loyalty account/ledger and admin adjustments
- Referral codes/events
- Affiliate accounts/click/conversion tracking

Provider credentials are environment-specific. Campaign records and delivery queues are provider-neutral so SMTP, Twilio/MSG91, Meta WhatsApp Cloud API, etc. can be connected without changing the commerce schema.

## 16. SEO
- Entity SEO metadata and structured data
- Product JSON-LD endpoint
- Dynamic XML sitemap
- robots.txt
- canonical metadata storage
- redirect manager
- product image alt-text audit via technical SEO audit
- blog SEO fields

Important env: `STOREFRONT_URL`, `API_PUBLIC_URL`.

## 17. Content Management
- Generic CMS pages for About, Contact, policies and landing pages
- Blog CRUD/public listing
- Existing media library reused
- FAQs reused from trust module
- JSON page-builder content + reusable PageTemplate schema
- Navigation menu editor

## Database migration
After backing up/staging the database:
```bash
npm install
npx prisma format
npx prisma migrate dev --name modules_14_17
npx prisma generate
npm run build
```
Production should use the reviewed migration with `npx prisma migrate deploy`.
