# Namama API — inventory and separate POS backend

Source: the uploaded apiforai.zip, with the reviewed payment/shipping corrections merged. This is API code only. Main admin comes next, main website after that, and a separate staff POS on pos.nmama.in later. All use this API and database. No POS interface, camera scanner, printer bridge or subdomain deployment was created in this release.

## Implemented

- Existing guest checkout/Razorpay payment recovery, signed tracking and cancellation protections preserved.
- Active shipping rules set customer prices for all enabled providers; first otherwise eligible rule becomes fallback across order-value gaps. Default rule remains available when all providers are disabled. See SHIPPING-RULES.md.
- Shadowfax360 configuration, authentication test, tracking, labels and cancellation requests. An opt-in full-order booking adapter persists an intent before contacting the carrier and recovers uncertain outcomes by AWB. See SHADOWFAX-OPERATIONS.md for limits and activation.
- Variant-unique barcodes, deterministic internal EAN-13 generation, exact scan lookup, SVG barcode and printable A4 product/variant/price/barcode labels.
- Shared stock synchronization and movement ledger at the PostgreSQL level, covering current/legacy variant stock writers. Inventory purchase receipts/transfers/adjustments retained and use the shared write path. Purchase receipt and transfer state transitions lock the source document.
- Purchase receiving now requires a UUID Idempotency-Key, so a retry cannot receive the same delivery twice. The next admin update must supply/persist that key.
- Cashier sessions; POS item search; server-priced/taxed quotes; draft bills; split tender recording; completed orders; bill number allocation; receipts; sales pagination; session cash/payment summaries.
- POS partial/full returns with explicit restock choice, cumulative rounding, payment-refund records and credit notes. Damaged returns can refund without restocking. Retry keys prevent repeated stock/refund records.
- Database uniqueness for barcodes, open cashier sessions and POS external payment references.

## One inventory meaning

ProductVariant.stockQuantity means SELLABLE/AVAILABLE stock, not physical stock including reservations. WarehouseInventory.quantity allocates that same available balance to locations. The new flow does not use WarehouseInventory.reserved; existing nonzero legacy reservations require explicit review before migration use.

The stock trigger updates allocations and creates InventoryMovement in the SAME database transaction as each stock change. POS uses the session warehouse. Web checkout allocates available stock across active warehouses in ID order. Newly reserved web orders retain the reservation reference and release to their original warehouse allocations on cancellation/expiry. Historical reservations without allocation receipts restore to SYSTEM-UNALLOCATED.

Variants with no warehouse allocations adopt existing available stock into SYSTEM-UNALLOCATED at the next stock change. For POS, allocate/transfer that balance to the actual shop first. Inactive warehouse stock is not sellable. If stored allocations disagree with the global balance, sales fail instead of replacing stock with a stale sum. GET/POST reconciliation permits audited allocation of the existing available total; it does not create new stock. Use adjustments/purchase receipts for actual stock additions.

A physical stock count must subtract live reservations before being treated as an available count. There is no dedicated physical stocktake/count-approval workflow in this update. Supplier receiving, adjustments and transfers are the supported inventory operations.

## Security and payment boundary

All /api/pos endpoints require a Bearer JWT and a current active database user. Admin is allowed. Other active staff require an active StaffProfile whose StaffRole.permissions is an array containing pos.sell, pos.barcodes, pos.refund, pos.reports, pos.discount as appropriate, or pos.*. A stale Admin claim does not bypass the database check. Customer tokens cannot use POS. Configure CORS with the exact future HTTPS POS origin when its frontend is deployed; CORS is not authorization.

POS CASH/UPI/CARD/BANK_TRANSFER are externally collected payments recorded by staff. paymentReceived:true and external payment references are required. The API does NOT charge a card, verify a UPI receipt against a bank, or integrate a card terminal. Existing Razorpay gateway flows remain for website checkout. POS refunds similarly require refundPaid:true and record an already-executed external refund. Do not treat these endpoints as commands to move money.

Tender amounts must sum to the bill total. Record only applied cash (exclude change). Discounts require pos.discount. Every sale/return uses a UUID Idempotency-Key; preserve it and the exact normalized payload through retries. A changed payload with the same key is rejected. External payment references cannot be reused on another POS bill.

## API contracts

