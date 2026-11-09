import type { SQLiteDatabase } from 'expo-sqlite'

const INITIAL_SCHEMA = `
CREATE TABLE businesses (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TZS' CHECK (currency = 'TZS'),
  timezone TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  created_at TEXT NOT NULL
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (business_id, code)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'store_manager', 'cashier', 'accountant', 'inventory_manager')),
  created_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  setting_key TEXT PRIMARY KEY NOT NULL,
  setting_value TEXT NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (business_id, name)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit_code TEXT NOT NULL DEFAULT 'pcs',
  cost_price_minor INTEGER NOT NULL CHECK (cost_price_minor >= 0),
  sell_price_minor INTEGER NOT NULL CHECK (sell_price_minor >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (business_id, sku)
);

CREATE TABLE inventory_balances (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL,
  UNIQUE (business_id, store_id, variant_id)
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening', 'sale', 'purchase', 'adjustment', 'return')),
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta != 0),
  unit_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_minor >= 0),
  reference_type TEXT,
  reference_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sales (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sale_number TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  cash_tendered_minor INTEGER NOT NULL CHECK (cash_tendered_minor >= total_minor),
  change_minor INTEGER NOT NULL CHECK (change_minor >= 0),
  sync_state TEXT NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending', 'synced', 'failed', 'conflict')),
  created_at TEXT NOT NULL,
  UNIQUE (business_id, sale_number)
);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'mobile_money', 'bank', 'credit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'failed', 'credit')),
  created_at TEXT NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL UNIQUE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'synced', 'failed', 'conflict')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_products_business_active ON products(business_id, is_active, name);
CREATE INDEX idx_variants_business_active ON product_variants(business_id, is_active);
CREATE INDEX idx_balances_store_variant ON inventory_balances(store_id, variant_id);
CREATE INDEX idx_movements_store_created ON stock_movements(store_id, created_at DESC);
CREATE INDEX idx_sales_business_created ON sales(business_id, created_at DESC);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_outbox_status_created ON outbox(status, created_at);
`

const PHASE_TWO_SCHEMA = `
ALTER TABLE businesses ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'inventory'
  CHECK (tracking_mode IN ('inventory', 'simple_sales'));
ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE stock_movements ADD COLUMN reason TEXT;
CREATE UNIQUE INDEX idx_users_business_username
  ON users(business_id, username COLLATE NOCASE) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX idx_products_business_barcode
  ON products(business_id, barcode) WHERE barcode IS NOT NULL;

CREATE TABLE user_store_permissions (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'manage_business', 'manage_stores', 'manage_employees', 'manage_products',
    'manage_inventory', 'sell', 'view_reports', 'manage_settings'
  )),
  PRIMARY KEY (user_id, store_id, permission)
);
CREATE INDEX idx_user_store_permissions_scope
  ON user_store_permissions(business_id, store_id, user_id);

INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
VALUES ('theme', 'light');

INSERT OR IGNORE INTO user_store_permissions (business_id, user_id, store_id, permission)
SELECT users.business_id, users.id, stores.id, permissions.permission
FROM users
JOIN stores ON stores.business_id = users.business_id
CROSS JOIN (
  SELECT 'manage_business' AS permission UNION ALL
  SELECT 'manage_stores' UNION ALL
  SELECT 'manage_employees' UNION ALL
  SELECT 'manage_products' UNION ALL
  SELECT 'manage_inventory' UNION ALL
  SELECT 'sell' UNION ALL
  SELECT 'view_reports' UNION ALL
  SELECT 'manage_settings'
) AS permissions
WHERE users.role = 'owner';

INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
SELECT 'active_user_id', users.id FROM users
WHERE users.role = 'owner'
ORDER BY users.created_at LIMIT 1;
INSERT OR IGNORE INTO app_settings (setting_key, setting_value)
SELECT 'active_store_id', stores.id FROM stores
ORDER BY stores.created_at LIMIT 1;
`

const PHASE_THREE_SCHEMA = `
ALTER TABLE users ADD COLUMN password_iterations INTEGER NOT NULL DEFAULT 310000
  CHECK (password_iterations >= 10000);
`

const PHASE_FOUR_SCHEMA = `
INSERT OR IGNORE INTO app_settings (setting_key, setting_value) VALUES ('language', 'en');
`

