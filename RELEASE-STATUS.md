# Current status

NOT production-ready. Read ../SHIPPING-TASKS.md for the authoritative 26-area checklist and current verification results. Earlier status notes below are historical and do not certify this checkpoint.

# Namama API release — 16 October 2026

This ZIP contains the updated API source, Prisma migrations, tests and deployment instructions. It is not a certification that the entire inherited API is production-complete. No production server, live database, Razorpay account or carrier account was exercised or deployed.

Implemented: shipping-rule pricing and fallback with enabled provider listing; guest payment/checkout protections; stock ledger and warehouse allocation; purchase receiving and transfers; reconciliation; unique barcode generation/lookup and printable labels; POS cashier permissions, sessions, drafts, sales, receipts, returns, credit notes and idempotency. The main admin is integrated in the sibling admin directory. The separate POS interface and storefront remain later projects.

Validation: TypeScript build and Prisma schema validation pass. 203 mocked regression checks cover shipping, checkout, payment, Shadowfax and POS. 18 embedded PostgreSQL checks execute the migration/stock trigger. These do not replace multi-client PostgreSQL concurrency tests or staging migration rehearsal with real data.

Read DEPLOY-API.md before applying changes. Back up and reconcile inventory first. Preserve historical migrations and environment secrets. Do not reset the database. Read API-INVENTORY-POS.md for client contracts and SHADOWFAX-OPERATIONS.md for carrier limitations.

Outstanding production gates: review live-data reconciliation; rehearse migrations on a staging copy; test simultaneous last-item sales and payment callbacks with independent database clients; verify live gateway/carrier flows; review receipt/tax configuration with the merchant; exercise the deployed admin and integrate the storefront; verify the newly implemented Shadowfax lifecycle against the merchant account. The old API's unrelated modules have not received a comprehensive production/security audit.

This update adds pickup windows, high-value document submission, authenticated callback queuing, tracking reconciliation, cancellation fulfillment release and physical-return review flags. Live verification remains blocked by database reachability from this workspace. See LIVE-VERIFICATION.md. Partial shipments and automatic physical-return restocking are not implemented.

Combined release update: admin return-policy and fraud routes are merged into the API and included in npm test. Account authentication now validates HS256 JWT subjects and reads the current account role/status on every authenticated request; disabled/deleted accounts are refused and database failure returns 503. Optional authentication rejects supplied invalid tokens rather than silently proceeding as a guest. Eleven HTTP regression checks cover this behavior. This does not add password-reset token revocation or change JWT expiry policy.

Navigation manager is included in API and main admin: menus, page/custom links, drag ordering/nesting, display positions, publication filtering, safe URLs, stale-edit checks and transactional assignment moves. Apply the new navigation migration. Storefront header/footer integration remains pending its source ZIP. See NAVIGATION-MANAGER.md.