All JSON responses use {success:true,data:...}; errors use {success:false,message:...}.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/pos/variants?q=... | Search product/SKU/barcode, max 30 |
| GET | /api/pos/scan/:barcode | Exact active variant lookup |
| POST | /api/pos/barcodes/generate | {variantIds:[1,2]}; preserves existing codes |
| PUT | /api/pos/barcodes/:variantId | {barcode:"existing-code"}; uniqueness enforced |
| GET | /api/pos/barcodes/:variantId.svg | Internal/generated or other valid EAN-13 label |
| POST | /api/pos/barcodes/labels.pdf | {variantIds:[1,2],copies:1}; A4 labels |
| POST | /api/pos/sessions | {warehouseId:1,openingCash:500} |
| GET | /api/pos/sessions/current | Current cashier's open session |
| GET | /api/pos/sessions/:id/summary | Tender totals, cash refunds, expected cash and close variance |
| POST | /api/pos/sessions/:id/close | {closingCash:1500,note:"..."} |
| GET | /api/pos/drafts | Current cashier's saved drafts |
| PUT | /api/pos/drafts/:uuid | {revision:0,quote:{...quote request}}; optimistic revision check |
| DELETE | /api/pos/drafts/:uuid | Delete own draft |
| POST | /api/pos/quote | Server prices, tax, stock and total |
| POST | /api/pos/sales | Complete bill, Idempotency-Key required |
| GET | /api/pos/sales?before=123 | Sale records, 50/page, reports permission |
| GET | /api/pos/sales/:id | Own bill (Admin can access all), returns and credit notes |
| GET | /api/pos/sales/:id/receipt.pdf | PDF bill |
| POST | /api/pos/sales/:id/returns | Partial/full return, Idempotency-Key required |
| GET | /api/inventory/reconciliation?after=0 | Admin allocation review, 200/page |
| POST | /api/inventory/reconciliation/:variantId | Admin audited allocation of current available balance |

Existing /api/inventory endpoints remain for stock, low stock, settings, movements, warehouses, suppliers, purchase orders and transfers. POST purchase-orders/:id/receive now needs a persistent UUID Idempotency-Key per delivery.

Quote request example:
```json
{"sessionId":1,"items":[{"variantId":23,"quantity":2}],"discount":0,"customerName":"Walk-in customer"}
```
The warehouse address must include state (or region), with country default IN; existing active tax rules must match. Duplicate variant lines are rejected; merge quantity in the POS cart. POS permits tracked, in-stock variants; preorder/backorder/nontracked variants are rejected.

Complete sale: use the quote request plus expectedTotal, tenders and confirmation:
```json
{"sessionId":1,"items":[{"variantId":23,"quantity":2}],"discount":0,"customerName":"Walk-in customer","expectedTotal":200,"tenders":[{"method":"CASH","amount":200}],"paymentReceived":true}
```
These are example amounts; always use the server quote. Optional customerId links an existing active customer; optional customerEmail, customerPhone and customerGstin are stored with the bill. Drafts do not reserve stock and must be requoted before completion.

Return request:
```json
{"sessionId":2,"items":[{"orderItemId":42,"quantity":1,"restock":true}],"method":"CASH","reason":"Size return","refundPaid":true}
```
sessionId must be the returning cashier's current open session. Restock goes to that session's warehouse. Supply reference for noncash refunds. This is a paid return, not cancellation of an unpaid draft. Use POS returns rather than the generic payment refund endpoint for POS orders.

Allocation request:
```json
{"expectedStock":10,"reason":"Opening allocation verified","allocations":[{"warehouseId":1,"quantity":10}]}
```

## Barcode/printing boundary

Generated prefix-20 EAN-13 identifiers are internal store identifiers, not purchased globally registered GS1 codes. External alphanumeric barcodes may be assigned and scanned but the supplied label renderer accepts EAN-13 only. Generation is variant-based (size/colour), not per physical unit/serial number. Future frontend scanning should send decoded text to /scan, deduplicate continuous camera frames, and offer manual search. Receipt/label PDFs can be opened through a frontend browser print dialog. No universal Wi-Fi printer protocol or silent-printing bridge is provided.

## Validation and limits

TypeScript build and Prisma validation were run locally. Unit/HTTP mocks cover shipping, checkout tax, payment recovery, barcode generation, cashier authorization, POS stock/tenders and partial returns. Embedded PostgreSQL tests apply the new migration and run actual stock triggers, rollback paths, barcode uniqueness and cashier-session uniqueness. This is a single embedded connection, NOT a multi-connection PostgreSQL concurrency/load test. Live payment/carrier credentials and a production database were not used; nothing was deployed.

This is a review/staging API release, not certification that every legacy Module 2–26 route is production-ready. Remaining operational verification includes production data reconciliation, staging migration replay against a copy of the real DB, multi-client final-item races, live Razorpay/carrier contract verification, receipt branding/tax presentation approval and the later admin/website/POS UI integrations. Shadowfax pickup requests, queued callbacks/tracking synchronization and high-value document fields are now implemented; see SHADOWFAX-OPERATIONS.md. Direct POS gateway/terminal capture remains outside this API scope.
