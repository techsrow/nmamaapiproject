# Live verification handoff

Observed in this workspace: database authentication probes could not run because the configured PostgreSQL server could not be reached. No live payment, capture, refund, shipment booking or pickup was created. Local test results are not live verification.

After staging migration/build, run on the API server:

```bash
npm run verify:integrations
```

This command is read-only: it checks database access, Razorpay account authentication via an order list request, and Shadowfax authentication via serviceability. It prints PASS/BLOCKED and provider mode without credential values. Do not share .env or API secrets in chat. Share the sanitized output. PASS proves authentication only.

Before an end-to-end run, provide the staging/storefront URL and an authorized test order/cart using a merchant-controlled shipping address and phone. Use TEST mode first. Complete Razorpay's checkout interaction in the browser, then verify order/payment amounts, server signature validation, duplicate callback behavior, stock allocation and receipt. Revisit the same order and confirm no duplicate charge/order is created. Use actual server logs and persisted state for evidence.

For Shadowfax, book that agreed test order in TEST mode with the account's pickup slot and pickup details. Verify AWB recovery, label, tracking sync, pickup-window update, cancellation acceptance followed by confirmed state, callback registration and background reconciliation. Exercise an NDR/re-delivery and RTO event using carrier staging support where available. Physical returns require stock inspection before restocking.

A live-mode end-to-end test requires a specific agreed low-value order, authorized payer and pickup details. A real charge/refund or carrier pickup is not performed by the read-only command. Do not use a real customer's order as a test. Confirm the exact transaction/shipment with the operator before performing it. Record order/AWB identifiers and timestamps, keeping credentials and customer data private.
