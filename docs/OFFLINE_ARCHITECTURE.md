# Offline architecture

## Source of truth

SQLite is the authoritative store for local business data. A transaction committed locally must remain available after the app closes or the device loses connectivity. No internal read or write is allowed to silently fall back to the network.

## Transaction boundaries

For a sale, one database transaction validates the business/store/product scope and stock, records sale and item snapshots, records cash payment, updates balances, writes stock movements and inserts an outbox row. Manual stock changes, customer/supplier account entries and cashbook movements use transactional repository writes. A failure at any point rolls back the full operation.

Money is stored as integer TZS minor units. Quantities use safe integer base units; fractional units require an explicitly designed scaled-integer representation before being enabled.

## Outbox contract

Each local operation has a stable operation ID, entity type/ID, operation name, serialized payload, creation timestamp, attempt count and state (`pending`, `in_progress`, `synced`, `failed`, or `conflict`). A server adapter must submit the ID as an idempotency key. Transport retries must not create duplicate financial records. Conflicts are retained for user review and are never silently overwritten.

The app sends selected sales, customer/supplier records and cashbook entries through the backend idempotency API. Product edits and stock adjustments are not synced; remote transaction pull and conflict resolution are not implemented. A store-scoped queue displays unresolved records and errors; explicit retry resets failed records only. Conflicts are excluded from automatic retry. Do not treat a local-only operation as visible on another device.

Database backups are complete SQLite snapshots, including private records and password verifiers. Backup files are not encrypted. Restore validates database integrity and supported schema, requires explicit user confirmation, clears online tokens and the active local session, and then migrates the restored database.

## Connectivity boundaries

Local catalog, sales, inventory and reports are designed to work offline. Provider payment confirmation, communication between devices, remote administration and remote AI require connectivity. The app must not claim any such remote operation succeeded until it receives a verifiable response.
