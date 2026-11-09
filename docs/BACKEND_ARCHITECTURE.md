# Backend architecture

## Layer layout

The backend is organized by business domain under `backend/app/modules/`:

- `auth/` — user registration, login, refresh, JWT issuance and session management.
- `businesses/` — business and store records plus membership and access rules.
- `catalog/` — categories, units, brands, products and product variants.
- `customers/` — customer debtor accounts, payments, statements and ledger reversals.
- `finance/` — cashbook entries, summaries, balance calculations and safe reversals.
- `inventory/` — suppliers, stock balances, movement ledger and purchase receiving.
- `orders/` — customer orders, lifecycle states, invoice PDF generation, and conversion into sales.
- `reports/` — dashboard, analytics, export and summary endpoints.
- `sales/` — point-of-sale sales, payments, receipts and refunds.
- `employees/` — employee invitations, role assignment and per-store permission scoping.
- `sync/` — device registration, idempotent offline-push processing, status checks and pull acknowledgements.
- `subscriptions/` — configurable plans, business subscription history, entitlements, bootstrap and audited Super Admin operations.

The application bootstrap lives in `backend/app/main.py`, while shared database and auth utilities live in `backend/app/core/`.

## Authentication and tenancy model

- Users authenticate with a JWT bearer token.
- Each request is validated against the active business via `X-Business-ID`.
- Membership records enforce business ownership and per-store access.
- Roles are checked using the dependency layer in `app/core/dependencies.py`.
- `GET /api/v1/businesses/access` returns only active businesses with active memberships, and limits non-owner store lists to the membership's assigned stores. The mobile client uses it after authentication to present workspace choices.

## Data flow for POS sales

1. A user authenticates and includes their business context header.
2. The route checks the selected store belongs to the same business and is accessible to the user.
3. Product variants are loaded and validated against the active business.
4. Stock availability is checked before sale finalization.
5. The sale is written in a transactional step with item lines and payment entries.
6. Inventory balances and stock movements are updated in the same transaction.
7. The response includes the sale payload, receipt data, and ledger state.

## Order and invoice lifecycle

1. A user creates an order with one or more product lines and the relevant business/store headers.
2. The route validates product variants, calculates item totals, and persists an order with a draft lifecycle status.
3. The order can be confirmed, prepared, fulfilled, or cancelled according to business workflow rules.
4. Once fulfilled, the order may be converted into an actual POS sale, reusing the validated sale flow and inventory checks.
5. Invoice generation produces a real PDF and stores the invoice metadata for the linked order.

## Financial correctness rules

- Sale totals are calculated from live selling prices.
- Payments cannot exceed the recorded sale total.
- Partial payments are permitted and reflected in `balance_due`.
- Refund workflows restore stock and record a refund ledger entry.
- Order-to-sale conversion uses the same sale validation path so that inventory and ledger rules stay consistent.
- Financial writes are not silently overwritten; each operation updates the sale payment state.

## Employee and sync model

- `Membership` records store the active business, the allowed stores, and a permission list for each employee.
- `require_roles` and `get_business_membership` prevent unauthorized cross-business access even when a token is valid.
- Offline sync introduces a `sync_devices` table and a durable `sync_operations` log keyed by business + client idempotency key.
- Duplicate push retries are safe because the backend reuses the prior operation status instead of creating a second sale or financial record.
- Pull endpoints expose the recent synced or failed operations for device reconciliation and acknowledgement.

## Persistence

The default development database is SQLite, which is configured in `app/core/config.py`. The ORM uses SQLAlchemy declarative models and `Base.metadata.create_all` to initialize the schema at startup. For a production deployment, a migration system such as Alembic should replace raw `create_all` initialization.

## Current backend focus

Priorities 1–8 are now covered with real transactional behavior for:

- multi-item sale creation
- payment totals and balance tracking
- inventory deduction for tracked products
- receipt data generation
- refund processing with stock restoration
- order lifecycle management
- order-to-sale conversion using the sale flow
- PDF invoice generation and downloadable output
- dashboard and export analytics
- employee invitations, roles and store-scoped permissions
- offline device registration and idempotent push/pull sync
- business/store isolation checks

Later priorities remain as future work and are intentionally separated from the current sales and order modules to keep each milestone testable and auditable.

## Subscription administration

- Subscription plan prices, currencies, durations and feature maps are configured by a bootstrapped Super Admin; no prices or tiers are fabricated or seeded.
- A free plan becomes active on request. Paid plans stay pending because the Vodacom payment provider is not yet integrated; administrative grants are separate, require a reason and create audit entries without claiming payment.
- Business subscription rows are retained as history. Replacements mark previous active rows superseded rather than overwriting them.
- Entitlements are the active plan feature map merged with business-specific overrides. Tenants without a configured subscription are not blocked from existing APIs.
- The bootstrap route requires both an authenticated account matching `SUPER_ADMIN_EMAIL` and a constant-time checked secret. Email matching during registration never elevates privileges.
- Platform user, business, store, plan, and grant operations are protected by the Super Admin flag and recorded in the platform audit log where they change state.

## Vodacom Tanzania integration status

No mobile-money provider request or callback endpoint is enabled. Sales, customer collection, and supplier payment routes reject `mobile_money` entries until provider verification exists. Safaricom Daraja is a Kenya/KES API and was not substituted for the requested Vodacom Tanzania (TZS) integration. The exact Vodacom authentication, payment-initiation, callback and status-verification contract must be confirmed from official merchant documentation before implementation; provider callbacks must not be trusted as proof until the provider-specific verification flow is implemented and tested.

## Persistence and migration caveat

Development schema initialization now uses non-destructive SQLAlchemy `create_all`, so starting the API does not delete the SQLite database. This creates new tables but does not migrate changed columns in existing tables. The repository does not yet have a baseline Alembic migration; production schema rollout still requires a reviewed migration plan before deployment.
