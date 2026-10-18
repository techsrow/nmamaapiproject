> Superseded deployment steps: read DEPLOY-API.md and API-INVENTORY-POS.md first. This release also adds the inventory/POS migration and stock trigger.

# Shipping rules, provider choices and Shadowfax 360

Customer shipping charges come from the first eligible active FLAT ShippingRule, sorted by priority then ID. Order subtotal before coupon is the basis. All enabled provider configurations become merchant-offered checkout choices at that same rule price. Selecting a provider never adds its carrier quote on top. The first choice is selected automatically; customers can switch. Disabled providers are omitted.

If all providers are disabled, the rule itself remains available as the default delivery option (internal provider Local). No pickup location, dimensions or carrier API is needed for rule pricing. Product weight validation still applies.

NEW DEFAULT POLICY: If no rule matches the order-value range, retry active rules in priority order while ignoring ONLY minOrderValue/maxOrderValue. PIN, zone, weight, COD and valid-price restrictions still apply. Thus the first otherwise eligible rule becomes the automatic fallback. This is an intentional change from the earlier ZIP, which used a carrier quote for gaps in order ranges. No database rule values are changed.

With the supplied rules and no COD fee:

| Subtotal | Shipping |
| --- | --- |
| 1,000 or 1,600 | Standard Delivery fallback: 120 |
| 2,000 to 4,999.99 | Standard Delivery: 120 |
| 5,000 | Standard rule freeAbove reached: 0 |
| 5,000.01 to 10,000 | Free Shipping rule: 0 |
| Above 10,000 | Standard fallback, freeAbove reached: 0 |

These amounts apply identically to enabled Local Delivery, India Post, Delhivery, Shiprocket, Shadowfax 360 or other configured providers. Such options are merchant offers, not confirmation of courier serviceability. Admin is responsible for fulfillment coverage and should restrict rules by destination where necessary. Unsupported booking adapters are not made functional by enabling a provider. Only when no eligible rule exists does the previous enabled-carrier rate fallback run; no rule and no working carrier still blocks checkout, rather than inventing a price.

Inclusive product tax remains included; exclusive product tax is added once. Total = subtotal - discount + one selected shipping charge + additional exclusive tax. Existing orders retain their saved totals. Cancel an unpaid attempt through checkout, then review again; do not recreate a paid order.

## Shadowfax 360 scope

Provider enum/code: Shadowfax360. Display name: Shadowfax 360. Admin catalog now includes it. Credentials use token, encrypted through the existing provider configuration service. TEST uses https://dale.staging.shadowfax.in/api; LIVE uses https://dale.shadowfax.in/api. Authentication is Authorization: Token <token>.

Implemented: rule-priced checkout choice, provider configuration, real read-only authentication test against serviceability, and tracking existing AWBs. No live requests were run during development.

NOT implemented: automatic booking, cancellation, label download, pickup scheduling, or webhook synchronization. Book in the SFX 360 portal, then submit the actual AWB via the existing admin POST /api/shipping/shipments endpoint with provider Shadowfax360, orderId, pickupLocationId and awb. There is no generated fake Shadowfax AWB. The existing paid/COD and unfulfilled-item guards apply. /shipments/:id/track retrieves remote tracking without automatically changing order status. Manage operational actions in SFX 360. Do not retry a shipment registration after an ambiguous response without checking existing shipments first.

Official references:
- https://developer.shadowfax.in/docs/forward-logistics/quickstart
- https://developer.shadowfax.in/docs/api/forward-logistics

## Admin and website

Latest supplied storefront already renders API shippingOptions and selectedShipping; no website edit is needed for these options.

Admin source has not been supplied for this update. If it loads GET /api/shipping/providers/catalog dynamically, Shadowfax will be returned after deployment. If cards/types are hardcoded, add Shadowfax360 to that list and use the existing token credential field. Configuration endpoints remain GET/PUT /api/shipping/providers and /providers/:provider (existing auth required); enable/disable through the existing provider UI. Add an AWB field to external shipment registration. Send the current admin source ZIP for an actual admin UI patch; API support alone cannot change a hardcoded UI.

## Deployment — schema change in this version

Back up the database and existing project. Merge src, schema.prisma and ONLY the new prisma/migrations/20261015120000_shadowfax360 folder into the deployed project, retaining its existing migration history, .env, root package files and uploads. Use its installed Prisma 6 dependencies.

```bash
npx prisma validate
npx prisma migrate status
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 list
# Replace YOUR_API_PROCESS_NAME with the actual process from pm2 list:
pm2 restart YOUR_API_PROCESS_NAME --update-env
pm2 save
pm2 logs YOUR_API_PROCESS_NAME --lines 50
```

Stop if any command fails. migrate deploy applies all pending migrations: review migrate status first; do not deploy unexpected old migrations or reset the production database. New SQL only adds the Shadowfax360 enum value, without deleting data. Unlike the previous ZIP, this version DOES require that migration before using the new provider.

Validation: TypeScript build; 15 mocked shipping-rule checks, 60 checkout/tax/token checks, 41 payment integration checks, 6 Shadowfax checks. No production deployment or live carrier/payment test performed.
