import type { SQLiteDatabase } from 'expo-sqlite'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertAnyPermission, assertPermission } from './workspace.ts'

export type CashbookEntryType = 'income' | 'expense'
export type CashbookSource = 'manual' | 'sale' | 'customer_collection' | 'supplier_payment'

export interface CashbookEntry {
  id: string
  entryType: CashbookEntryType
  source: CashbookSource
  category: string
  amountMinor: number
  note: string
  createdAt: string
}

export interface LocalReport {
  days: number
  salesTotalMinor: number
  salesCount: number
  incomeMinor: number
  expenseMinor: number
  netCashMinor: number
  customerDebtMinor: number
  supplierPayableMinor: number
  topProducts: Array<{ name: string; quantity: number; totalMinor: number }>
}

export interface CashbookTotals {
  incomeMinor: number
  expenseMinor: number
}

export interface CashbookEntryFilter {
  days?: 7 | 30 | 90
  search?: string
}

export interface OpeningBalance {
  entryType: CashbookEntryType
  amountMinor: number
  createdAt: string
}

export async function getOpeningBalance(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<OpeningBalance | null> {
  await assertActiveWorkspace(database, workspace)
  await assertCashbookPermission(database, workspace)
  return database.getFirstAsync<OpeningBalance>(
    `SELECT entry_type AS entryType, amount_minor AS amountMinor, created_at AS createdAt
     FROM cashbook_entries
     WHERE business_id = ? AND store_id = ? AND reference_id = 'opening-balance'
     LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
  )
}

export async function recordOpeningBalance(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: { entryType: CashbookEntryType; amountMinor: number; note: string },
  createId: () => string,
): Promise<void> {
  await assertAnyPermission(database, workspace, ['manage_settings', 'manage_finance'])
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Opening balance must be a positive whole TZS amount.')
  }
  const note = input.note.trim()
  if (note.length > 240) throw new Error('Note must be at most 240 characters.')
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{ id: string }>(
      `SELECT id FROM cashbook_entries
       WHERE business_id = ? AND store_id = ? AND reference_id = 'opening-balance'`,
      workspace.businessId,
      workspace.storeId,
    )
    if (existing) throw new Error('The opening balance has already been set for this store.')
    await writeCashbookEntry(transaction, workspace, {
      entryType: input.entryType,
      source: 'manual',
      category: 'Opening balance',
      amountMinor: input.amountMinor,
      note,
      referenceId: 'opening-balance',
      createdAt: new Date().toISOString(),
    }, createId)
  })
}

export async function reconcileCashbook(
  database: SQLiteDatabase,
  workspace: Workspace,
  countedBalanceMinor: number,
  note: string,
  createId: () => string,
): Promise<number> {
  await assertAnyPermission(database, workspace, ['manage_settings', 'manage_finance'])
  if (!Number.isSafeInteger(countedBalanceMinor) || countedBalanceMinor < 0) {
    throw new Error('Counted cash must be a non-negative whole TZS amount.')
  }
  const cleanNote = note.trim()
  if (cleanNote.length < 2 || cleanNote.length > 240) {
    throw new Error('Enter a reconciliation note of 2 to 240 characters.')
  }
  let difference = 0
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const totals = await transaction.getFirstAsync<CashbookTotals>(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount_minor ELSE 0 END), 0) AS incomeMinor,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expenseMinor
       FROM cashbook_entries
       WHERE business_id = ? AND store_id = ?`,
      workspace.businessId,
      workspace.storeId,
    )
    difference = countedBalanceMinor - (
      Number(totals?.incomeMinor ?? 0) - Number(totals?.expenseMinor ?? 0)
    )
    if (difference === 0) return
    await writeCashbookEntry(transaction, workspace, {
      entryType: difference > 0 ? 'income' : 'expense',
      source: 'manual',
      category: 'Reconciliation adjustment',
      amountMinor: Math.abs(difference),
      note: cleanNote,
      referenceId: `reconciliation-${createId()}`,
      createdAt: new Date().toISOString(),
    }, createId)
  })
  return difference
}

