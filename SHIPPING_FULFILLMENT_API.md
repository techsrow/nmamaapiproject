# Namama Shipping Fulfillment API

Admin endpoints are under `/api/shipping` and require Admin JWT.

## Fulfillment workflow
- `GET /dashboard` — shipment counts, ready-to-ship count, in-transit and exception totals.
- `GET /fulfillment/orders?readyOnly=true&q=&limit=50&offset=0` — orders that can be fulfilled. Returns customer/address, payment/COD state, items, allocated and remaining quantities, and estimated package weight.
- `GET /fulfillment/orders/:orderId` — full fulfillment detail for one order.
- `POST /fulfillment/orders/:orderId/rates` — courier serviceability/rates using the order delivery pincode and selected/default pickup location. Body can contain `pickupLocationId`, `weightKg`, `lengthCm`, `widthCm`, `heightCm`.
- `POST /fulfillment/orders/:orderId/create` — creates a full or partial shipment. Body: `provider`, optional `courierCode`, `courierName`, `pickupLocationId`, package dimensions and optional `items: [{orderItemId, quantity}]`.

The server reads customer, address, item, price and COD data from the order. It rejects over-fulfillment and cancelled/returned/unpaid non-COD orders.

## Existing shipment actions
- `GET /shipments`
- `GET /shipments/:id`
- `POST /shipments/:id/pickup`
- `POST /shipments/:id/label`
- `POST /shipments/:id/track`
- `POST /shipments/:id/cancel`
- `POST /shipments/:id/manual-status`
- `POST /shipments/:id/ndr`

Cancellation releases the shipment's fulfilled quantities so they can be fulfilled again. Shiprocket remains the executable aggregator adapter; Local/Custom/Manual are executable offline adapters. Direct carrier records remain configuration-only until merchant carrier contracts/API credentials are available.
