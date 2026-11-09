# Implementation status

Last updated: 2026-11-10

## Current phase

Phases 1–3 are implemented in the Expo/React Native app and validated with local TypeScript, repository and Android bundle checks. The backend implements priorities 1–9; Vodacom Tanzania mobile-money processing remains disabled pending the official provider contract. The current mobile phase is integration with the existing FastAPI backend, starting with online authentication and business/store selection. This is an incremental integration: the mobile app's catalog, sales, inventory and other business operations still use local SQLite and do not yet synchronize with the backend. The Vite frontend remains available in parallel. This is not a claim that the complete product specification or an Android release is done.

## Mobile/backend integration — in progress

- Added SecureStore-backed online login, registration, refresh and logout using the existing FastAPI auth routes.
- Added authenticated `GET /api/v1/businesses/access` so mobile can display active business/store assignments and permissions.
- Added business/store selection and a local SQLite workspace mirror for the selected online identity.
- The mobile build currently supports TZS workspaces only. The local mirror is not a server data cache or sync implementation; business writes remain local and may diverge from web data.
- Offline authentication continuity, account switching between local businesses, and synchronization are not complete. Do not rely on mobile mutations being visible on web.

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
- Backend priorities 1–8 have implementations in the domain routers and tests. Priority 9 now includes configurable subscription plans, business subscription history and entitlements, secret-based Super Admin bootstrap, tenant/user/store administration, platform usage analytics and audit logs. Priority 10 is blocked: the project targets Vodacom Tanzania (TZS), and no provider endpoints are enabled until the official merchant API contract is available. The existing mobile analytics/notification foundation remains local; remote AI/push notifications, backup/restore and release testing remain future work.
- Barcode scanning, fractional stock units, mobile business-data API integration, offline synchronization and iOS device testing remain future work.
- Vodacom Tanzania M-Pesa requires the official merchant API contract, credentials, callback-verification rules, and status-query semantics. No mobile-money payment is auto-confirmed or exposed by the backend while those requirements are missing.
- Subscription prices and feature matrices are not seeded. A Super Admin must configure plans; the API exposes effective entitlements, while legacy business routes are not gated until the product's per-feature/limit matrix is defined.
- The backend uses non-destructive `create_all` for development but has no baseline Alembic migration yet. Existing databases must not rely on `create_all` to update changed columns.
- Platform subscription revenue is reported as unavailable (`null`) until verified Vodacom payment records can be recorded; it is not estimated from administrative grants.

## Validation record

- Backend `python3 -m pytest -q`: passed, 10 tests, including authenticated business access.
- Mobile `npm run typecheck`: passed.
- Mobile `npm test`: passed, 9 tests, including remote workspace activation and store-scoped local permission mirroring.
- Android export passed; it produces an Expo JavaScript bundle, not an APK.
- `npm audit --audit-level=moderate`: 0 vulnerabilities reported.
- Gradle/APK, Android device and airplane-mode checks are still pending because the Android SDK is unavailable.
