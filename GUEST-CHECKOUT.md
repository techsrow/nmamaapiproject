# Guest checkout — 14 October 2026

Deploy the API and frontend updates together. No login or registration is needed.

## Customer flow implemented

1. Guest cart → contact and delivery address → optional separate billing address.
2. Review validated delivery options, discount, tax and the server-calculated total.
3. Select an enabled supported method: Razorpay, COD, BankTransfer or Manual.
4. Pay/place order saves one durable checkout attempt. Retries reuse its order and gateway payment.
5. Razorpay opens its secure popup. Server verification/capture or a signed webhook confirms payment. COD/offline orders are confirmed with payment pending.
6. Closing the popup leaves the same order available for retry. Refreshing checks existing status without opening a popup. Five background status checks, three seconds apart, can recover a delayed webhook; the customer can check again manually.
7. Confirmation shows the order number, products, totals, delivery address, selected delivery and payment status, with Track order, Copy tracking link and Continue shopping.
8. Guest tracking shows current order/payment/shipment status and courier tracking when available. It needs the private link; the order number alone grants no access.

An unpaid saved order can be cancelled using the explicit cancellation button before editing details. The backend reconciles payments first and refuses unsafe cancellation. Unknown gateway outcomes remain tied to the original order. Payment success is never inferred from the popup callback alone.

## Fix the screenshot’s “Missing token” response

That exact message is emitted by account-JWT authentication. The supplied guest payment routes accept x-order-access-token and require no account JWT. The screenshot alone cannot identify whether your running API is old, the proxy points elsewhere, or an old compiled route is still running.

1. Merge the API src and supplied Prisma tree into your existing project. Keep the existing .env, package files and uploads.
2. In the API project run npx prisma generate, then npm run build. Restart the API process you actually use, for example pm2 restart nmama-api --update-env.
3. Check GET /api/payments/methods on the running API. Its JSON must contain guestCheckoutVersion: 2 alongside success and data. If that field is absent, the new guest routes are not running at that URL.
4. Set the frontend server environment to the correct API base INCLUDING /api:

```env
# Live website
COMMERCE_API_BASE_URL=https://api.nmama.in/api
# Local frontend + local API: use this instead, only if your API listens on 3011.
# COMMERCE_API_BASE_URL=http://127.0.0.1:3011/api
```

Restart the Next development server after editing .env.local. For production, build and restart the frontend using your normal deployment process. The value is read server-side; do not put payment secrets in NEXT_PUBLIC variables.

5. Check /commerce-api/payments/methods on the frontend origin. It must also show guestCheckoutVersion: 2. If only the API URL shows it, fix the frontend base URL or a conflicting Next/Nginx rewrite intercepting /commerce-api.
6. Keep the existing checkout tab/session and use Continue payment after deployment. Do not clear its storage or create another order to bypass the error. If payment was already captured, the status check should show the existing receipt.

The capability marker is a deployment diagnostic only. The frontend displays supported enabled methods even when that optional marker is missing; payment endpoints still enforce signed guest access. Existing saved orders remain available; an account-only backend error explains that the saved order needs store assistance rather than prompting the guest to sign in.

## Access and tracking

- Payment access: signed order-specific token, 24-hour lifetime. An expired token can be recovered only using the saved cart token, exact request UUID, matching checkout payload and existing order ID. Recovery never creates an order.
- Tracking: separate signed read-only token, 30-day lifetime. It cannot create payments or cancel orders. Keep CHECKOUT_ACCESS_SECRET stable.
- Tracking links use /track-order/ORDER_ID#token=PRIVATE_TOKEN. The fragment is not sent as a URL query to the server. The page moves it into session storage, removes the fragment from the visible URL and passes it in x-order-tracking-token. Copy private tracking link reconstructs the shareable link.
- Tracking responses omit addresses, phone numbers, email, internal notes, payment secrets and raw provider data. Do not post private links publicly. After expiry, contact the store for assistance.
- Notifications by email/SMS and OTP-based order lookup are not added in this update. The private link is available on confirmation and can be copied by the customer.

## Endpoint map

| Operation | Endpoint | Access |
| --- | --- | --- |
| Enabled supported methods | GET /api/payments/methods | Public |
| Validate delivery address | POST /api/checkout-v2/validate-address | Guest |
| Prepare totals | POST /api/checkout-v2/prepare | Guest cart |
| Place one order | POST /api/checkout-v2/place-order | Guest cart + Idempotency-Key |
| Recover existing access | POST /api/checkout-v2/recover-order | Exact original attempt + orderId |
| Read/reconcile payment | GET /api/payments/order/:id | x-order-access-token |
| Create/reuse gateway payment | POST /api/payments/create | x-order-access-token |
| Verify Razorpay | POST /api/payments/verify/razorpay | x-order-access-token |
| Cancel unpaid order | POST /api/payments/order/:id/cancel | x-order-access-token |
| Read guest tracking | GET /api/guest-orders/:id | x-order-tracking-token |

The frontend proxies these through /commerce-api. Account/admin endpoints remain protected.

## Validation and release checks

API build, frontend production webpack build and type checking pass. Automated mocked checks: 41 payment/service/HTTP, 54 checkout/tax/access-recovery, 20 frontend payment-flow checks, plus proxy allowlist/header checks. No schema migration is introduced.

Browser automation could not run because Chromium exits with SIGSEGV on startup in this environment. No live gateway charge or real PostgreSQL concurrency test was performed. Before live release, run a Razorpay test-mode purchase on your server, dismiss/retry, refresh after capture, test COD, verify the private tracking link and confirm unrelated guests cannot view it.

Configure Razorpay webhook https://api.nmama.in/api/payments/webhooks/razorpay with matching credentials and webhook secret. Keep checkout maintenance enabled. See INSTALL-PAYMENT-FIX.md for the retained payment, refund and reservation behavior.


## API URL and payment-selector correction

The earlier frontend incorrectly hid Razorpay when a valid methods response lacked guestCheckoutVersion: 2. That display restriction is removed. The marker remains useful to identify the updated backend, but is not an authorization mechanism.

Catalog reads and the checkout proxy now use the same API base, in this order: COMMERCE_API_BASE_URL, API_BASE_URL, NEXT_PUBLIC_API_BASE_URL, then https://api.nmama.in/api. Set these consistently in the FRONTEND .env.local. NEXT_PUBLIC_API_BASE_URL also controls browser image origins, so it should be a browser-accessible URL.

For a local API listening on 3011 (replace the port if yours differs):

```env
API_BASE_URL=http://localhost:3011/api
COMMERCE_API_BASE_URL=http://localhost:3011/api
NEXT_PUBLIC_API_BASE_URL=http://localhost:3011/api
```

For the hosted API, set all three to https://api.nmama.in/api instead. Restart the Next dev server after saving. Production requires rebuild/restart for NEXT_PUBLIC changes. Preserve your other environment settings.

Catalog HTTP failures now include status and path, e.g. HTTP 500, path /api/publicproducts. They are still logged, not suppressed. A 404 suggests the wrong base/path or route; 401/403 indicates an access/proxy rule; 429 is rate limiting; 500/502/503 needs the API/server logs. This correction cannot repair an unknown live database or reverse-proxy failure without that response/log evidence.

Additional regression checks: node tests/api-config.cjs and node tests/payment-methods.cjs. The latter verifies that enabled Razorpay remains visible with missing, older and current capability metadata.
