# Namama API — Modules 6–8

## 6. Customer Accounts
Existing email registration/login/verification/password reset remains supported.

New authentication:
- `POST /api/auth/otp/request` — email OTP request
- `POST /api/auth/otp/verify` — OTP login/registration
- `POST /api/auth/social` — Google or Facebook access-token login

Account:
- `GET/PATCH /api/account/profile`
- `GET/POST /api/account/addresses`
- `PATCH/DELETE /api/account/addresses/:id`
- `GET /api/account/orders`
- `POST /api/account/recently-viewed/:productId`
- `GET/DELETE /api/account/recently-viewed`
- `DELETE /api/account/account` — privacy-safe soft deletion/anonymisation
- Existing `/api/wishlist` remains the wishlist API.

Social login expects `{ provider: "google"|"facebook", accessToken }`. Provider tokens are verified against the provider profile endpoint. Configure provider apps on the frontend/provider side.

## 7. Shopping Cart
`/api/cart-v2` supports both authenticated customers and guests. Guests receive `cartToken`; send it as `x-cart-token` on subsequent calls.

- `GET /api/cart-v2`
- `POST /api/cart-v2/items` `{variantId, quantity}`
- `PATCH /api/cart-v2/items/:variantId` `{quantity}`; quantity 0 removes
- `DELETE /api/cart-v2/items/:variantId`
- `DELETE /api/cart-v2`
- `POST /api/cart-v2/coupon` `{code}`
- `GET /api/cart-v2/shipping-estimate?postalCode=...&country=IN`
- `GET /api/cart-v2/cross-sell`
- `POST /api/cart-v2/merge` `{cartToken}` after login

Cart validation respects variant inventory, backorders and preorders. Guest carts are persisted in PostgreSQL. `AbandonedCart` is included as the durable recovery/reminder record for the marketing worker/module.

## 8. Checkout
Existing `/api/checkout` remains the order-creating checkout for guest/account purchases and now accepts `orderNotes`, `giftMessage`, `billingAddress`, `deliveryOption`, and `expressCheckout` in addition to shipping details, coupon and payment method.

New checkout helpers:
- `POST /api/checkout-v2/validate-address`
- `POST /api/checkout-v2/delivery-options`
- `POST /api/checkout-v2/prepare` — validates guest/account cart, inventory, addresses and returns a checkout-ready summary.

`prepare` accepts shipping/billing addresses, delivery option, order notes, gift message, coupon, COD/Prepaid and express-checkout flag. Existing Razorpay/COD checkout remains intact.

## Database migration
After setting a valid `DATABASE_URL` and `JWT_SECRET`:

```bash
npm install
npx prisma migrate dev --name modules_6_8
npx prisma generate
npm run build
```

Use `prisma migrate deploy` instead of `migrate dev` in production after creating/reviewing the migration in staging.
