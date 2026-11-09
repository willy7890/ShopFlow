import type { SQLiteDatabase } from 'expo-sqlite'
import { accountInput } from '../domain/validation.ts'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export interface CustomerAccount {
  id: string
  name: string
  phone: string
  balanceMinor: number
}

export interface SupplierAccount {
  id: string
  name: string
  phone: string
  balanceMinor: number
}

export async function listCustomers(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<CustomerAccount[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'sell')
  return database.getAllAsync<CustomerAccount>(
    `SELECT customers.id, customers.name, customers.phone,
       COALESCE(SUM(CASE
         WHEN customer_ledger.entry_type = 'debt' THEN customer_ledger.amount_minor
         ELSE -customer_ledger.amount_minor
       END), 0) AS balanceMinor
     FROM customers
     LEFT JOIN customer_ledger ON customer_ledger.customer_id = customers.id
       AND customer_ledger.business_id = ? AND customer_ledger.store_id = ?
     WHERE customers.business_id = ?
     GROUP BY customers.id
     ORDER BY customers.name COLLATE NOCASE`,
    workspace.businessId,
    workspace.storeId,
    workspace.businessId,
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
      'SELECT id FROM customers WHERE id = ? AND business_id = ?',
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
  })
}

export async function listSuppliers(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<SupplierAccount[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'manage_inventory')
  return database.getAllAsync<SupplierAccount>(
    `SELECT suppliers.id, suppliers.name, suppliers.phone,
       COALESCE(SUM(CASE
         WHEN supplier_ledger.entry_type = 'bill' THEN supplier_ledger.amount_minor
         ELSE -supplier_ledger.amount_minor
       END), 0) AS balanceMinor
     FROM suppliers
     LEFT JOIN supplier_ledger ON supplier_ledger.supplier_id = suppliers.id
       AND supplier_ledger.business_id = ? AND supplier_ledger.store_id = ?
     WHERE suppliers.business_id = ?
     GROUP BY suppliers.id
     ORDER BY suppliers.name COLLATE NOCASE`,
    workspace.businessId,
    workspace.storeId,
    workspace.businessId,
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
    await assertSupplierExists(transaction, workspace.businessId, supplierId)
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
    await assertSupplierExists(transaction, workspace.businessId, supplierId)
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
  })
}

async function assertSupplierExists(
  database: SQLiteDatabase,
  businessId: string,
  supplierId: string,
): Promise<void> {
  const supplier = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM suppliers WHERE id = ? AND business_id = ?',
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
