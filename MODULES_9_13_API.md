# Namama API — Modules 9–13

Base path: `/api/commerce`

## 9. Payments
Supports existing Razorpay card/UPI/netbanking/wallet flow plus COD, manual/bank-transfer payments, multiple/partial payments, payment aggregation/status, full or partial refunds and refund audit records.

- `GET /payments/order/:orderId`
- `POST /payments/manual` (Admin) — `{orderId, amount, method, provider, reference, status}`
- `POST /payments/:paymentId/refund` (Admin) — `{amount?, reason?}`. Razorpay refunds are sent to Razorpay when credentials/payment ID exist; manual/COD/bank records are handled as internal refunds.

Payment states: Pending, Created, PartiallyPaid, Paid, Failed, PartiallyRefunded, Refunded. Methods include CARD, UPI, NETBANKING, WALLET, COD, Prepaid and BANK_TRANSFER.

## 10. Order Management
- `GET /orders/dashboard` (Admin)
- `POST /orders/manual` (Admin)
- `PATCH /orders/:id` (Admin)
- `POST /orders/:id/cancel` (customer owner or Admin)
- `POST /orders/:id/fulfillments` (Admin) — partial or complete item fulfillment, tracking/label metadata
- `GET /orders/:id/packing-slip` (Admin)

Existing `/api/orders`, `/api/invoice`, shipment tracking and invoice routes remain available. New order states include Processing, PartiallyFulfilled, Fulfilled and Returned.

## 11. Shipping & Delivery
Existing Shiprocket/Delhivery integrations are retained. Added database-driven shipping methods for flat/value/weight rules, free-shipping thresholds, COD eligibility, local delivery and store pickup.

- `GET /shipping/zones`
- `POST /shipping/zones` (Admin)
- `POST /shipping/methods` (Admin)
- `POST /shipping/quote` — `{zoneId, subtotal, weightKg, cod}`
- `POST /shipping/cod-serviceability` — `{zoneId}`

`ShippingMethod.type` is intentionally flexible (`FLAT`, `WEIGHT`, `VALUE`, `LOCAL_DELIVERY`, `STORE_PICKUP`) so the admin can add methods without another enum migration. Estimated min/max delivery days are stored per method.

## 12. Returns & Exchanges
- `GET /returns/eligibility/:orderId`
- `POST /returns` — return/exchange request
- `PATCH /returns/:id` (Admin) — approve/reject/pickup/received/refunded/exchanged workflow, reverse-pickup metadata and refund amount
- `POST /returns/:id/store-credit` (Admin)

`ReturnPolicy` stores the eligibility window, exclusions, conditions, allowed return/exchange methods and reverse-pickup policy. Monetary refunds can use Module 9 refund API; store-credit refunds have their own ledger.

## 13. Pricing & Promotions
The existing Coupon engine remains intact for normal coupon codes. The advanced `Promotion` engine supports PERCENT, FIXED, BOGO, BUNDLE, QUANTITY, FLASH, CUSTOMER_PRICE and GIFT_CARD promotion types with JSON rules/benefits and priority/active windows.

- `GET /promotions` (Admin)
- `POST /promotions` (Admin)
- `PATCH /promotions/:id` (Admin)
- `DELETE /promotions/:id` (Admin)
- `POST /promotions/evaluate` — evaluates active promotions against cart context
- `POST /gift-cards` (Admin)
- `POST /gift-cards/check`

Example percentage promotion:
```json
{"name":"Festive 15%","type":"PERCENT","rules":{"minSubtotal":1000},"benefit":{"percent":15},"startsAt":"2026-10-01T00:00:00.000Z","endsAt":"2026-10-31T23:59:59.000Z"}
```

Example quantity discount:
```json
{"name":"Buy 3 Save 10%","type":"QUANTITY","rules":{"minQuantity":3},"benefit":{"percent":10}}
```

## Database upgrade
Run on a staging/backup database first:
```bash
npm install
npx prisma format
npx prisma validate
npx prisma migrate dev --name modules_9_13
npx prisma generate
npm run build
```
For production, commit the generated migration and use `npx prisma migrate deploy`.

## Important provider configuration
Razorpay refunds require `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Shiprocket/Delhivery still require the credentials already used by the existing project. Bank transfer confirmation is deliberately Admin-controlled because settlement confirmation depends on your bank/payment reconciliation process.
