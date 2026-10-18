# Current shipping checkpoint — staging only

Read ../SHIPPING-TASKS.md. This is not production-certified. New migration `20261018100000_shipping_operations` is required for ShippingJob and ShippingAudit. Preserve all existing migration history; review every pending migration. Run the commands below in the API folder. Keep automatic booking and emails disabled until account tests pass.

# Deploy the API update

Do not deploy this as a blind source overwrite. This release changes the database stock-write behavior and adds POS tables. Use a staging copy of the live database first. Keep your actual .env, uploads and existing migration history. No reset or migrate dev command is needed on production.

1. Back up the existing application and database. Put checkout/stock writes into maintenance while applying the production migration; old inventory code must not run against the new stock trigger.
2. Merge this src, scripts, tests, package.json, package-lock.json, tsconfig.json and prisma/schema.prisma. Dependencies remain the uploaded Prisma 6 / Express 5 versions; no production runtime package was added. Preserve your deployed historical migration folders and add ONLY these new folders if absent:
   - 20261015120000_shadowfax360
   - 20261015140000_inventory_pos
   - 20261016110000_navigation_locations
   - 20261016120000_customer_token_version
   - 20261018100000_shipping_operations
3. In the API project folder, run commands individually and stop on any failure:
```bash
npm ci
npx prisma validate
npx prisma generate
npm run preflight:inventory
npx prisma migrate status
```
Preflight is read-only. It reports duplicate barcodes, negative balances, warehouse mismatches and legacy reservations. Resolve these with reviewed inventory values before deployment. Do not silently delete duplicate barcodes or overwrite physical/reserved stock. Existing rows with no allocation can be adopted automatically, but store POS requires an actual shop allocation.

4. Review all pending migrations. migrate deploy applies ALL pending migrations, so stop if unexpected historical migrations appear. Then:
```bash
npx prisma migrate deploy
npm run build
npm test
pm2 list
```
5. Restart the actual API process shown by pm2 list (the name is not known here):
```bash
pm2 restart YOUR_API_PROCESS_NAME --update-env
pm2 save
pm2 logs YOUR_API_PROCESS_NAME --lines 50
```
Do not type the placeholder process name literally. Verify health, catalog, guest quote, payment methods, signed order tracking and admin inventory before reopening checkout. This workspace has not connected to or deployed your server.

6. Enable POS only after warehouse allocation review and the separate POS interface exists. Add its exact HTTPS subdomain to the existing configured CORS origins. Do not expose staff JWTs or carrier tokens to public settings.

## Stock migration rollback

The old inventory module recalculates variant totals from warehouse sums. It is incompatible with the new database trigger. Do not roll back source alone while leaving the new trigger active. Use the backed-up application/database snapshot or a separately reviewed migration rollback. Do not use prisma migrate reset on production.

## Reproduce isolated SQL checks

The package includes a schema-only pre-update fixture (no customer data) for the embedded test. Install its dependency outside the production project:
```bash
npm install --prefix /tmp/namama-db-tests --no-audit --no-fund @electric-sql/pglite@0.5.10
PGLITE_MODULE=/tmp/namama-db-tests/node_modules/@electric-sql/pglite node tests/inventory-postgres.cjs
```
PGlite is a test-only embedded PostgreSQL runtime. Use real PostgreSQL with independent client connections for staging concurrency tests.

## Carrier lifecycle update

The older carrier lifecycle used existing tables. The current shipping workflow additionally requires migration 20261018100000_shipping_operations. Configure SHADOWFAX_WEBHOOK_SECRET, register its callback fields/header and keep the reconciliation jobs running. Run `npm run verify:integrations` on the API server after deployment to staging. Read LIVE-VERIFICATION.md for the end-to-end gate. Shiprocket callbacks now require SHIPPING_WEBHOOK_SECRET rather than accepting unauthenticated events when unset.

## Navigation manager update

Apply 20261016110000_navigation_locations, regenerate Prisma and deploy the API before the admin. Read NAVIGATION-MANAGER.md for item contracts and display positions. Existing menus need explicit position assignments; the main website still needs its header/footer integration.
