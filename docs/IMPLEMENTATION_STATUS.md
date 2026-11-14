# Implementation status

Last updated: 2026-11-10

## Current phase

The Expo/React Native app covers local business setup, catalog/inventory, POS, customer/supplier accounts, cashbook/reports, assistant/analytics and camera barcode scanning. It also supports online authentication, remote catalog/stock download and outbox sync for selected transaction types. Local SQLite remains the operational source of truth; integration is partial, not full backend parity. The Vite frontend includes business employee permission assignment and a Super Admin platform dashboard backed by the subscription administration APIs. The backend implements priorities 1–9; Vodacom Tanzania mobile-money processing remains disabled pending the official provider contract. This is not a claim that the complete product specification or an Android release is done.

## Mobile/backend integration — in progress

- Added SecureStore-backed online login, registration, refresh and logout using the existing FastAPI auth routes.
- Added authenticated `GET /api/v1/businesses/access` so mobile can display active business/store assignments and permissions.
- Added business/store selection, server catalog/store-stock download, authenticated assistant access and idempotent outbox sync for sales, customer/supplier accounts and cashbook entries.
- Added store-scoped sales history and shareable text receipts.
- Added native Sales/Payments views with search, date presets, status filters and payment totals.
- Added online full-sale refunds for fully paid, synced sales, with confirmation, idempotent API retries, local refund records/cashbook expense and server-stock refresh.
- The mobile build currently supports TZS and whole-number catalog prices/stock only. Product edits and stock adjustments on mobile do not sync; there is no remote-to-mobile transaction pull or conflict-review UI. Mobile data can therefore diverge from web data.
- Offline authentication continuity, complete cross-device reconciliation, partial/credit/offline mobile refunds and catalog mutation sync remain incomplete. The backend refund endpoint records idempotency keys and prevents cumulative item over-returns. Review sync failures and server stock before using mobile as the only point of sale.

## Phase 1 — SQLite foundation

- Expo Router React Native TypeScript app and Android Gradle project.
- Local SQLite source of truth, schema migrations and repository layer.
- First-run workspace, basic product/stock flows, cash POS and durable sale outbox.
- Sale, line items, payment, stock decrement, movement ledger and outbox operation write atomically.
- No sample business or financial records are seeded.

## Phase 2 — Business and access foundation

- Business registration on first run and local business renaming.
- Multiple local stores, per-user store assignment, store switching and store-scoped records.
- Local username/password sign-in, cold-start and manual lock screen, failed-login throttling, password reset and employee deactivation.
- Passwords are stored as salted PBKDF2-SHA256 verifiers (100,000 iterations for new accounts), never as plaintext. A migration preserves the work factor of credentials created by the earlier development build.
- Employee registration, role editing, store assignment and per-store grants for business, stores, employees, products, inventory, sales, reports and settings.
- Persistent light/dark theme and inventory-tracking/simplified-sales preferences.

## Phase 3 — Product and inventory management

- Product registration/editing, search by name/SKU/barcode/category, business-managed categories, barcode field, TZS cost/selling prices and low-stock threshold.
- Store-specific opening balances and stock additions/reductions/adjustments, each with a required reason and transactional balance/movement writes.
- Store-scoped movement history plus separate low-stock and out-of-stock counts.
- Inventory mode enforces stock availability and decrements balances at sale. Simplified-sales mode permits sales without stock changes while preserving existing balances.
- Repository permission checks guard business writes; reads and writes are scoped to the current authenticated business/store.

## Still in progress / not delivered

- No Android SDK command-line tools/platforms are installed in the current Mac environment. There is no verified Gradle build, APK or physical-device/airplane-mode test.
- SQLite is not encrypted at rest. Local authentication controls app workflows on this device; it is not protection against someone who can extract the database or modify the app.
- Backend priorities 1–8 have implementations in the domain routers and tests. Priority 9 now includes configurable subscription plans, business subscription history and entitlements, secret-based Super Admin bootstrap, tenant/user/store administration, platform usage analytics and audit logs. Priority 10 is blocked: the project targets Vodacom Tanzania (TZS), and no provider endpoints are enabled until the official merchant API contract is available. Remote AI/push notifications and release testing remain future work.
- Partial, credit-sale and offline mobile refunds; fractional stock units; full mobile business-data API integration; sync conflict resolution; subscription/Super Admin mobile workflows; and iOS device testing remain future work. Online full refunds for synced, fully paid sales, printable PDF invoices and backend idempotency/cumulative quantity safeguards are implemented. Barcode scanning, remote catalog download, partial outbox sync, sync queue inspection/manual retry, sales history/receipts and database backup/restore are implemented.
- Backup restore validates a ShopFlow SQLite database and supported schema before replacement, requires explicit confirmation, clears online tokens and the active local user, and returns to sign-in. Backup files are unencrypted and include sensitive shop records and password verifiers; protect exported files accordingly.
- Vodacom Tanzania M-Pesa requires the official merchant API contract, credentials, callback-verification rules, and status-query semantics. No mobile-money payment is auto-confirmed or exposed by the backend while those requirements are missing.
- Subscription prices and feature matrices are not seeded. Existing plan rows require explicit Super Admin review, and pre-rollout subscribers remain in legacy access mode until enforcement is applied per subscription. Mapped business endpoints require an active subscription and configured feature entitlements; no or expired subscriptions cannot use paid features. Super Admin access bypasses business entitlements.
- The backend has a forward-only Alembic chain from the initial schema through subscription entitlement rollout. Development `create_all` is non-destructive but does not update changed columns; use reviewed Alembic upgrades for existing databases.
- Platform subscription revenue is reported as unavailable (`null`) until verified Vodacom payment records can be recorded; it is not estimated from administrative grants.

## Validation record

- Backend sales/refund integration test: passed; backend suite excluding `test_reports_flow.py`: 15 passed. The full suite has one reports-flow assertion mismatch in the already-modified reports worktree.
- Mobile `npm run typecheck`: passed.
- Mobile `npm test`: passed, 16 tests including pending refund recovery, invoice HTML escaping, SQLite migrations, and store-scoped workspace activation.
- Android export passed; it produces an Expo JavaScript bundle, not an APK.
- `npm audit --audit-level=moderate`: 0 vulnerabilities reported.
- Gradle/APK, Android device and airplane-mode checks are still pending because the Android SDK is unavailable.
