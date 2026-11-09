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
- POS barcode scanning with camera permission handling, external keyboard-scanner/manual barcode entry, exact local lookup, repeated-scan quantity increments and unknown-code product registration.
- Local analytics and notifications that summarize today’s sales, top sellers and low-stock alerts directly from SQLite records.
- Online account registration/sign-in with SecureStore-backed tokens, plus server-validated business/store selection.
- SQLite schema migrations through v3; existing v1 records are migrated in place. No API sync is enabled.

The app starts with no sample business, products, sales or financial records. Setup data is entered by the operator. Passwords are stored as salted PBKDF2 verifiers, not plaintext. SQLite is not encrypted at rest, and local login is device access control rather than protection against database extraction. Online authentication currently verifies identity and membership only: catalog, inventory and sales operations still persist locally and are not shared with the web app. Do not use the mobile app as a synchronized point of sale yet. Full sales history/refund flows, finance, customer, supplier, reports, integrations, backup/sync and release workflows remain in later phases. The local analytics/notification layer is on-device analytics only; it does not connect to external AI services or push notifications.
