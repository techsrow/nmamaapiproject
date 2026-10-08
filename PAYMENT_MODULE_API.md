# Namama Unified Payment API

## Provider management (Admin)
- GET `/api/payments/providers/catalog`
- GET `/api/payments/providers`
- GET `/api/payments/providers/:provider`
- PUT `/api/payments/providers/:provider`
- POST `/api/payments/providers/:provider/test`
- PATCH `/api/payments/providers/:provider/status`

Provider names: Razorpay, Stripe, PhonePe, Cashfree, PayU, CCAvenue, PayPal, Square, COD, BankTransfer, Manual.
Credentials are AES-256-GCM encrypted at rest using `PAYMENT_CONFIG_ENCRYPTION_KEY`; API responses only contain masked credential values.

## Transactions
- GET `/api/payments`
- GET `/api/payments/order/:orderId`
- POST `/api/payments/create`
- POST `/api/payments/verify/razorpay`
- POST `/api/payments/manual`
- GET `/api/payments/refunds`
- POST `/api/payments/:paymentId/refund`

## Webhooks
- POST `/api/payments/webhooks/razorpay` (raw request body)

## Important rollout note
Razorpay plus offline/manual payment execution is wired in this package. The provider registry and encrypted configuration model includes the other requested gateways, but their transaction adapters must be implemented against each merchant's enabled product/API contract before enabling them. The API intentionally returns an explicit error instead of pretending an unsupported gateway transaction succeeded.

## Migration
1. Set `PAYMENT_CONFIG_ENCRYPTION_KEY`.
2. Run `npx prisma migrate deploy` in production, or `npx prisma migrate dev` locally.
3. Run `npx prisma generate`.
4. Configure Razorpay through `PUT /api/payments/providers/Razorpay`.
5. Test it through `POST /api/payments/providers/Razorpay/test`.
6. Move storefront calls from `/api/razorpay/*` to `/api/payments/*`.
7. After storefront migration is verified, remove the legacy Razorpay route imports/mounts.
