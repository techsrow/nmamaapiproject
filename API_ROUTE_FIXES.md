# Namama API route compatibility fixes

This build keeps all existing API URLs and adds compatibility URLs used by the current Admin UI.

Added prefix aliases:
- /api/catalog-v2 -> catalogManagementRoutes
- /api/search-v2 -> searchV2Routes
- /api/commerce-v2 -> commerce913Routes
- /api/content-v2 -> commerce1417Routes
- /api/platform-v2 -> commerce1820Routes + commerce2125Routes + mobileAccessibilityRoutes

Added REST aliases/list endpoints needed by Admin:
- catalog-v2/brands CRUD (POST/PATCH/DELETE now work without /admin)
- catalog-v2/collections CRUD (POST/PATCH/DELETE now work without /admin)
- search-v2/results alias for search products
- commerce-v2/payments
- commerce-v2/refunds
- commerce-v2/shipping/methods
- commerce-v2/returns
- commerce-v2/return-policies
- commerce-v2/gift-cards
- platform-v2/admin/approvals
- platform-v2/admin/notifications
- platform-v2/security/fraud/checks
- platform-v2/international/currencies
- platform-v2/international/locales
- platform-v2/international/markets

Existing canonical URLs remain available, so storefront/API integrations are not broken.

After replacing source on your machine/server:
1. npm install
2. npx prisma generate
3. npm run build
4. restart the API

Note: build verification inside the packaging environment could not complete because node_modules were not included in the uploaded ZIP. The errors were dependency-resolution errors (missing installed packages/types), not a runtime test of the API routes.
