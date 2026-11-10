# API endpoints

## Authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

Required headers:
- `Authorization: Bearer <token>`

## Businesses and stores

Registration and business creation accept optional `country_code` and `currency`; defaults remain `TZ` and `TZS`.

- `GET /api/v1/businesses/access`
  - Returns each active business membership, its permissions and only the stores assigned to that user (owners receive all active stores).
- `GET /api/v1/businesses`
- `POST /api/v1/businesses`
- `GET /api/v1/businesses/{business_id}/stores`
- `POST /api/v1/businesses/{business_id}/stores`

Required headers:
- `Authorization: Bearer <token>`
- `X-Business-ID: <business_uuid>` for business-scoped calls

## Catalog

- `POST /api/v1/catalog/categories`
- `GET /api/v1/catalog/categories`
- `POST /api/v1/catalog/brands`
- `GET /api/v1/catalog/brands`
- `POST /api/v1/catalog/units`
- `GET /api/v1/catalog/units`
- `POST /api/v1/catalog/products`
- `GET /api/v1/catalog/products`
- `POST /api/v1/catalog/products/{product_id}/variants`
- `GET /api/v1/catalog/products/{product_id}/variants`
- `GET /api/v1/catalog/barcodes/{barcode}`

## Inventory and purchasing

- `POST /api/v1/inventory/suppliers`
- `GET /api/v1/inventory/suppliers`
- `POST /api/v1/inventory/purchases`
- `POST /api/v1/inventory/purchases/{purchase_id}/receive`
- `GET /api/v1/inventory/stock?store_id=<uuid>`
- `GET /api/v1/inventory/movements?store_id=<uuid>`

## Customers and debtors

Implemented as part of Priority 2.

- `POST /api/v1/customers`
- `GET /api/v1/customers`
- `GET /api/v1/customers/{customer_id}`
- `PATCH /api/v1/customers/{customer_id}`
- `POST /api/v1/customers/{customer_id}/payments`
- `POST /api/v1/customers/{customer_id}/adjustments`
- `GET /api/v1/customers/{customer_id}/history`
- `GET /api/v1/customers/{customer_id}/statement`
- `POST /api/v1/customers/{customer_id}/payments/{entry_id}/reverse`

These endpoints create and maintain customer debtor accounts, payment history, outstanding balances, and reversal/audit records within the active business.

## Suppliers and creditors

Implemented as part of Priority 3.

- `POST /api/v1/inventory/suppliers`
- `GET /api/v1/inventory/suppliers`
- `POST /api/v1/inventory/suppliers/{supplier_id}/payments`
- `GET /api/v1/inventory/suppliers/{supplier_id}/statement`
- `POST /api/v1/inventory/suppliers/{supplier_id}/payments/{payment_id}/reverse`

These supports supplier payment records, payable balances, payment history, and creditor resets against purchase totals.

## POS and sales

Implemented as part of Priority 1.

- `POST /api/v1/sales`
  - Creates a sale with multiple items and one or more payment entries.
  - Validates business/store access, product availability, and transactional stock updates.
- `GET /api/v1/sales`
  - Lists sales for the active business and optionally filtered by store/status.
- `GET /api/v1/sales/{sale_id}`
  - Fetches a single sale with nested items and payment records.
- `POST /api/v1/sales/{sale_id}/payments`
  - Appends a payment to an existing sale and recalculates balances.
- `POST /api/v1/sales/{sale_id}/refund`
  - Processes an itemized or total refund with stock restoration and refund ledger entries.
- `GET /api/v1/sales/{sale_id}/receipt`
  - Returns receipt data for the sale.

Common requirements for business-scoped sales flows:
- `Authorization: Bearer <token>`
- `X-Business-ID: <business_uuid>`
- `X-Store-ID: <store_uuid>` when the endpoint is store-bound

## Orders and invoices

Implemented as part of Priority 5.

- `POST /api/v1/orders`
  - Creates a draft customer order with multiple lines and optional customer details.
- `GET /api/v1/orders`
  - Lists order records for the current business and optional store filter.
- `GET /api/v1/orders/{order_id}`
  - Fetches a single order with the nested item list and status metadata.
- `POST /api/v1/orders/{order_id}/confirm`
  - Moves a draft order into the confirmed state.
- `POST /api/v1/orders/{order_id}/prepare`
  - Marks the order as being prepared for fulfillment.
- `POST /api/v1/orders/{order_id}/complete`
  - Marks the order as fulfilled.