export async function getCashbookTotals(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<CashbookTotals> {
  await assertActiveWorkspace(database, workspace)
  await assertCashbookPermission(database, workspace)
  const totals = await database.getFirstAsync<CashbookTotals>(
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount_minor ELSE 0 END), 0) AS incomeMinor,
       COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expenseMinor
     FROM cashbook_entries
     WHERE business_id = ? AND store_id = ?`,
    workspace.businessId,
    workspace.storeId,
  )
  return totals ?? { incomeMinor: 0, expenseMinor: 0 }
}

export async function listCashbookEntries(
  database: SQLiteDatabase,
  workspace: Workspace,
  filter: CashbookEntryFilter = {},
): Promise<CashbookEntry[]> {
  await assertActiveWorkspace(database, workspace)
  await assertCashbookPermission(database, workspace)
  const clauses = ['business_id = ?', 'store_id = ?']
  const values: (string | number)[] = [workspace.businessId, workspace.storeId]
  if (filter.days) {
    clauses.push('created_at >= ?')
    values.push(new Date(Date.now() - filter.days * 24 * 60 * 60 * 1000).toISOString())
  }
  const search = filter.search?.trim()
  if (search) {
    clauses.push('(category LIKE ? COLLATE NOCASE OR note LIKE ? COLLATE NOCASE)')
    values.push(`%${search}%`, `%${search}%`)
  }
  return database.getAllAsync<CashbookEntry>(
    `SELECT id, entry_type AS entryType, source, category, amount_minor AS amountMinor,
       note, created_at AS createdAt
     FROM cashbook_entries
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 200`,
    ...values,
  )
}

export function cashbookEntriesToCsv(entries: CashbookEntry[]): string {
  const fields: Array<keyof CashbookEntry> = ['createdAt', 'entryType', 'source', 'category', 'amountMinor', 'note']
  const quote = (value: string | number) => {
    const text = String(value)
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return [
    fields.join(','),
    ...entries.map((entry) => fields.map((field) => quote(entry[field])).join(',')),
  ].join('\r\n')
}

async function assertCashbookPermission(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<void> {
  if (workspace.role === 'owner') return
  const allowed = await database.getFirstAsync<{ allowed: number }>(
    `SELECT 1 AS allowed
     FROM user_store_permissions
     WHERE business_id = ? AND store_id = ? AND user_id = ?
       AND permission IN ('sell', 'manage_inventory', 'view_reports', 'manage_settings', 'manage_finance')
     LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
    workspace.userId,
  )
  if (!allowed) {
    throw new Error('You do not have permission to view cashbook entries in the selected store.')
  }
}

export async function createManualCashbookEntry(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: { entryType: CashbookEntryType; category: string; amountMinor: number; note: string },
  createId: () => string,
): Promise<void> {
  await assertAnyPermission(database, workspace, [
    'manage_finance',
    input.entryType === 'income' ? 'sell' : 'manage_inventory',
  ])
  const category = input.category.trim()
  const note = input.note.trim()
  if (!['income', 'expense'].includes(input.entryType)) throw new Error('Choose income or expense.')
  if (category.length < 2 || category.length > 60) throw new Error('Category must be 2 to 60 characters.')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Enter a positive whole TZS amount.')
  }
  if (note.length > 240) throw new Error('Note must be at most 240 characters.')

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await writeCashbookEntry(transaction, workspace, {
      entryType: input.entryType,
      source: 'manual',
      category,
      amountMinor: input.amountMinor,
      note,
      referenceId: null,
      createdAt: new Date().toISOString(),
    }, createId)
  })
}