const PHASE_FIVE_SCHEMA = `
CREATE TABLE customers (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

ALTER TABLE sales RENAME TO sales_old;
ALTER TABLE sale_items RENAME TO sale_items_old;
ALTER TABLE payments RENAME TO payments_old;

CREATE TABLE sales (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sale_number TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  cash_tendered_minor INTEGER NOT NULL CHECK (cash_tendered_minor >= 0),
  change_minor INTEGER NOT NULL CHECK (change_minor >= 0),
  sync_state TEXT NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending', 'synced', 'failed', 'conflict')),
  created_at TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name_snapshot TEXT,
  paid_minor INTEGER NOT NULL CHECK (paid_minor >= 0 AND paid_minor <= total_minor),
  balance_due_minor INTEGER NOT NULL CHECK (balance_due_minor >= 0 AND paid_minor + balance_due_minor = total_minor),
  UNIQUE (business_id, sale_number)
);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  variant_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('cash', 'mobile_money', 'bank', 'credit')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'failed', 'credit')),
  created_at TEXT NOT NULL
);

INSERT INTO sales
  (id, business_id, store_id, actor_id, sale_number, subtotal_minor, discount_minor, total_minor,
   cash_tendered_minor, change_minor, sync_state, created_at, customer_id, customer_name_snapshot,
   paid_minor, balance_due_minor)
SELECT id, business_id, store_id, actor_id, sale_number, subtotal_minor, discount_minor, total_minor,
       cash_tendered_minor, change_minor, sync_state, created_at, NULL, NULL, total_minor, 0
FROM sales_old;
INSERT INTO sale_items SELECT * FROM sale_items_old;
INSERT INTO payments SELECT * FROM payments_old;

DROP TABLE sale_items_old;
DROP TABLE payments_old;
DROP TABLE sales_old;

CREATE INDEX idx_sales_business_created ON sales(business_id, created_at DESC);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

CREATE TABLE customer_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('debt', 'payment')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  sale_id TEXT REFERENCES sales(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_customer_ledger_balance ON customer_ledger(business_id, store_id, customer_id);

CREATE TABLE supplier_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('bill', 'payment')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_supplier_ledger_balance ON supplier_ledger(business_id, store_id, supplier_id);
`

const PHASE_SIX_SCHEMA = `
CREATE TABLE cashbook_entries (
  id TEXT PRIMARY KEY NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'sale', 'customer_collection', 'supplier_payment')),
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  note TEXT NOT NULL DEFAULT '',
  reference_id TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_cashbook_store_created ON cashbook_entries(business_id, store_id, created_at DESC);

INSERT INTO cashbook_entries
  (id, business_id, store_id, entry_type, source, category, amount_minor, reference_id, actor_id, created_at)
SELECT 'legacy-sale-' || payments.id, payments.business_id, payments.store_id, 'income', 'sale',
       'Sale', payments.amount_minor, payments.sale_id, sales.actor_id, payments.created_at
FROM payments
JOIN sales ON sales.id = payments.sale_id
WHERE payments.method = 'cash' AND payments.status = 'confirmed' AND payments.amount_minor > 0;

INSERT INTO cashbook_entries
  (id, business_id, store_id, entry_type, source, category, amount_minor, note, reference_id, actor_id, created_at)
SELECT 'legacy-customer-payment-' || customer_ledger.id, customer_ledger.business_id,
       customer_ledger.store_id, 'income', 'customer_collection', 'Customer collection',
       customer_ledger.amount_minor, customer_ledger.note, customer_ledger.id,
       customer_ledger.actor_id, customer_ledger.created_at
FROM customer_ledger
WHERE customer_ledger.entry_type = 'payment';

INSERT INTO cashbook_entries
  (id, business_id, store_id, entry_type, source, category, amount_minor, note, reference_id, actor_id, created_at)
SELECT 'legacy-supplier-payment-' || supplier_ledger.id, supplier_ledger.business_id,
       supplier_ledger.store_id, 'expense', 'supplier_payment', 'Supplier payment',
       supplier_ledger.amount_minor, supplier_ledger.note, supplier_ledger.id,
       supplier_ledger.actor_id, supplier_ledger.created_at
FROM supplier_ledger
WHERE supplier_ledger.entry_type = 'payment';
`

export async function migrateDatabase(database: SQLiteDatabase): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;')

  const { user_version: currentVersion } = await database.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  ) ?? { user_version: 0 }

  if (currentVersion > 6) {
    throw new Error(`Database version ${currentVersion} is newer than this application supports.`)
  }

  if (currentVersion === 0) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(INITIAL_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 1;')
    })
  }

  if (currentVersion < 2) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(PHASE_TWO_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 2;')
    })
  }

  if (currentVersion < 3) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(PHASE_THREE_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 3;')
    })
  }

  if (currentVersion < 4) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(PHASE_FOUR_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 4;')
    })
  }

  if (currentVersion < 5) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(PHASE_FIVE_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 5;')
    })
  }

  if (currentVersion < 6) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.execAsync(PHASE_SIX_SCHEMA)
      await transaction.execAsync('PRAGMA user_version = 6;')
    })
  }
}
