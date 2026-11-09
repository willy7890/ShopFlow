# ShopFlow Android migration

## Repository audit

The repository currently has three relevant parts:

- `frontend/` is a React 18, TypeScript, Vite web application. Its route tree and admin screens are browser UI, not React Native.
- `backend/` is a FastAPI/SQLAlchemy service. It is useful for optional remote sync and administration, but is not required for local shop operations.
- `mobile/` is the new Expo Router/React Native TypeScript application. It is the target product; the web app remains in place as a reference during migration.

The web UI already has routes for authentication/onboarding, dashboard, POS, catalog, inventory, sales/invoices, customers/debts, suppliers/purchases, finance/reports, AI, employees, stores, subscription, settings and sync. Its `Api` interface and cart calculations are useful contract references, but the web components, IndexedDB, DOM styling, browser barcode APIs and Recharts are not mobile UI.

The current backend provides registration/login/refresh/logout/current-user, multi-business membership and store access, categories/brands/units/products/variants, suppliers, draft purchases/receiving, inventory balances and stock movements. Its README explicitly lists POS/sales, debt, expenses, cashbook, subscriptions, AI, offline sync, callbacks and audit events as not implemented. The API does not yet expose all of the web `Api` interface.

The existing frontend test suite has 34 tests covering web screens and mock behavior; backend tests cover health and auth. These tests are not evidence that the full business workflows or a mobile build are complete.

## Feature migration matrix

“Phase 1” means the current native SQLite foundation, not a claim that the full module has migrated.

| Existing or required feature | Existing source | Mobile representation | State |
|---|---|---|---|
| Android app shell/navigation | `frontend/src/App.tsx`, `frontend/src/components/AppShell.tsx` | Expo Router native tab navigation | Implemented; device check pending |
| Business/store management and local authentication | `frontend/src/features/auth/Onboarding.tsx`; backend businesses/auth | SQLite business/store/user records, local password sign-in, lock/switch-user, per-store permission grants | Phase 2 implemented; device check pending |
| Catalog and product variants | `frontend/src/features/catalog/Products.tsx`, `Categories.tsx`; backend catalog | SQLite product/variant/category repositories; product create/edit/search; SKU/barcode and integer-TZS prices | Phase 3 implemented; device check pending |
| Inventory and movement ledger | `frontend/src/features/inventory/Inventory.tsx`; backend inventory | Store-specific SQLite balances, transactional adjustments with reasons, history, low/out-of-stock alerts | Phase 3 implemented; device check pending |
| POS, cash tender/change, sale history | `frontend/src/features/pos/PosPage.tsx`, `QuickSales.tsx`, `Receipt.tsx`; backend gap | Native POS; atomic sale, payment, stock and outbox records | Phase 1, basic cash sale |
| Refunds, invoices and downloadable receipts | `frontend/src/features/sales/Invoices.tsx`, `Sales.tsx`; backend gap | Native sales/invoice screens, document export | Pending |
| Customers and debt/repayment | `frontend/src/features/people/Customers.tsx`, `Debts.tsx`; backend gap | SQLite customer, receivable and repayment repositories/screens | Pending |
| Suppliers, supplier orders/payables | `frontend/src/features/people/Suppliers.tsx`, `Purchases.tsx`; backend purchase foundation | SQLite supplier, order, receipt and payment workflows | Pending |
| Expenses, cashbook and reports | `frontend/src/features/finance/`; backend gap | Integer-TZS ledger queries and native reports/export | Pending |
| Dashboard and local analytics | `frontend/src/features/dashboard/Dashboard.tsx`; backend gap | Queries derived from local transactions | Phase 1, basic totals |
| Employees, granular permissions, multi-store | `frontend/src/features/admin/Employees.tsx`, `Stores.tsx`; backend partial | Local employee registration/profile/password/role management, per-store grants, store create/switch UI | Phase 2 implemented; device check pending |
| Subscription and super admin | `frontend/src/features/admin/Subscription.tsx`; backend gap | Remote administration and entitlement enforcement | Pending; requires connectivity |
| Settings and language/theme | `frontend/src/features/admin/Settings.tsx` | Persistent local light/dark theme and inventory/simplified-sales mode | Phase 2 implemented; device check pending |
| Offline sync and conflict review | `frontend/src/offline/`; backend gap | SQLite transactional outbox with idempotency/status | Phase 1, enqueue only; transport pending |
| Barcode scanning | `frontend/src/components/Scanner.tsx` | Expo camera/barcode APIs | Pending |
| AI insights | `frontend/src/features/ai/Assistant.tsx`; backend gap | On-device/local-data insights; remote model optional | Pending; no fake AI |
| Notifications and backup/restore | Web/backend gap | Expo notifications and local database export/import | Pending |
| M-Pesa/provider payments | Web/backend gap | Provider integration boundary; never mark paid without provider confirmation | Pending; connectivity required |

## Phased migration

1. **Foundation:** complete local Expo/SQLite foundation, native navigation, first-run setup, basic catalog/stock, cash POS and outbox.
2. **Business foundation:** implemented locally with business/store management, store switching, local authentication, employees, per-store permissions and persistent theme/sales-mode settings.
3. **Product and inventory:** implemented locally with categories, create/edit/search, SKU/barcode fields, store stock operations/history/alerts and inventory/simplified-sales modes.
4. **POS and sales:** cash POS exists as a foundation; full sales workflows, sales history, refunds and receipts remain pending.
5. **Customers and debts:** pending.
6. **Suppliers and supplier orders:** pending.
7. **Cashbook and expenses:** pending.
8. **Invoices and reports:** pending.
9. **AI analytics and notifications:** pending; no fabricated AI output.
10. **Subscriptions and Super Admin:** pending; remote administration requires connectivity.
11. **Backup, restoration and synchronization:** outbox enqueueing exists; transport, conflict UI and database backup/restore remain pending.
12. **Android APK and release testing:** pending until the local Android SDK is installed and Gradle/device tests pass.

Do not remove `frontend/` or `backend/` as part of this migration. The backend remains a future sync/administration service; the web app is retained until mobile feature parity is verified.
