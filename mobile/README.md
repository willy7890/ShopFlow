# ShopFlow Mobile

Native Android-first ShopFlow app using React Native, TypeScript, Expo Router and Expo SQLite. The existing Vite app is retained separately at `../frontend/` while features are migrated and compared.

## Development

```bash
npm install
npm start
npm run typecheck
npm test
```

`npm start` starts Expo Go/development tooling. It is not a standalone APK. See [the local Android build guide](../docs/ANDROID_BUILD.md) for SDK requirements and local Gradle build commands.

After adding or changing native modules, regenerate the native project, then build a standalone debug APK (with the Android SDK and JDK configured):

```bash
npm run android:prebuild
npm run android:apk:debug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. A signed release APK can be built with `npm run android:apk:release` after configuring local signing credentials.

## Implemented local functionality (Phases 1–3 and local phase-9 analytics foundation)

- First-run business registration, local username/password sign-in, lock/switch-user and employee role/password management.
- Multiple stores per business, store switching and per-store employee permissions.
- Persistent light/dark theme with a single sun/moon toggle at the top-right of the screen, plus inventory-tracking/simplified-sales settings.
- Product and category create/edit/search with SKU, barcode, integer-TZS purchase/selling prices and opening stock.
- Store-specific stock additions/reductions/adjustments, reasoned movement history and low/out-of-stock alerts.
- Cash POS with quantity, stock validation in inventory mode, cash tender/change and atomic local sale/outbox records.
- Customer debtors and supplier creditors with search, outstanding-balance filters, transaction statements, customer-linked partial-payment sales, collections, payable bills and payments, and store-scoped balances. Supplier bills record payables only and do not receive stock.
- POS barcode scanning with camera permission handling, external keyboard-scanner/manual barcode entry, exact local lookup, repeated-scan quantity increments, unknown-code product registration, and configurable success/error scan tones.
- Native camera barcode decoding for common retail formats, with a visible scan target and flashlight control.
- Local cashbook with manually recorded income/expenses, automatic entries for sales and account payments, category/note search, 7/30/90-day filtering, and CSV file sharing. Local 7/30/90-day reports cover sales, cash flow, outstanding balances and top products.
- Local analytics and notifications that summarize today’s sales, top sellers and low-stock alerts directly from SQLite records.
- Online account registration/sign-in with SecureStore-backed tokens, plus server-validated business/store selection.
- Online workspace setup downloads the assigned catalog and store stock. The outbox retries sales, customer/supplier records and payments, and cashbook entries with server idempotency; syncing runs on Home focus and can be started manually.
- Store-scoped sync queue review shows pending, failed and conflicted changes with error details; failed changes can be retried manually, while conflicts are preserved and never automatically resent.
- The business assistant uses the authenticated, store-scoped backend provider for online workspaces and the private on-device helper for local workspaces. The backend assistant stays unavailable until an operator configures an OpenAI-compatible provider.
- Store-scoped sales history with sale details and shareable text receipts; receipts include item snapshots, totals, payments, customer, date and change.
- Owner/manager-settings-gated full SQLite backup export and restore through the native file/share pickers; restore validates integrity/schema, asks for destructive confirmation, clears online credentials and returns to sign-in.
- SQLite schema migrations through v10; existing sales and account-payment history are preserved and reflected in the cashbook during upgrade. Product barcodes are stored per variant to support downloaded catalogs.

The app starts with no sample business, products, sales or financial records. Setup data is entered by the operator. Passwords are stored as salted PBKDF2 verifiers, not plaintext. SQLite is not encrypted at rest, and local login is device access control rather than protection against database extraction. Exported backups are also unencrypted and include private shop records and password verifiers; protect backup files as sensitive data. Online assistant questions and aggregate store facts are sent to the backend and then to its configured AI provider; the provider key stays on the server. Do not configure a provider without business approval for that transfer. Offline sync currently covers sales, customer/supplier accounts and cashbook records; local product edits and stock adjustments are not uploaded. The mobile app also supports only whole-number TZS prices and stock quantities for downloaded catalogs. Inspect failed/conflicted changes in the sync queue and review server stock before relying on the app as the only point of sale; conflict resolution is not yet available. Sales history and text receipt sharing are available; refunds, printable invoice documents, catalog mutation sync and release workflows remain incomplete. Restore replaces the on-device database and clears the online sign-in. Local analytics, offline assistant responses and notifications run on-device and do not connect to external AI services or push notifications.
