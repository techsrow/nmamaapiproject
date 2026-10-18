# Shadowfax 360 operations

Customer shipping charges remain controlled by ShippingRule. Carrier updates never add another shipping fee. Enabled provider listing does not itself prove destination serviceability.

## Booking and documents

Use the existing POST /api/shipping/fulfillment/orders/:orderId/create with provider Shadowfax360. Start with TEST credentials. Configure publicConfig.enableBooking=true and publicConfig.productCategory for your actual goods. This adapter uses Regular service. Full unfulfilled orders are supported; omit items. Partial shipment booking is not supported.

Optional request fields: weightKg, pickupDate (YYYY-MM-DD), pickupSlot (your account slot key), ewayBill (12 digits), sellerGstin (GSTIN). Supply pickupDate/pickupSlot together. Values of INR 50,000 and above require both document fields. The API validates their format, not their legal validity, and does not generate an e-way bill. SKU price is the unit price; additional_details.quantity carries quantity.

Booking saves a durable intent and client_order_id before the carrier request. An uncertain result remains blocked to prevent duplicate bookings. POST /api/shipping/shadowfax/orders/:orderId/recover with {"awb":"ACTUAL_AWB"} verifies the carrier order against that intent. Keep the original account credentials/mode until existing shipments are resolved. Definite rejection and unresolved booking with no AWB still require operator/carrier investigation; there is no unsafe generic intent-delete action.

## Pickup, tracking and cancellation

POST /api/shipping/shipments/:id/pickup with pickupDate/pickupSlot requests a carrier window using the order-update contract. Acceptance is not rider assignment. Tracking later confirms the actual status.

POST /api/shipping/shipments/:id/track now retrieves and applies authenticated tracking. It stores deduplicated events, rejects mismatched AWB/client IDs, ignores older snapshots/events, and protects terminal states. Pickup, transit, delivery, holds/NDR and return states are mapped. Unknown states remain recorded without inventing a status transition.

POST /api/shipping/shipments/:id/cancel submits cancellation only after retrieving current tracking. An accepted request does not mean completed cancellation. Polling confirms it. Cancellation before collection releases fulfilled quantities exactly once while keeping the order's stock reservation. The merchant may rebook; the prior booking intent is archived. Cancellation after collection or a completed carrier return flags needsPhysicalReturnReview; it does not automatically restock, refund or certify returned goods as sellable. Use the inventory/return process after physical inspection. COD delivery does not automatically mark funds settled.

Existing label and tracking endpoints remain available. Disabling new carrier bookings does not stop reconciliation of existing shipments, provided the original config/account is retained.

## Callbacks and reconciliation job

Register HTTPS POST /api/shipping/webhooks/shadowfax with your Shadowfax account manager. Configure JSON fields awb_number and client_order_id and a shared x-api-key header equal to SHADOWFAX_WEBHOOK_SECRET (at least 32 characters). The handler fails closed if missing/unconfigured, validates shipment identity, saves a durable reconciliation request and returns 200. It does not trust callback status, COD amounts or recipient data as proof.

The minute job processes callback requests; every five minutes it polls up to 100 outstanding shipments ordered by last update. Failed requests remain retryable. Tracking changes are protected by database locks, including overlapping worker instances. Set DISABLE_JOBS=true only when another API worker runs these jobs. Monitor backlog and carrier limits for larger volumes. Callback field/header configuration must be agreed with the account manager; the carrier has no universal callback signature contract in the documentation consulted.

Source contracts: https://developer.shadowfax.in/docs/api/forward-logistics/~schemas ; https://developer.shadowfax.in/docs/api/forward-logistics/orders ; https://developer.shadowfax.in/docs/api/forward-logistics/tracking ; https://developer.shadowfax.in/docs/forward-logistics/callbacks . Merchant account acceptance has not been live verified here.
