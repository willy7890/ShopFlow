# ShopFlow Android migration

## Repository audit

The repository currently has three relevant parts:

- `frontend/` is a React 18, TypeScript, Vite web application. Its route tree and admin screens are browser UI, not React Native.
- `backend/` is a FastAPI/SQLAlchemy service. It is useful for optional remote sync and administration, but is not required for local shop operations.
- `mobile/` is the new Expo Router/React Native TypeScript application. It is the target product; the web app remains in place as a reference during migration.

The web UI already has routes for authentication/onboarding, dashboard, POS, catalog, inventory, sales/invoices, customers/debts, suppliers/purchases, finance/reports, AI, employees, stores, subscription, settings and sync. Its `Api` interface and cart calculations are useful contract references, but the web components, IndexedDB, DOM styling, browser barcode APIs and Recharts are not mobile UI.

The backend provides authentication, business/store access, catalog, inventory, customer/supplier finance, POS/sales, cashbook, reports, subscriptions, assistant and an offline-sync API. Provider-based mobile-money confirmation remains disabled pending the official provider contract. The API does not expose every operation in the web `Api` interface.

The mobile app now includes native local workflows for POS, accounts, cashbook/reports, barcode scanning, local analytics and SQLite backup/restore, plus online authentication, server catalog/stock download and partial outbox synchronization. Sales history, shareable text receipts, printable PDF invoices and online full-sale refunds for synced, fully paid sales are implemented. The sync queue exposes failed/conflicted items and allows manual retry of failed items; conflict resolution is not implemented. Refunds for partial/credit sales and offline refunds, complete catalog mutation sync and subscription/Super Admin workflows remain incomplete. Backups are unencrypted; restore validates the database, confirms replacement, clears online credentials and returns to sign-in. See the [mobile README](../mobile/README.md) and [implementation status](./IMPLEMENTATION_STATUS.md) for current limits.

The mobile suite has 16 tests for core domain logic and SQLite workflows; the backend sales/refund integration test also passes. The full backend suite currently has one reports-flow assertion mismatch. These tests and the Android JavaScript export are not evidence that the native workflows have been tested on a device.

## Feature migration matrix

“Phase 1” means the current native SQLite foundation, not a claim that the full module has migrated.

