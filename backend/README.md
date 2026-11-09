# ShopFlow Backend — Version 0.3 (Phases 1–4)

This version includes the Phase 1–2 foundation, Phase 3–4 catalog and inventory capabilities, and the first operational POS and sales implementation.

## Implemented
- FastAPI + SQLAlchemy 2 + Pydantic 2 foundation
- Registration, login, JWT access token, rotating refresh token, logout, current user
- Multi-business membership, stores and role/store access checks
- Categories with parent categories, brands, units and conversion factors
- Products and variants with SKU, barcode, prices and stock threshold
- Barcode lookup scoped to the active business
- Suppliers
- Draft purchases and explicit receive action
- Inventory balances, stock movement ledger and weighted-average cost on receiving stock
- Store/business validation on inventory routes
- POS sales creation with multi-item carts and payment totals
- Sale history retrieval, receipt data and payment balance tracking
- Refund processing that restores stock and records refund history

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
- `POST /api/v1/inventory/purchases/{purchase_id}/receive`
- `GET /api/v1/inventory/stock?store_id=<uuid>`
- `GET /api/v1/inventory/movements?store_id=<uuid>`

## Purchase and stock rules
A purchase starts as `draft`; stock is not increased until the explicit receive endpoint succeeds. Receiving a purchase is atomic: it adds stock balances and ledger movements, then marks the purchase received. Re-receiving is rejected. Stock quantity is stored in the variant's base unit. For example, receiving 2 cartons with `conversion_factor=24` adds 48 base units. Purchase cost is converted to base-unit cost for the weighted-average inventory valuation.

## Development database note
SQLite is the default for local development. For PostgreSQL, set `DATABASE_URL` in `.env` to a `postgresql+psycopg://...` URL. `create_all` is only a development convenience; production schema changes should use Alembic migrations, which will be added before production deployment.

## Not yet implemented
POS sales, quick sales, invoices, refunds, expenses, debts, cashbook, AI engine, offline sync, payment provider callbacks, subscriptions and full audit event pipeline are subsequent phases. This version should not be represented as the complete production system.