- `POST /api/v1/orders/{order_id}/cancel`
  - Cancels the order when it is no longer valid.
- `POST /api/v1/orders/{order_id}/convert-to-sale`
  - Converts a fulfilled order into a real sale record using the existing POS sale flow.
- `GET /api/v1/orders/{order_id}/invoice`
  - Generates a PDF order invoice and returns it as a downloadable file.

## Employees and multi-store access

Implemented as part of Priority 7.

- `GET /api/v1/employees`
- `GET /api/v1/employees/{employee_id}`
- `POST /api/v1/employees/invite`
- `PATCH /api/v1/employees/{employee_id}`

These endpoints allow business owners and managers to invite employees, assign store access, scope permissions, and enforce business/store isolation in the membership layer.

## Offline synchronization

Implemented as part of Priority 8.

- `POST /api/v1/sync/devices`
- `GET /api/v1/sync/status`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull`
- `POST /api/v1/sync/acknowledge`

These endpoints register client devices, deduplicate operation retries via client IDs, synchronize real sales operations back to the business, and track operation status for pull-based reconciliation.

## Notes

- The backend uses SQLite by default for local development.
- Database creation is handled through SQLAlchemy `create_all` at startup.
- Financial and stock-affecting workflows are performed in a transaction to avoid partial writes.

## Subscriptions and Super Admin

Authenticated business users:

- `GET /api/v1/subscriptions/plans`
- `POST /api/v1/subscriptions/request`
- `GET /api/v1/subscriptions/current`
- `GET /api/v1/subscriptions/history`
- `GET /api/v1/subscriptions/entitlements`

`POST /subscriptions/request` activates a zero-price plan directly and leaves paid plans pending. Since Vodacom Tanzania payment confirmation is not implemented, only an audited Super Admin grant can currently activate a paid plan. Plan currency must match the business currency. Feature keys are configured on the plan and returned as effective entitlements; no prices or feature limits are seeded by the application.

The configured Super Admin must first register with the email in `SUPER_ADMIN_EMAIL`, then bootstrap with their authenticated account and `X-Super-Admin-Bootstrap-Secret`. Registration by itself never grants platform-admin privileges.

For local setup, put the chosen account email and a fresh random secret in `backend/.env`, then restart the API:

```sh
cd backend
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Copy the generated value into `SUPER_ADMIN_BOOTSTRAP_SECRET` and set `SUPER_ADMIN_EMAIL` to the exact registered email. Log in as that account to obtain an access token, then run:

```sh
curl -X POST http://localhost:8000/api/v1/subscriptions/admin/bootstrap \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "X-Super-Admin-Bootstrap-Secret: <SUPER_ADMIN_BOOTSTRAP_SECRET>"
```

The secret is a bootstrap credential; keep it private and do not commit it. The web session must sign in again after bootstrap so its Super Admin menu refreshes.

Super Admin endpoints:

- `POST /api/v1/subscriptions/admin/bootstrap`
- `POST /api/v1/subscriptions/admin/plans`
- `PATCH /api/v1/subscriptions/admin/plans/{plan_id}`
- `GET /api/v1/subscriptions/admin/businesses`
- `PATCH /api/v1/subscriptions/admin/businesses/{business_id}/status`
- `GET /api/v1/subscriptions/admin/users`
- `PATCH /api/v1/subscriptions/admin/users/{user_id}/status`
- `GET /api/v1/subscriptions/admin/businesses/{business_id}/stores`
- `POST /api/v1/subscriptions/admin/businesses/{business_id}/stores`
- `PATCH /api/v1/subscriptions/admin/stores/{store_id}/status`
- `POST /api/v1/subscriptions/admin/businesses/{business_id}/grant`
- `GET /api/v1/subscriptions/admin/analytics`
- `GET /api/v1/subscriptions/admin/audit-logs`

Administrative subscription grants are explicitly audited and are not represented as received payments. Platform revenue is `null` until verified Vodacom payments can be recorded.

## Mobile Money — Vodacom Tanzania

No mobile-money payment endpoints are enabled. The project targets Vodacom Tanzania (TZS); the Safaricom Daraja/KES protocol is not compatible and was intentionally not substituted.

Sales, customer collection, and supplier payment requests using `mobile_money` are rejected with `409` until provider verification exists. The existing `M_PESA_*` environment settings are configuration placeholders only. Do not treat callbacks, client-submitted references, or these settings as payment confirmation. Implementation is blocked until the official Vodacom Tanzania merchant API contract is available, including authentication, payment initiation, callback verification, and transaction-status query semantics.
