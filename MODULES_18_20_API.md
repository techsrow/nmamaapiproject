# Namama API — Modules 18–20

Base route: `/api/platform`

## 18. Customer Support
- `POST /support/contact` public contact form
- `GET/PATCH /support/contact` admin contact inbox/workflow
- `GET /support/help`, `GET /support/help/:slug` public help center
- `POST/PATCH/DELETE /support/help` admin help articles
- `POST /support/tickets` customer ticket, optional `orderId` ownership validation
- `GET /support/tickets/mine` customer tickets
- `GET /support/tickets` admin ticket queue; supports order enquiries
- `GET/POST /support/tickets/:id/messages` ticket conversation + attachments metadata
- `PATCH /support/tickets/:id/status` admin workflow
- `POST /support/chat` create/continue guest live-chat conversation
- `GET /support/chat/:id/messages?token=...` guest chat polling
- `/support/admin/chats/*` staff chat queue/reply/close
- `GET/PUT /support/whatsapp` WhatsApp support configuration

## 19. Analytics & Reports
- `POST /analytics/events` first-party event collector (session, UTM/source/medium/campaign, product/order/value)
- `GET /analytics/overview?from=&to=` revenue, orders, AOV, sessions, conversion rate, refunds
- `GET /analytics/sales` daily sales/revenue/refund report
- `GET /analytics/top-products`
- `GET /analytics/inventory` stock units, low/out-of-stock variants
- `GET /analytics/customers/retention` repeat-customer rate
- `GET /analytics/refunds`
- `GET /analytics/attribution` source/medium/campaign order + revenue attribution

## 20. Tracking & Ads
- GA4/GTM/Google Ads/Meta configuration registry (`/tracking/integrations`)
- Public safe frontend config (`GET /tracking/config`) — secret config is never returned here
- Consent records (`POST/GET /tracking/consent`) for analytics/marketing/advertising/functional consent
- Server-side conversion queue (`POST /tracking/conversions`)
- Meta Conversions API sender (`POST /tracking/conversions/:id/send`) with SHA-256 normalized user identifiers
- Google Ads conversion queue/adapter boundary for OAuth-backed uploader
- Product feeds: admin CRUD + public Google/Meta-compatible XML or JSON (`GET /tracking/feed/:id.xml`, `.json`)

### Meta secretConfig example
`{"pixelId":"...","accessToken":"...","apiVersion":"v24.0"}`

### Frontend integrations
Store only browser-safe IDs in `publicConfig` (GA measurement ID, GTM container ID, Google Ads ID, Meta Pixel ID). Tokens/secrets belong in `secretConfig` and are only available to authenticated admin/server operations.

## Database migration
After backing up/staging the database:
```bash
npm install
npx prisma format
npx prisma migrate dev --name modules_18_20
npx prisma generate
npm run build
```
Production should use the generated migration with `npx prisma migrate deploy`.
