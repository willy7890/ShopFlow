# Mobile architecture

The mobile app in `mobile/` is a native React Native application built with Expo and Expo Router. It must not import web components, DOM APIs, browser storage, or render the website in a WebView.

## Layers

- `app/`: native route and navigation declarations.
- `src/components/`: reusable React Native controls and layout.
- `src/features/`: feature screens and feature-specific presentation logic.
- `src/database/`: SQLite initialization and versioned migrations.
- `src/repositories/`: typed local reads/writes; no UI-specific business calculations.
- `src/domain/`: currency, validation and transaction rules independent of UI.
- `src/services/`: synchronization, export, backup, notification and external-service boundaries.
- `src/theme/`: orange brand colors and opaque light/dark surfaces.
- `tests/`: domain and repository tests.

SQLite is the source of truth for internal operations. Screens call repositories; repositories own SQL and transaction boundaries. The FastAPI API is an optional remote adapter and must not be called directly from a screen.

## Data rules

- Monetary values use integer minor units in TZS; never use floating point for posted totals.
- A sale writes its header, item snapshots, payment, inventory changes, stock movement and outbox operation in one SQLite transaction.
- Stock is rechecked and decremented inside that transaction. A failed validation rolls back every write.
- Store, business and actor IDs are carried on business transactions.
- Every repository operation that uses a workspace verifies the current active user/store; write operations also check the assigned permission. Business and store identifiers are included in queries so records from another business or store are not surfaced.
- Local account passwords are salted and stored only as PBKDF2-SHA256 verifiers. SQLite itself is not encrypted at rest; device/database extraction remains outside the protection provided by local sign-in.
- IDs and outbox idempotency keys are generated locally; remote sync must be safe to retry.

## Compatibility choices

The app uses Expo Router for native navigation, Expo SQLite for persistence, Expo Crypto for locally generated UUIDs, `@noble/hashes` for PBKDF2-SHA256 credential verifiers, and Zod for input validation. Schema migrations are versioned through v3 and preserve existing v1 records. Persistent user preferences include light/dark appearance and inventory/simplified-sales mode. Expo SDK and React Native versions are kept aligned through `npx expo install`. Charts, scanning, printing, file sharing, notifications and mobile-money integrations are deliberately added with their feature phases, not replaced with browser-only packages.
