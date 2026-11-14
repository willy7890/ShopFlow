# ShopFlow Backend — Version 0.3 (Phases 1–4)

This version includes the Phase 1–2 foundation, Phase 3–4 catalog and inventory capabilities, and the first operational POS and sales implementation.

## Implemented
- FastAPI + SQLAlchemy 2 + Pydantic 2 foundation
- Registration, login, JWT access token, rotating refresh token, logout, current user
- Multi-business membership, stores and role/store access checks
- Categories with parent categories, brands, units and conversion factors
- Products and variants with SKU, barcode, prices and stock threshold
- Barcode lookup scoped to the active business
- Authenticated, store-scoped AI business assistant (requires an operator-configured OpenAI-compatible provider)
- Suppliers
- Draft purchases and explicit receive action
- Inventory balances, stock movement ledger and weighted-average cost on receiving stock
- Store/business validation on inventory routes
- POS sales creation with multi-item carts and payment totals
- Sale history retrieval, receipt data and payment balance tracking
- Refund processing with per-sale idempotency, cumulative quantity checks, stock restoration and refund history

## Local setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
API docs: `http://127.0.0.1:8000/api/v1/docs`

For the mobile app on a physical device, start Expo in LAN mode on the same Wi-Fi as this computer. The app derives the local API host from Expo's LAN address and connects to port `8000`; the backend must bind to `0.0.0.0` as shown above. `EXPO_PUBLIC_API_URL` can override the detected local address when needed. `127.0.0.1` is only the phone/emulator itself from a mobile app's point of view.

## Required headers
For endpoints requiring business membership, include:
```http
Authorization: Bearer <access_token>
X-Business-ID: <business_uuid>
```
Store operations additionally accept a `store_id` query/body value and validate it against the business and membership's assigned stores.

## Main endpoints
- `POST /api/v1/catalog/categories`, `GET /api/v1/catalog/categories`
- `POST /api/v1/catalog/brands`, `GET /api/v1/catalog/brands`
- `POST /api/v1/catalog/units`, `GET /api/v1/catalog/units`
- `POST /api/v1/catalog/products`, `GET /api/v1/catalog/products`
- `POST /api/v1/catalog/products/{product_id}/variants`
- `GET /api/v1/catalog/products/{product_id}/variants`
- `GET /api/v1/catalog/barcodes/{barcode}`
- `POST /api/v1/inventory/suppliers`, `GET /api/v1/inventory/suppliers`
- `POST /api/v1/inventory/purchases`
- `GET /api/v1/inventory/purchases`
- `POST /api/v1/inventory/purchases/{purchase_id}/receive`
- `GET /api/v1/inventory/stock?store_id=<uuid>`
- `GET /api/v1/inventory/movements?store_id=<uuid>`
- `GET /api/v1/reports/sales`, `/profit`, `/expenses`, `/inventory`, `/customers`, `/suppliers`

## Purchase and stock rules
A purchase starts as `draft`; stock is not increased until the explicit receive endpoint succeeds. Receiving a purchase is atomic: it adds stock balances and ledger movements, then marks the purchase received. Re-receiving is rejected. Stock quantity is stored in the variant's base unit. For example, receiving 2 cartons with `conversion_factor=24` adds 48 base units. Purchase cost is converted to base-unit cost for the weighted-average inventory valuation.

## Database and migrations
SQLite is the default for local development. Set `DATABASE_URL` in `.env` to a `postgresql+psycopg://...` URL to use PostgreSQL locally. Render's `postgres://` and `postgresql://` URLs are normalized to the psycopg 3 driver automatically.

The first Alembic revision creates missing tables and adds only the legacy compatibility columns already supported by the application. It never drops or resets tables, and its downgrade is intentionally disabled to protect business data. Production startup applies migrations before serving requests; development startup retains `create_all` as a local convenience.

## Render deployment
Configure the backend service with root directory `backend`, build command `pip install -r requirements.txt`, and start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

