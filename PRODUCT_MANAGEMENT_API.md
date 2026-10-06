# Product Management API — Complete Module

Base: `/api/admin/product-management` (Admin JWT required)

## Included
- Simple products: exactly one sellable variant/SKU.
- Variable products: up to 3 Shopify-style options (e.g. Color, Size, Material) and arbitrary option values.
- Unique SKU per variant, barcode, price, compare-at price, sale/discount price, cost price.
- Variant stock, inventory tracking, backorder and preorder flags.
- Product images + videos through `media`; variant-specific images through `variants[].images`.
- Category, subcategory, brand and tags assignment.
- Specifications, size guide and manually ordered related products.
- SEO/editor fields retained from the existing API.
- Product list/detail/create/full-update/archive/status APIs.
- XLSX template, import and export.
- Existing `/api/products` endpoints remain for backward compatibility.

## Endpoints
- `GET /` paginated admin products (`q`, `page`, `limit`)
- `GET /:id` complete product editor payload
- `POST /` create complete simple/variable product
- `PUT /:id` replace/update complete product configuration
- `PATCH /:id/status` publish/unpublish
- `DELETE /:id` archive product
- `GET /bulk/template/xlsx` import template
- `POST /bulk/import/xlsx` multipart field `file`
- `GET /bulk/export/xlsx` export products/variants

## Variable product example
```json
{
  "name": "Berry Dress",
  "productType": "variable",
  "options": [
    {"name":"Color","position":0,"values":["Pink","White"]},
    {"name":"Size","position":1,"values":["2-3 Years","3-4 Years"]}
  ],
  "variants": [
    {"sku":"BERRY-PINK-23","optionValues":{"Color":"Pink","Size":"2-3 Years"},"price":1999,"compareAtPrice":2499,"stockQuantity":10,"images":[]},
    {"sku":"BERRY-PINK-34","optionValues":{"Color":"Pink","Size":"3-4 Years"},"price":1999,"compareAtPrice":2499,"stockQuantity":8,"images":[]}
  ],
  "media": [{"type":"IMAGE","url":"https://cdn.example.com/berry.jpg","isMain":true}],
  "specifications": [{"name":"Fabric","value":"Soft tulle","position":0}],
  "sizeGuide": {"title":"Kids Dress Size Guide","content":{"2-3 Years":{"chest":"22 in","length":"24 in"}}},
  "relatedProductIds": []
}
```

Run `npx prisma migrate deploy` (production) or `npx prisma migrate dev` (development), then `npx prisma generate` after installing dependencies.