export async function writeCashbookEntry(
  transaction: SQLiteDatabase,
  workspace: Workspace,
  input: {
    entryType: CashbookEntryType
    source: CashbookSource
    category: string
    amountMinor: number
    note?: string
    referenceId?: string | null
    createdAt: string
  },
  createId: () => string,
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Cashbook entries require a positive whole TZS amount.')
  }
  const entryId = createId()
  const outboxId = createId()
  const note = input.note ?? ''
  await transaction.runAsync(
    `INSERT INTO cashbook_entries
       (id, business_id, store_id, entry_type, source, category, amount_minor, note, reference_id, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    workspace.businessId,
    workspace.storeId,
    input.entryType,
    input.source,
    input.category,
    input.amountMinor,
    note,
    input.referenceId ?? null,
    workspace.userId,
    input.createdAt,
  )
  const payload = JSON.stringify({
    clientId: outboxId,
    businessId: workspace.businessId,
    storeId: workspace.storeId,
    actorId: workspace.userId,
    entryId,
    ...input,
    note,
  })
  await transaction.runAsync(
    `INSERT INTO outbox
       (id, client_id, business_id, entity_type, entity_id, operation, payload_json, created_at)
     VALUES (?, ?, ?, 'cashbook_entry', ?, 'create', ?, ?)`,
    outboxId,
    outboxId,
    workspace.businessId,
    entryId,
    payload,
    input.createdAt,
  )
}

export async function getLocalReport(
  database: SQLiteDatabase,
  workspace: Workspace,
  days: 7 | 30 | 90 = 30,
): Promise<LocalReport> {
  await assertPermission(database, workspace, 'view_reports')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const [sales, cashbook, debts, payables, topProducts] = await Promise.all([
    database.getFirstAsync<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(total_minor), 0) AS total, COUNT(*) AS count
       FROM sales
       WHERE business_id = ? AND store_id = ? AND created_at >= ?`,
      workspace.businessId,
      workspace.storeId,
      since,
    ),
    database.getFirstAsync<{ income: number; expense: number }>(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount_minor ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount_minor ELSE 0 END), 0) AS expense
       FROM cashbook_entries
       WHERE business_id = ? AND store_id = ? AND created_at >= ?`,
      workspace.businessId,
      workspace.storeId,
      since,
    ),
    database.getFirstAsync<{ balance: number }>(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'debt' THEN amount_minor ELSE -amount_minor END), 0) AS balance
       FROM customer_ledger WHERE business_id = ? AND store_id = ?`,
      workspace.businessId,
      workspace.storeId,
    ),
    database.getFirstAsync<{ balance: number }>(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'bill' THEN amount_minor ELSE -amount_minor END), 0) AS balance
       FROM supplier_ledger WHERE business_id = ? AND store_id = ?`,
      workspace.businessId,
      workspace.storeId,
    ),
    database.getAllAsync<{ name: string; quantity: number; totalMinor: number }>(
      `SELECT product_name_snapshot AS name, SUM(quantity) AS quantity,
         SUM(line_total_minor) AS totalMinor
       FROM sale_items
       JOIN sales ON sales.id = sale_items.sale_id
       WHERE sales.business_id = ? AND sales.store_id = ? AND sales.created_at >= ?
       GROUP BY product_name_snapshot
       ORDER BY quantity DESC, totalMinor DESC
       LIMIT 5`,
      workspace.businessId,
      workspace.storeId,
      since,
    ),
  ])
  const incomeMinor = Number(cashbook?.income ?? 0)
  const expenseMinor = Number(cashbook?.expense ?? 0)
  return {
    days,
    salesTotalMinor: Number(sales?.total ?? 0),
    salesCount: Number(sales?.count ?? 0),
    incomeMinor,
    expenseMinor,
    netCashMinor: incomeMinor - expenseMinor,
    customerDebtMinor: Number(debts?.balance ?? 0),
    supplierPayableMinor: Number(payables?.balance ?? 0),
    topProducts: topProducts.map((item) => ({
      name: item.name,
      quantity: Number(item.quantity),
      totalMinor: Number(item.totalMinor),
    })),
  }
}
