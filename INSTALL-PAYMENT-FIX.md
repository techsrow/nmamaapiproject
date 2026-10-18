> Superseded deployment steps: read DEPLOY-API.md and API-INVENTORY-POS.md first. This release also adds the inventory/POS migration and stock trigger.

# Latest shipping update: deployment change

Read SHIPPING-RULES.md first. This version adds Shadowfax360 and requires the new enum migration before restart. Earlier no-migration instructions are superseded. Admin UI source is still needed if its provider cards are hardcoded.

# Namama API payment correction

This ZIP contains the complete uploaded API src tree and supplied Prisma tree, with corrections to checkout and payment handling. Deploy it together with Namama-Frontend-Payment-Fixed.zip. It is a source update for your existing project; keep your existing root package files, server configuration, uploads and environment. The included validation-config folder contains the recovered package.json, lockfile and tsconfig used for verification, for reference only.

Read GUEST-CHECKOUT.md first for the guest flow, the screenshot’s Missing token issue and the API-version deployment check.

Read SHIPPING-RULES.md for the latest rule-first shipping charge behavior, order-range examples and how to refresh an unpaid saved order.

## Install

1. Back up the API source and database. Merge src, prisma/schema.prisma and the new 20261015120000_shadowfax360 migration into the existing API project; preserve the server migration history. Keep your server's .env; actual credentials are deliberately excluded from this ZIP. .env.example lists relevant settings only, and is not a replacement for your full environment.
2. Keep the existing dependencies. Verification used Prisma/client 6.19.3, Express 5, TypeScript 5 and the Razorpay 2.x SDK. Do not upgrade to Prisma 7 as part of this update.
3. Run these commands from the existing API project:

```bash
npx prisma validate
npx prisma migrate status
# Review pending migrations before applying them (see SHIPPING-RULES.md).
npx prisma migrate deploy
npx prisma generate
npm run build
node tests/payment-integration.cjs
node tests/checkout-tax.cjs
pm2 restart nmama-api --update-env
```

Use your actual PM2 process name if different. The two test files use mocks and do not contact your live gateway/database. The Prisma schema and migration files are preserved; the payment changes introduce no migration, but the latest Shadowfax360 addition DOES require the new enum migration (see SHIPPING-RULES.md). Do not reset your database. If the deployed database is behind the supplied schema, review and apply your existing migrations through your normal deployment process first.

4. Deploy the matching frontend and set its server-side COMMERCE_API_BASE_URL=https://api.nmama.in/api. Build and restart that project too.
5. In payment administration, enable Razorpay with matching keyId, keySecret and webhookSecret. Begin with test-mode credentials. Enable COD/BankTransfer/Manual only when those methods are intended; offline instructions come from publicConfig.instructions.
6. Configure the Razorpay webhook at https://api.nmama.in/api/payments/webhooks/razorpay with the matching webhook secret. Subscribe to payment.authorized, payment.captured, payment.failed, order.paid, refund.created, refund.processed and refund.failed. The legacy /api/razorpay/webhook route is also supported; use one configured endpoint to avoid unnecessary duplicate delivery.

## Changes

- Guest checkout now receives signed, order-specific access tokens. Payment creation, status and verification accept these tokens without making all order data public. Invalid account credentials cannot fall back to guest access.
- Order placement preserves the quote, delivery selection, calculated tax and expected total. Repeated checkout keys return the same order. Definitive pre-creation rejections unlock the frontend; ambiguous failures retain the retry key.
- Razorpay creation reuses a durable payment attempt. Unknown remote outcomes reconcile by receipt instead of immediately creating another charge. Amount, currency, order ID, signature and fetched capture state are verified server-side.
- Signed raw-body webhooks and browser verification use the same payment service. Authorized payments are captured before the order is marked Paid. Replayed or delayed failures cannot downgrade captured payment.
- Cart cleanup preserves items changed after checkout. Reserved inventory and coupon usage are released once on eligible cancellation/expiry, with no second inventory deduction during payment confirmation.
- COD/offline orders are confirmed with payment pending. Manual payment entries validate the outstanding balance and support reference deduplication.
- Refunds reserve the refundable balance, support idempotent retries, reconcile uncertain responses and dashboard refunds, and do not reopen payment debt. Use a distinct Idempotency-Key for each intentionally separate refund, and reuse it for retries.
- Environment loading happens before authentication initialization. Error handling returns safe customer messages. Trusted-proxy handling, rate-limit IP selection and existing Express parameter type errors are corrected.

## Configuration and operational behavior

CHECKOUT_ACCESS_SECRET must be a stable, strong secret. Changing it invalidates outstanding guest order tokens (valid for 24 hours). Keep PAYMENT_CONFIG_ENCRYPTION_KEY unchanged while existing gateway credentials are encrypted with it; replacing it blindly makes those credentials unreadable. A stronger encryption key requires a planned credential re-encryption/re-entry procedure. Use a long random JWT_SECRET; rotating it requires users to sign in again.

TRUST_PROXY defaults to loopback, suitable when Nginx connects locally. If your reverse proxy connects from another address, set trusted proxy addresses/subnets explicitly. Do not blindly trust arbitrary client-forwarded headers. This remains an in-memory, per-process rate limiter, not a distributed limiter.

Leave DISABLE_JOBS=false to enable checkout maintenance. It scans reservations in batches every two minutes. CHECKOUT_RESERVATION_HOURS defaults to 24 (allowed 1–168). Reconciliation runs before unpaid expiry. Authorized payments and uncertain gateway outcomes stay reserved pending reconciliation or operator review. Large backlogs may take multiple scans.

New reservation records use reserved StoreSetting keys checkout-order:, checkout-lifecycle: and payment-stock:. Admin settings cannot overwrite these keys. Older orders without lifecycle records require manual stock/coupon audit; the code does not guess whether historical inventory was already deducted. Late capture of a cancelled order records the money and an incident, leaves the order cancelled, and requires refund review.

Implemented payment adapters are Razorpay, COD, BankTransfer and Manual. The storefront methods endpoint now filters out unsupported adapters even when enabled in admin. No Stripe, PhonePe or other provider integration is claimed.

Payment webhooks reconcile payment state. The old direct shipping-booking behavior is not carried into this shared handler; use the existing shipping administration/module to book shipments after confirmation. Review that operational step before release.

## Verification and limits

- Full API TypeScript build passed; supplied Prisma schema validated.
- 41 mocked payment/service/HTTP checks passed, covering guest access, duplicate requests, capture, cancellation, refunds and webhook signatures.
- 54 mocked checkout/tax/token checks passed, including tax calculation, quote mismatch, idempotency and definitive rejection recovery.
- Matching frontend typecheck, 20 payment-flow checks and proxy checks passed. Its production webpack build passed using the available verification configuration, including the new tracking route.
- No real PostgreSQL concurrency test, live Razorpay payment, production deployment or full audit of unrelated business modules was performed. Browser visual QA was blocked by Chromium crashing in this environment.

Before live rollout, exercise test-mode success, dismissal/retry, refresh after payment, delayed webhook, COD, refund and stock release on staging using your actual database and server configuration. Confirm the gateway popup opens and the receipt appears only after server-confirmed capture.
