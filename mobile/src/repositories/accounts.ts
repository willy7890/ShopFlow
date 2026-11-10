import type { SQLiteDatabase } from 'expo-sqlite'
import { accountInput } from '../domain/validation.ts'
import { writeCashbookEntry } from './cashbook.ts'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export interface CustomerAccount {
  id: string
  name: string
  phone: string
  balanceMinor: number
  isActive: number
}

export interface SupplierAccount {
  id: string
  name: string
  phone: string
  balanceMinor: number
  isActive: number
}

export interface AccountLedgerEntry {
  id: string
  entryType: 'debt' | 'payment' | 'bill'
  amountMinor: number
  note: string
  createdAt: string
}

export async function listCustomers(
  database: SQLiteDatabase,
  workspace: Workspace,
  includeArchived = false,
): Promise<CustomerAccount[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'sell')
  return database.getAllAsync<CustomerAccount>(
    `SELECT customers.id, customers.name, customers.phone, customers.is_active AS isActive,
       COALESCE(SUM(CASE
         WHEN customer_ledger.entry_type = 'debt' THEN customer_ledger.amount_minor
         ELSE -customer_ledger.amount_minor
       END), 0) AS balanceMinor
     FROM customers
     LEFT JOIN customer_ledger ON customer_ledger.customer_id = customers.id
       AND customer_ledger.business_id = ? AND customer_ledger.store_id = ?
     WHERE customers.business_id = ? AND (? = 1 OR customers.is_active = 1)
     GROUP BY customers.id
     ORDER BY customers.name COLLATE NOCASE`,
    workspace.businessId,
    workspace.storeId,
    workspace.businessId,
    includeArchived ? 1 : 0,
  )
}

export async function updateCustomer(
  database: SQLiteDatabase,
  workspace: Workspace,
  customerId: string,
  input: { name: string; phone?: string },
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  const parsed = accountInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Customer details are invalid.')
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      `UPDATE customers SET name = ?, phone = ?
       WHERE id = ? AND business_id = ? AND is_active = 1`,
      parsed.data.name,
      parsed.data.phone ?? '',
      customerId,
      workspace.businessId,
    )
    if (result.changes !== 1) throw new Error('The active customer is not available in this business.')
    await writeAccountUpdate(transaction, workspace, customerId, 'customer_update', {
      id: customerId,
      name: parsed.data.name,
      phone: parsed.data.phone ?? '',
      isActive: true,
      createdAt: now,
    }, createId, now)
  })
}

export async function setCustomerArchived(
  database: SQLiteDatabase,
  workspace: Workspace,
  customerId: string,
  archived: boolean,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      'UPDATE customers SET is_active = ? WHERE id = ? AND business_id = ?',
      archived ? 0 : 1,
      customerId,
      workspace.businessId,
    )
    if (result.changes !== 1) throw new Error('The customer is not available in this business.')
    await writeAccountUpdate(transaction, workspace, customerId, 'customer_update', {
      id: customerId,
      isActive: !archived,
      createdAt: now,
    }, createId, now)
  })
}

export async function listCustomerLedgerEntries(
  database: SQLiteDatabase,
  workspace: Workspace,
  customerId: string,
): Promise<AccountLedgerEntry[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'sell')
  const customer = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM customers WHERE id = ? AND business_id = ?',
    customerId,
    workspace.businessId,
  )
  if (!customer) throw new Error('The selected customer is not available in this business.')
  return database.getAllAsync<AccountLedgerEntry>(
    `SELECT id, entry_type AS entryType, amount_minor AS amountMinor, note, created_at AS createdAt
     FROM customer_ledger
     WHERE business_id = ? AND store_id = ? AND customer_id = ?
     ORDER BY created_at DESC, id DESC`,
    workspace.businessId,
    workspace.storeId,
    customerId,
  )
}

export async function createCustomer(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: { name: string; phone?: string },
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  const parsed = accountInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Customer details are invalid.')
  const id = createId()
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO customers (id, business_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      workspace.businessId,
      parsed.data.name,
      parsed.data.phone ?? '',
      now,
    )
    await addOutbox(transaction, workspace, id, 'customer', {
      id,
      name: parsed.data.name,
      phone: parsed.data.phone ?? '',
      createdAt: now,
    }, now)
  })
}