Set `APP_ENV=production`, `DATABASE_URL` to the Render PostgreSQL **internal** connection URL, `SECRET_KEY` to a newly generated random value of at least 32 characters, and `CORS_ORIGINS` to a comma-separated list of deployed web origins. Production startup rejects SQLite and the built-in development signing key. The liveness/readiness endpoint is `/health`; API docs are at `/api/v1/docs`.

### Super Admin bootstrap

Set `SUPER_ADMIN_EMAIL` to the one designated platform administrator email and set `SUPER_ADMIN_BOOTSTRAP_SECRET` to a separate high-entropy secret in the backend environment. Never put the bootstrap secret in the mobile app or source control. Public registration never assigns the platform role. To activate it, the account must exist, be active, have a verified email, authenticate normally, and call `POST /api/v1/subscriptions/admin/bootstrap` with its bearer token and `X-Super-Admin-Bootstrap-Secret`. The operation is idempotent, refuses a second Super Admin, and records the assignment in the platform audit log.

If bootstrap reports an existing Super Admin but the configured, verified account is not one, inspect the `users.is_super_admin` identities and platform audit log. Migration `9d62b6f24ac1` adds the single-Super-Admin database invariant and never grants or transfers the role. It stops before adding the index if multiple flagged accounts exist. Resolve that case through the authenticated, audited primary-account recovery flow, then deploy the schema migration. Afterward, confirm `/api/v1/auth/me` and platform admin endpoints using a normal session for the intended account.

### Email verification delivery

Set `EMAIL_VERIFICATION_BASE_URL` to the publicly reachable `/api/v1/auth/verify-email` endpoint. Use an HTTPS URL in deployed environments. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM_EMAIL`, and either authenticated `SMTP_USERNAME`/`SMTP_PASSWORD` or leave both blank for a relay that permits unauthenticated delivery. Use `SMTP_STARTTLS=true` for STARTTLS (usually port 587), or `SMTP_USE_SSL=true` for implicit TLS (usually port 465); do not enable both. Keep provider credentials only in backend environment settings. Verification links contain random tokens in a URL fragment so normal HTTP access logs do not receive them; only token hashes are stored in the database. Links expire after `EMAIL_VERIFICATION_TOKEN_MINUTES`, are single-use, and a resend invalidates older links. Resends are limited per account by the configured cooldown and hourly maximum.

If SMTP or the verification URL is not configured, registration succeeds but returns `email_sent: false`; no token or fake link is issued. Once configured, use the app's **Resend verification email** action for an existing unverified account. Verify provider delivery before deploying by registering a test address and confirming that the delivered link reaches the configured HTTPS endpoint and that reusing it is rejected.

Password reset uses the same SMTP sender and hashed, single-use token storage. Set `PASSWORD_RESET_BASE_URL` to the public `/api/v1/auth/password-reset` page and tune `PASSWORD_RESET_TOKEN_MINUTES`, `PASSWORD_RESET_RESEND_COOLDOWN_SECONDS`, and `PASSWORD_RESET_MAX_PER_HOUR` as needed. For local development, run Mailpit or another SMTP capture service on the host and port in `.env`; the example uses `127.0.0.1:1025` and sends no real email unless you replace those settings.

Generate a signing key locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and enter it directly in Render's environment settings. Do not commit it or put it in mobile `EXPO_PUBLIC_*` variables.

## Business assistant provider
The assistant is disabled unless `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` are configured on the backend. The backend sends the question and a small set of store-scoped aggregate sales, cashbook, and low-stock facts to that OpenAI-compatible endpoint. Do not configure a provider unless the business has approved this data transfer. The API key remains on the server and is never returned to mobile clients. Requests are limited by `AI_TIMEOUT_SECONDS`; an unavailable or unconfigured provider returns an explicit API error rather than an invented answer.

## Not yet implemented
Quick sales, invoices, payment provider callbacks, subscriptions and the full audit event pipeline are subsequent phases. The AI assistant additionally requires an operator-configured provider. This version should not be represented as the complete production system.
