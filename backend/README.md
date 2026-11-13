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
uvicorn app.main:app --reload
```
API docs: `http://127.0.0.1:8000/api/v1/docs`

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

Generate a signing key locally with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and enter it directly in Render's environment settings. Do not commit it or put it in mobile `EXPO_PUBLIC_*` variables.

## Business assistant provider
The assistant is disabled unless `AI_API_BASE_URL`, `AI_API_KEY`, and `AI_MODEL` are configured on the backend. The backend sends the question and a small set of store-scoped aggregate sales, cashbook, and low-stock facts to that OpenAI-compatible endpoint. Do not configure a provider unless the business has approved this data transfer. The API key remains on the server and is never returned to mobile clients. Requests are limited by `AI_TIMEOUT_SECONDS`; an unavailable or unconfigured provider returns an explicit API error rather than an invented answer.

## Not yet implemented
Quick sales, invoices, payment provider callbacks, subscriptions and the full audit event pipeline are subsequent phases. The AI assistant additionally requires an operator-configured provider. This version should not be represented as the complete production system.