| Existing or required feature | Existing source | Mobile representation | State |
|---|---|---|---|
| Android app shell/navigation | `frontend/src/App.tsx`, `frontend/src/components/AppShell.tsx` | Expo Router native tab navigation | Implemented; device check pending |
| Business/store management and local authentication | `frontend/src/features/auth/Onboarding.tsx`; backend businesses/auth | SQLite business/store/user records, local password sign-in, lock/switch-user, per-store permission grants | Phase 2 implemented; device check pending |
| Catalog and product variants | `frontend/src/features/catalog/Products.tsx`, `Categories.tsx`; backend catalog | SQLite product/variant/category repositories; product create/edit/search; SKU/barcode and integer-TZS prices | Phase 3 implemented; device check pending |
| Inventory and movement ledger | `frontend/src/features/inventory/Inventory.tsx`; backend inventory | Store-specific SQLite balances, transactional adjustments with reasons, history, low/out-of-stock alerts | Phase 3 implemented; device check pending |
| POS, cash tender/change, sale history | `frontend/src/features/pos/PosPage.tsx`, `QuickSales.tsx`, `Receipt.tsx`; backend POS/sync | Native POS; atomic local sale, payment, stock and outbox; scoped sales history and shareable text receipt | Implemented; partial/credit/offline refunds and printable invoices pending |
| Refunds, invoices and downloadable receipts | `frontend/src/features/sales/Invoices.tsx`, `Sales.tsx`; backend sales/sync | Online full-sale refunds for synced, fully paid sales; stable retry key, local refund/cashbook record and printable PDF invoices | Partial; partial/credit/offline refunds pending |
| Customers and debt/repayment | `frontend/src/features/people/Customers.tsx`, `Debts.tsx`; backend customer/sync APIs | SQLite customer, receivable and repayment workflows | Local flows implemented; selected records sync |
| Suppliers, supplier orders/payables | `frontend/src/features/people/Suppliers.tsx`, `Purchases.tsx`; backend supplier/inventory APIs | SQLite supplier/payable/payment workflows | Local flows implemented; account records sync; purchase receiving workflow not complete |
| Expenses, cashbook and reports | `frontend/src/features/finance/`; backend finance/report APIs | Integer-TZS ledger queries, native reports and CSV export | Implemented locally; online parity is partial |
| Dashboard and local analytics | `frontend/src/features/dashboard/Dashboard.tsx`; backend assistant/sync | Queries derived from local transactions | Implemented locally; remote assistant is optional |
| Employees, granular permissions, multi-store | `frontend/src/features/admin/Employees.tsx`, `Stores.tsx`; backend partial | Local employee registration/profile/password/role management, per-store grants, store create/switch UI | Phase 2 implemented; device check pending |
| Subscription and super admin | `frontend/src/features/admin/Subscription.tsx`; backend gap | Remote administration and entitlement enforcement | Pending; requires connectivity |
| Settings and language/theme | `frontend/src/features/admin/Settings.tsx` | Persistent local light/dark theme and inventory/simplified-sales mode | Phase 2 implemented; device check pending |
| Offline sync and conflict review | `frontend/src/offline/`; backend sync API | SQLite outbox with idempotent push for sales/accounts/cashbook; scoped queue inspection and failed-item retry | Partial; catalog mutations, remote pull and conflict resolution pending |
| Barcode scanning | `frontend/src/components/Scanner.tsx` | Expo camera/barcode APIs | Implemented; device validation pending |
| AI insights | `frontend/src/features/ai/Assistant.tsx`; backend assistant API | On-device/local-data insights; authenticated remote assistant optional | Implemented; remote provider must be configured by operator |
| Notifications and backup/restore | Web/backend gap | Local analytics notifications; validated SQLite export/import | Notifications are local/in-app only; backup/restore implemented, exported files are unencrypted |
| M-Pesa/provider payments | Web/backend gap | Provider integration boundary; never mark paid without provider confirmation | Pending; connectivity required |

## Phased migration

1. **Foundation:** complete local Expo/SQLite foundation, native navigation, first-run setup, basic catalog/stock, cash POS and outbox.
2. **Business foundation:** implemented locally with business/store management, store switching, local authentication, employees, per-store permissions and persistent theme/sales-mode settings.
3. **Product and inventory:** implemented locally with categories, create/edit/search, SKU/barcode fields, store stock operations/history/alerts and inventory/simplified-sales modes.
4. **POS and sales:** atomic cash/credit POS, scoped sales history, shareable text receipts and printable PDF invoices implemented; mobile supports online refunds of fully paid synced sales. Partial/credit/offline refunds remain pending.
5. **Customers and debts:** local customer/debt/collection flows implemented; selected outbox sync available.
6. **Suppliers and supplier orders:** local supplier/payable/payment flows implemented; purchase receiving remains incomplete.
7. **Cashbook and expenses:** local cashbook, manual entries and CSV export implemented; selected entries sync.
8. **Invoices and reports:** local 7/30/90-day reports implemented; printable invoices pending.
9. **AI analytics and notifications:** on-device analytics and local/in-app notifications implemented; external push delivery is not implemented.
10. **Subscriptions and Super Admin:** pending; remote administration requires connectivity.
11. **Backup, restoration and synchronization:** validated SQLite backup/restore and partial outbox transport for selected records are implemented; failed/conflicted items can be inspected and failed items retried; conflict resolution and catalog mutation sync remain pending.
12. **Android APK and release testing:** pending until the local Android SDK is installed and Gradle/device tests pass.

Do not remove `frontend/` or `backend/` as part of this migration. The backend remains a future sync/administration service; the web app is retained until mobile feature parity is verified.