export async function recordCustomerPayment(
  database: SQLiteDatabase,
  workspace: Workspace,
  customerId: string,
  amountMinor: number,
  note: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  validateAmount(amountMinor)
  const entryId = createId()
  const outboxId = createId()
  const now = new Date().toISOString()
  const cleanNote = validateNote(note)
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const customer = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM customers WHERE id = ? AND business_id = ? AND is_active = 1',
      customerId,
      workspace.businessId,
    )
    if (!customer) throw new Error('The selected customer is not available in this business.')
    const balance = await transaction.getFirstAsync<{ balanceMinor: number }>(
      `SELECT COALESCE(SUM(CASE
         WHEN entry_type = 'debt' THEN amount_minor ELSE -amount_minor
       END), 0) AS balanceMinor
       FROM customer_ledger
       WHERE business_id = ? AND store_id = ? AND customer_id = ?`,
      workspace.businessId,
      workspace.storeId,
      customerId,
    )
    if (!balance || amountMinor > balance.balanceMinor) {
      throw new Error('Customer payment cannot exceed the outstanding balance.')
    }
    await transaction.runAsync(
      `INSERT INTO customer_ledger
         (id, business_id, store_id, customer_id, entry_type, amount_minor, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, ?)`,
      entryId,
      workspace.businessId,
      workspace.storeId,
      customerId,
      amountMinor,
      cleanNote,
      workspace.userId,
      now,
    )
    await writeOutbox(transaction, workspace, outboxId, entryId, 'customer_ledger', {
      customerId,
      entryType: 'payment',
      amountMinor,
      note: cleanNote,
      createdAt: now,
    }, now)
    await writeCashbookEntry(transaction, workspace, {
      entryType: 'income',
      source: 'customer_collection',
      category: 'Customer collection',
      amountMinor,
      note: cleanNote,
      referenceId: entryId,
      createdAt: now,
    }, createId)
  })
}

export async function listSuppliers(
  database: SQLiteDatabase,
  workspace: Workspace,
  includeArchived = false,
): Promise<SupplierAccount[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'manage_inventory')
  return database.getAllAsync<SupplierAccount>(
    `SELECT suppliers.id, suppliers.name, suppliers.phone, suppliers.is_active AS isActive,
       COALESCE(SUM(CASE
         WHEN supplier_ledger.entry_type = 'bill' THEN supplier_ledger.amount_minor
         ELSE -supplier_ledger.amount_minor
       END), 0) AS balanceMinor
     FROM suppliers
     LEFT JOIN supplier_ledger ON supplier_ledger.supplier_id = suppliers.id
       AND supplier_ledger.business_id = ? AND supplier_ledger.store_id = ?
     WHERE suppliers.business_id = ? AND (? = 1 OR suppliers.is_active = 1)
     GROUP BY suppliers.id
     ORDER BY suppliers.name COLLATE NOCASE`,
    workspace.businessId,
    workspace.storeId,
    workspace.businessId,
    includeArchived ? 1 : 0,
  )
}

export async function updateSupplier(
  database: SQLiteDatabase,
  workspace: Workspace,
  supplierId: string,
  input: { name: string; phone?: string },
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  const parsed = accountInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Supplier details are invalid.')
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      `UPDATE suppliers SET name = ?, phone = ?
       WHERE id = ? AND business_id = ? AND is_active = 1`,
      parsed.data.name,
      parsed.data.phone ?? '',
      supplierId,
      workspace.businessId,
    )
    if (result.changes !== 1) throw new Error('The active supplier is not available in this business.')
    await writeAccountUpdate(transaction, workspace, supplierId, 'supplier_update', {
      id: supplierId,
      name: parsed.data.name,
      phone: parsed.data.phone ?? '',
      isActive: true,
      createdAt: now,
    }, createId, now)
  })
}

export async function setSupplierArchived(
  database: SQLiteDatabase,
  workspace: Workspace,
  supplierId: string,
  archived: boolean,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      'UPDATE suppliers SET is_active = ? WHERE id = ? AND business_id = ?',
      archived ? 0 : 1,
      supplierId,
      workspace.businessId,
    )
    if (result.changes !== 1) throw new Error('The supplier is not available in this business.')
    await writeAccountUpdate(transaction, workspace, supplierId, 'supplier_update', {
      id: supplierId,
      isActive: !archived,
      createdAt: now,
    }, createId, now)
  })
}

export async function listSupplierLedgerEntries(
  database: SQLiteDatabase,
  workspace: Workspace,
  supplierId: string,
): Promise<AccountLedgerEntry[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'manage_inventory')
  await assertSupplierExists(database, workspace.businessId, supplierId)
  return database.getAllAsync<AccountLedgerEntry>(
    `SELECT id, entry_type AS entryType, amount_minor AS amountMinor, note, created_at AS createdAt
     FROM supplier_ledger
     WHERE business_id = ? AND store_id = ? AND supplier_id = ?
     ORDER BY created_at DESC, id DESC`,
    workspace.businessId,
    workspace.storeId,
    supplierId,
  )
}

export async function createSupplier(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: { name: string; phone?: string },
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  const parsed = accountInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Supplier details are invalid.')
  const id = createId()
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO suppliers (id, business_id, name, phone, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      workspace.businessId,
      parsed.data.name,
      parsed.data.phone ?? '',
      now,
    )
    await addOutbox(transaction, workspace, id, 'supplier', {
      id,
      name: parsed.data.name,
      phone: parsed.data.phone ?? '',
      createdAt: now,
    }, now)
  })
}

