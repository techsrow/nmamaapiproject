# Module 26 — Mobile & Accessibility API

This module completes the **API-side** requirements for mobile/PWA clients and accessibility. Responsive layout, keyboard focus behavior, service-worker caching, install UI, and native Android/iOS screens belong to the storefront/native applications and cannot be implemented inside an Express API alone.

## Mobile / PWA client support
- `GET /api/platform/mobile/bootstrap` — public app bootstrap/config.
- `GET /api/platform/mobile/manifest.webmanifest` — dynamic PWA manifest.
- `GET /api/platform/mobile/settings` — admin settings.
- `PUT /api/platform/mobile/settings/:key` — upsert app/PWA settings.

Suggested setting key: `pwa.manifest`, with `name`, `short_name`, `description`, `start_url`, `display`, `background_color`, `theme_color`, and `icons`.

## Push notifications
- `POST /api/platform/push/devices` — register Web/Android/iOS push subscription/device.
- `PATCH /api/platform/push/devices/:token/preferences` — transactional/marketing preferences.
- `DELETE /api/platform/push/devices/:token` — disable subscription.
- `GET /api/platform/push/devices` — admin device list.
- `POST /api/platform/push/notifications` — create notification/campaign.
- `GET /api/platform/push/notifications` — admin notification history.
- `POST /api/platform/push/notifications/:id/send` — resolve audience and send/queue.

The delivery adapter supports OneSignal for Web Push, Android and iOS. Configure an enabled `IntegrationConnection` with provider `ONESIGNAL`, `config.appId`, and `secrets.apiKey`. Without credentials notifications remain queued rather than being falsely marked sent.

## Accessibility
- `POST /api/platform/accessibility/audit/products` — audit active product content and media for missing accessible names/descriptions/alt text.
- `GET /api/platform/accessibility/issues` — accessibility issue list.
- `PATCH /api/platform/accessibility/issues/:id` — mark issue resolved/unresolved.

Existing product/image/media `altText` fields are reused. The API supports accessible product content, but WCAG keyboard navigation, focus states, semantic HTML, labels, contrast and screen-reader behavior must be implemented and tested in the web/mobile UI.

## Database migration
After backing up/staging the database:

```bash
npm install
npx prisma format
npx prisma migrate dev --name module_26_mobile_accessibility
npx prisma generate
npm run build
```

For production use your normal reviewed Prisma deployment workflow (`prisma migrate deploy`).
