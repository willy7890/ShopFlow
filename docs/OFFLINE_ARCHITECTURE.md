# Offline architecture

## Source of truth

SQLite is the authoritative store for local business data. A transaction committed locally must remain available after the app closes or the device loses connectivity. No internal read or write is allowed to silently fall back to the network.

## Transaction boundaries

For a sale, one database transaction validates the business/store/product scope and stock, records sale and item snapshots, records cash payment, updates balances, writes stock movements and inserts an outbox row. Manual stock changes update the store balance and reasoned movement ledger in one transaction. A failure at any point rolls back the full operation. Inventory purchases and debt/supplier payments will follow the same all-or-nothing pattern when migrated.

Money is stored as integer TZS minor units. Quantities use safe integer base units; fractional units require an explicitly designed scaled-integer representation before being enabled.

## Outbox contract

Each local operation has a stable operation ID, entity type/ID, operation name, serialized payload, creation timestamp, attempt count and state (`pending`, `in_progress`, `synced`, `failed`, or `conflict`). A server adapter must submit the ID as an idempotency key. Transport retries must not create duplicate financial records. Conflicts are retained for user review and are never silently overwritten.

The current app creates durable pending sale operations but does not send them to a server. Sync status therefore remains pending until a real API adapter and server-side idempotency contract exist.

## Connectivity boundaries

Local catalog, sales, inventory and reports are designed to work offline. Provider payment confirmation, communication between devices, remote administration and remote AI require connectivity. The app must not claim any such remote operation succeeded until it receives a verifiable response.