export async function recordSupplierBill(
  database: SQLiteDatabase,
  workspace: Workspace,
  supplierId: string,
  amountMinor: number,
  note: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  validateAmount(amountMinor)
  const entryId = createId()
  const outboxId = createId()
  const now = new Date().toISOString()
  const cleanNote = validateNote(note)
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertSupplierExists(transaction, workspace.businessId, supplierId, true)
    await transaction.runAsync(
      `INSERT INTO supplier_ledger
         (id, business_id, store_id, supplier_id, entry_type, amount_minor, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, 'bill', ?, ?, ?, ?)`,
      entryId,
      workspace.businessId,
      workspace.storeId,
      supplierId,
      amountMinor,
      cleanNote,
      workspace.userId,
      now,
    )
    await writeOutbox(transaction, workspace, outboxId, entryId, 'supplier_ledger', {
      supplierId,
      entryType: 'bill',
      amountMinor,
      note: cleanNote,
      createdAt: now,
    }, now)
  })
}

export async function recordSupplierPayment(
  database: SQLiteDatabase,
  workspace: Workspace,
  supplierId: string,
  amountMinor: number,
  note: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  validateAmount(amountMinor)
  const entryId = createId()
  const outboxId = createId()
  const now = new Date().toISOString()
  const cleanNote = validateNote(note)
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await assertSupplierExists(transaction, workspace.businessId, supplierId, true)
    const balance = await transaction.getFirstAsync<{ balanceMinor: number }>(
      `SELECT COALESCE(SUM(CASE
         WHEN entry_type = 'bill' THEN amount_minor ELSE -amount_minor
       END), 0) AS balanceMinor
       FROM supplier_ledger
       WHERE business_id = ? AND store_id = ? AND supplier_id = ?`,
      workspace.businessId,
      workspace.storeId,
      supplierId,
    )
    if (!balance || amountMinor > balance.balanceMinor) {
      throw new Error('Supplier payment cannot exceed the outstanding balance.')
    }
    await transaction.runAsync(
      `INSERT INTO supplier_ledger
         (id, business_id, store_id, supplier_id, entry_type, amount_minor, note, actor_id, created_at)
       VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, ?)`,
      entryId,
      workspace.businessId,
      workspace.storeId,
      supplierId,
      amountMinor,
      cleanNote,
      workspace.userId,
      now,
    )
    await writeOutbox(transaction, workspace, outboxId, entryId, 'supplier_ledger', {
      supplierId,
      entryType: 'payment',
      amountMinor,
      note: cleanNote,
      createdAt: now,
    }, now)
    await writeCashbookEntry(transaction, workspace, {
      entryType: 'expense',
      source: 'supplier_payment',
      category: 'Supplier payment',
      amountMinor,
      note: cleanNote,
      referenceId: entryId,
      createdAt: now,
    }, createId)
  })
}

async function assertSupplierExists(
  database: SQLiteDatabase,
  businessId: string,
  supplierId: string,
  requireActive = false,
): Promise<void> {
  const supplier = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM suppliers WHERE id = ? AND business_id = ?
     ${requireActive ? 'AND is_active = 1' : ''}`,
    supplierId,
    businessId,
  )
  if (!supplier) throw new Error('The selected supplier is not available in this business.')
}

function validateAmount(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('Enter a positive whole TZS amount.')
  }
}

function validateNote(note: string): string {
  const cleanNote = note.trim()
  if (cleanNote.length > 240) throw new Error('Note must be at most 240 characters.')
  return cleanNote
}

async function addOutbox(
  transaction: SQLiteDatabase,
  workspace: Workspace,
  entityId: string,
  entityType: string,
  payload: object,
  createdAt: string,
): Promise<void> {
  await writeOutbox(transaction, workspace, entityId, entityId, entityType, payload, createdAt)
}

async function writeAccountUpdate(
  transaction: SQLiteDatabase,
  workspace: Workspace,
  entityId: string,
  entityType: 'customer_update' | 'supplier_update',
  payload: object,
  createId: () => string,
  createdAt: string,
): Promise<void> {
  const clientId = createId()
  await transaction.runAsync(
    `INSERT INTO outbox
       (id, client_id, business_id, entity_type, entity_id, operation, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'update', ?, ?)`,
    clientId,
    clientId,
    workspace.businessId,
    entityType,
    entityId,
    JSON.stringify({
      clientId,
      businessId: workspace.businessId,
      storeId: workspace.storeId,
      actorId: workspace.userId,
      ...payload,
    }),
    createdAt,
  )
}

async function writeOutbox(
  transaction: SQLiteDatabase,
  workspace: Workspace,
  outboxId: string,
  entityId: string,
  entityType: string,
  payload: object,
  createdAt: string,
): Promise<void> {
  await transaction.runAsync(
    `INSERT INTO outbox
       (id, client_id, business_id, entity_type, entity_id, operation, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'create', ?, ?)`,
    outboxId,
    outboxId,
    workspace.businessId,
    entityType,
    entityId,
    JSON.stringify({
      clientId: outboxId,
      businessId: workspace.businessId,
      storeId: workspace.storeId,
      actorId: workspace.userId,
      ...payload,
    }),
    createdAt,
  )
}
