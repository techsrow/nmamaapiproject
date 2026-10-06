# Namama API — Modules 3, 4 and 5

## 3. Categories & Collections
Existing `/api/categories`, `/api/subcategories`, `/api/tags` remain backward compatible.

New `/api/catalog` endpoints:
- `GET /brands`, `GET /brands/:slug`
- Admin: `POST/PATCH/DELETE /admin/brands`
- `GET /collections`, `GET /collections/:slug`
- Admin: `POST/PATCH/DELETE /admin/collections`
- `PUT /admin/collections/:id/products` for manual collections
- `POST /admin/collections/:id/preview` for rule-based collections
- `GET /featured-products`
- `PATCH /admin/products/:id/featured`

Automatic collection rules support categoryId, subCategoryId, brandId, tagId, featured, name, price, size and color. `match` can be `ALL` or `ANY`. Seasonal collections use `startsAt`/`endsAt`.

Example automatic rules:
```json
{"match":"ALL","rules":[{"field":"categoryId","operator":"equals","value":2},{"field":"price","operator":"lte","value":2500}]}
```

## 4. Search & Filtering
New `/api/search` endpoints:
- `GET /products?q=&category=&subcategory=&brand=&tag=&size=&color=&minPrice=&maxPrice=&inStock=1&sort=&page=&limit=`
- `GET /autocomplete?q=`
- `GET /suggestions?q=`
- `GET /filters`
- Auth: `POST /recent`, `GET /recent`, `DELETE /recent`

Sorting: `newest`, `oldest`, `name_asc`, `name_desc`, `price_asc`, `price_desc`.

## 5. Inventory
New `/api/inventory-v2` admin endpoints:
- `GET /stock`, `GET /low-stock`
- `PATCH /variants/:id/settings` — thresholds, tracking, backorder/preorder
- `POST /adjust`, `GET /movements`
- Warehouses: list/create/update and warehouse stock
- Stock transfers: create/list/status; completion moves stock atomically
- Suppliers: CRUD
- Purchase orders: create/list/status/receive; receiving updates warehouse and variant stock atomically

Stock status returned as `IN_STOCK`, `LOW_STOCK`, `OUT_OF_STOCK`, `BACKORDER`, or `PREORDER`.

## Migration
Run:
`npx prisma migrate deploy`
`npx prisma generate`
`npm run build`
