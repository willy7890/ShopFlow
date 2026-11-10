import type { SQLiteDatabase } from 'expo-sqlite'
import { multiplyMoney } from '../domain/money.ts'
import { cashSaleInput, type CashSaleInput } from '../domain/validation.ts'
import { writeCashbookEntry } from './cashbook.ts'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

interface SaleProduct {
  variantId: string
  productName: string
  variantName: string
  sku: string
  sellPriceMinor: number
  costPriceMinor: number
  quantity: number
  trackStock: number
}

export interface CashSaleResult {
  saleId: string
  saleNumber: string
  totalMinor: number
  changeMinor: number
  balanceDueMinor: number
}

export interface SaleHistoryEntry {
  id: string
  saleNumber: string
  totalMinor: number
  paidMinor: number
  balanceDueMinor: number
  customerName: string | null
  createdAt: string
  syncState: 'pending' | 'synced' | 'failed' | 'conflict'
  itemCount: number
  refundMinor: number
}

export interface SalePaymentHistoryEntry {
  id: string
  saleNumber: string
  customerName: string | null
  createdAt: string
  method: 'cash' | 'mobile_money' | 'bank' | 'credit' | 'refund'
  amountMinor: number
  status: 'confirmed' | 'pending' | 'failed' | 'credit'
  reference: string | null
}

export interface SaleDetail extends SaleHistoryEntry {
  cashTenderedMinor: number
  changeMinor: number
  refundMinor: number
  refundStatus: string | null
  refundReason: string | null
  items: Array<{
    id: string
    productName: string
    variantName: string
    sku: string
    quantity: number
    unitPriceMinor: number
    lineTotalMinor: number
  }>
}

export async function createCashSale(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: CashSaleInput,
  createId: () => string,
): Promise<CashSaleResult> {
  await assertPermission(database, workspace, 'sell')
  const parsed = cashSaleInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Sale details are invalid.')

  const saleId = createId()
  const saleNumber = `S-${saleId.slice(0, 8).toUpperCase()}`
  const saleItemIds = parsed.data.items.map(() => createId())
  const paymentId = createId()
  const debtEntryId = createId()
  const outboxId = createId()
  const now = new Date().toISOString()
  let totalMinor = 0
  let customerName: string | null = null
  let paidMinor = 0
  let balanceDueMinor = 0

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const products: SaleProduct[] = []
    if (parsed.data.customerId) {
      const customer = await transaction.getFirstAsync<{ name: string }>(
        'SELECT name FROM customers WHERE id = ? AND business_id = ?',
        parsed.data.customerId ?? null,
        workspace.businessId,
      )
      if (!customer) throw new Error('The selected customer is not available in this business.')
      customerName = customer.name
    }

    for (const item of parsed.data.items) {
      const product = await transaction.getFirstAsync<SaleProduct>(
        `SELECT
           product_variants.id AS variantId,
           products.name AS productName,
           product_variants.label AS variantName,
           product_variants.sku,
           product_variants.sell_price_minor AS sellPriceMinor,
           product_variants.cost_price_minor AS costPriceMinor,
           COALESCE(inventory_balances.quantity, 0) AS quantity,
           product_variants.track_stock AS trackStock
         FROM product_variants
         JOIN products ON products.id = product_variants.product_id
         LEFT JOIN inventory_balances
           ON inventory_balances.variant_id = product_variants.id
           AND inventory_balances.store_id = ?
         WHERE product_variants.id = ?
           AND product_variants.business_id = ?
           AND products.is_active = 1
           AND product_variants.is_active = 1`,
        workspace.storeId,
        item.variantId,
        workspace.businessId,
      )

      if (!product) throw new Error('A product in this sale is no longer available.')
      if (product.trackStock && product.quantity < item.quantity) {
        throw new Error(`${product.productName}: only ${product.quantity} in stock.`)
      }

      totalMinor += multiplyMoney(product.sellPriceMinor, item.quantity)
      if (!Number.isSafeInteger(totalMinor)) throw new Error('Sale total is too large to represent safely.')
      products.push(product)
    }

    if (!Number.isSafeInteger(parsed.data.cashTenderedMinor)) {
      throw new Error('Cash received is too large to represent safely.')
    }
    if (parsed.data.cashTenderedMinor < totalMinor && !parsed.data.customerId) {
      throw new Error('Select a customer to record the unpaid sale balance.')
    }

    paidMinor = Math.min(parsed.data.cashTenderedMinor, totalMinor)
    balanceDueMinor = totalMinor - paidMinor
    const changeMinor = Math.max(parsed.data.cashTenderedMinor - totalMinor, 0)
    await transaction.runAsync(
      `INSERT INTO sales
         (id, business_id, store_id, actor_id, sale_number, subtotal_minor, discount_minor, total_minor,
          cash_tendered_minor, change_minor, created_at, customer_id, customer_name_snapshot,
          paid_minor, balance_due_minor)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      saleId,
      workspace.businessId,
      workspace.storeId,
      workspace.userId,
      saleNumber,
      totalMinor,
      totalMinor,
      parsed.data.cashTenderedMinor,
      changeMinor,
      now,
      parsed.data.customerId ?? null,
      customerName,
      paidMinor,
      balanceDueMinor,
    )

    for (const [index, item] of parsed.data.items.entries()) {
      const product = products[index]
      if (!product) throw new Error('Sale item lookup failed.')

      await transaction.runAsync(
        `INSERT INTO sale_items
           (id, sale_id, variant_id, product_name_snapshot, variant_name_snapshot, sku_snapshot,
            quantity, unit_price_minor, line_total_minor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        saleItemIds[index],
        saleId,
        product.variantId,
        product.productName,
        product.variantName,
        product.sku,
        item.quantity,
        product.sellPriceMinor,
        multiplyMoney(product.sellPriceMinor, item.quantity),
      )

      if (product.trackStock) {
        const update = await transaction.runAsync(
          `UPDATE inventory_balances
           SET quantity = quantity - ?, updated_at = ?
           WHERE business_id = ? AND store_id = ? AND variant_id = ? AND quantity >= ?`,
          item.quantity,
          now,
          workspace.businessId,
          workspace.storeId,
          product.variantId,
          item.quantity,
        )
        if (update.changes !== 1) throw new Error(`${product.productName}: stock changed. Review the cart and try again.`)

        await transaction.runAsync(
          `INSERT INTO stock_movements
             (id, business_id, store_id, variant_id, movement_type, quantity_delta, unit_cost_minor,
              reference_type, reference_id, actor_id, created_at)
           VALUES (?, ?, ?, ?, 'sale', ?, ?, 'sale', ?, ?, ?)`,
          createId(),
          workspace.businessId,
          workspace.storeId,
          product.variantId,
          -item.quantity,
          product.costPriceMinor,
          saleId,
          workspace.userId,
          now,
        )
      }
    }

    await transaction.runAsync(
      `INSERT INTO payments (id, business_id, store_id, sale_id, method, amount_minor, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      paymentId,
      workspace.businessId,
      workspace.storeId,
      saleId,
      paidMinor > 0 ? 'cash' : 'credit',
      paidMinor,
      paidMinor > 0 ? 'confirmed' : 'credit',
      now,
    )

    if (balanceDueMinor > 0) {
      await transaction.runAsync(
        `INSERT INTO customer_ledger
           (id, business_id, store_id, customer_id, entry_type, amount_minor, sale_id, actor_id, created_at)
         VALUES (?, ?, ?, ?, 'debt', ?, ?, ?, ?)`,
        debtEntryId,
        workspace.businessId,
        workspace.storeId,
        parsed.data.customerId ?? null,
        balanceDueMinor,
        saleId,
        workspace.userId,
        now,
      )
    }
    if (paidMinor > 0) {
      await writeCashbookEntry(transaction, workspace, {
        entryType: 'income',
        source: 'sale',
        category: 'Sale',
        amountMinor: paidMinor,
        referenceId: saleId,
        createdAt: now,
      }, createId)
    }

    const payloadItems = parsed.data.items.map((item, index) => {
      const product = products[index]
      if (!product) throw new Error('Sale item lookup failed.')
      return {
        variantId: product.variantId,
        productName: product.productName,
        variantName: product.variantName,
        sku: product.sku,
        quantity: item.quantity,
        unitPriceMinor: product.sellPriceMinor,
        lineTotalMinor: multiplyMoney(product.sellPriceMinor, item.quantity),
      }
    })
    const payload = JSON.stringify({
      clientId: saleId,
      saleNumber,
      businessId: workspace.businessId,
      storeId: workspace.storeId,
      actorId: workspace.userId,
      totalMinor,
      customerId: parsed.data.customerId ?? null,
      customerName,
      paidMinor,
      balanceDueMinor,
      cashTenderedMinor: parsed.data.cashTenderedMinor,
      changeMinor,
      payments: [{ method: paidMinor > 0 ? 'cash' : 'credit', amountMinor: paidMinor, status: paidMinor > 0 ? 'confirmed' : 'credit' }],
      items: payloadItems,
      createdAt: now,
    })
    await transaction.runAsync(
      `INSERT INTO outbox
         (id, client_id, business_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, ?, ?, 'sale', ?, 'create', ?, ?)`,
      outboxId,
      saleId,
      workspace.businessId,
      saleId,
      payload,
      now,
    )
  })

  return {
    saleId,
    saleNumber,
    totalMinor,
    changeMinor: Math.max(parsed.data.cashTenderedMinor - totalMinor, 0),
    balanceDueMinor,
  }
}

export async function listRecentSales(
  database: SQLiteDatabase,
  workspace: Workspace,
  search = '',
): Promise<SaleHistoryEntry[]> {
  await assertSalesVisibility(database, workspace)
  const query = search.trim()
  return database.getAllAsync<SaleHistoryEntry>(
    `SELECT sales.id, sales.sale_number AS saleNumber, sales.total_minor AS totalMinor,
       sales.paid_minor AS paidMinor, sales.balance_due_minor AS balanceDueMinor,
       sales.customer_name_snapshot AS customerName, sales.created_at AS createdAt,
       sales.sync_state AS syncState, COUNT(sale_items.id) AS itemCount,
       COALESCE((SELECT amount_minor FROM sale_refunds
         WHERE sale_refunds.sale_id = sales.id LIMIT 1), 0) AS refundMinor
     FROM sales
     LEFT JOIN sale_items ON sale_items.sale_id = sales.id
     WHERE sales.business_id = ? AND sales.store_id = ?
       AND (? = '' OR sales.sale_number LIKE ? OR COALESCE(sales.customer_name_snapshot, '') LIKE ?)
     GROUP BY sales.id
     ORDER BY sales.created_at DESC, sales.rowid DESC
     LIMIT 100`,
    workspace.businessId,
    workspace.storeId,
    query,
    `%${query}%`,
    `%${query}%`,
  )
}

export async function listSalePayments(
  database: SQLiteDatabase,
  workspace: Workspace,
  search = '',
): Promise<SalePaymentHistoryEntry[]> {
  await assertSalesVisibility(database, workspace)
  const query = search.trim()
  const payments = await database.getAllAsync<SalePaymentHistoryEntry>(
    `SELECT payments.id, sales.sale_number AS saleNumber,
       sales.customer_name_snapshot AS customerName,
       payments.created_at AS createdAt, payments.method,
       payments.amount_minor AS amountMinor, payments.status, NULL AS reference
     FROM payments
     JOIN sales ON sales.id = payments.sale_id
     WHERE payments.business_id = ? AND payments.store_id = ?
       AND (? = '' OR sales.sale_number LIKE ? OR
         COALESCE(sales.customer_name_snapshot, '') LIKE ?)
     ORDER BY payments.created_at DESC, payments.rowid DESC`,
    workspace.businessId,
    workspace.storeId,
    query,
    `%${query}%`,
    `%${query}%`,
  )
  const refunds = await database.getAllAsync<SalePaymentHistoryEntry>(
    `SELECT 'refund-' || sale_refunds.id AS id,
       sales.sale_number AS saleNumber,
       sales.customer_name_snapshot AS customerName,
       sale_refunds.created_at AS createdAt,
       'refund' AS method,
       sale_refunds.amount_minor AS amountMinor,
       'confirmed' AS status,
       NULL AS reference
     FROM sale_refunds
     JOIN sales ON sales.id = sale_refunds.sale_id
     WHERE sale_refunds.business_id = ? AND sale_refunds.store_id = ?
       AND sale_refunds.amount_minor > 0
       AND (? = '' OR sales.sale_number LIKE ? OR
         COALESCE(sales.customer_name_snapshot, '') LIKE ?)
     ORDER BY sale_refunds.created_at DESC, sale_refunds.rowid DESC`,
    workspace.businessId,
    workspace.storeId,
    query,
    `%${query}%`,
    `%${query}%`,
  )
  return [...payments, ...refunds].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getSaleDetail(
  database: SQLiteDatabase,
  workspace: Workspace,
  saleId: string,
): Promise<SaleDetail | null> {
  await assertSalesVisibility(database, workspace)
  const sale = await database.getFirstAsync<Omit<SaleDetail, 'items' | 'refundMinor' | 'refundStatus'>>(
    `SELECT sales.id, sales.sale_number AS saleNumber, sales.total_minor AS totalMinor,
       sales.paid_minor AS paidMinor, sales.balance_due_minor AS balanceDueMinor,
       sales.customer_name_snapshot AS customerName, sales.created_at AS createdAt,
       sales.sync_state AS syncState, sales.cash_tendered_minor AS cashTenderedMinor,
       sales.change_minor AS changeMinor,
       (SELECT COUNT(*) FROM sale_items WHERE sale_id = sales.id) AS itemCount,
       COALESCE((SELECT amount_minor FROM sale_refunds
         WHERE sale_refunds.sale_id = sales.id LIMIT 1), 0) AS refundMinor
     FROM sales
     WHERE sales.id = ? AND sales.business_id = ? AND sales.store_id = ?`,
    saleId,
    workspace.businessId,
    workspace.storeId,
  )
  if (!sale) return null
  const items = await database.getAllAsync<SaleDetail['items'][number]>(
    `SELECT id, product_name_snapshot AS productName, variant_name_snapshot AS variantName,
       sku_snapshot AS sku, quantity, unit_price_minor AS unitPriceMinor,
       line_total_minor AS lineTotalMinor
     FROM sale_items WHERE sale_id = ? ORDER BY rowid`,
    saleId,
  )
  const refund = await database.getFirstAsync<{ amountMinor: number; status: string; reason: string }>(
    `SELECT amount_minor AS amountMinor, status, reason
     FROM sale_refunds
     WHERE sale_id = ? AND business_id = ? AND store_id = ?`,
    saleId,
    workspace.businessId,
    workspace.storeId,
  )
  return {
    ...sale,
    refundMinor: Number(refund?.amountMinor ?? 0),
    refundStatus: refund?.status ?? null,
    refundReason: refund?.reason ?? null,
    items,
  }
}

export interface SaleRefundRequest {
  saleId: string
  serverSaleId: string
  amountMinor: number
  reason: string
  idempotencyKey: string
  status: string
}

export async function getSaleRefundRequest(
  database: SQLiteDatabase,
  workspace: Workspace,
  saleId: string,
): Promise<SaleRefundRequest | null> {
  await assertSalesVisibility(database, workspace)
  return database.getFirstAsync<SaleRefundRequest>(
    `SELECT sale_id AS saleId, server_sale_id AS serverSaleId,
       amount_minor AS amountMinor, reason, idempotency_key AS idempotencyKey, status
     FROM sale_refunds
     WHERE sale_id = ? AND business_id = ? AND store_id = ?`,
    saleId,
    workspace.businessId,
    workspace.storeId,
  )
}

export async function prepareSaleRefund(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: Pick<SaleRefundRequest, 'saleId' | 'serverSaleId' | 'reason' | 'idempotencyKey'>,
  createId: () => string,
): Promise<SaleRefundRequest> {
  await assertPermission(database, workspace, 'sell')
  const reason = input.reason.trim()
  if (reason.length < 2 || reason.length > 220) throw new Error('Refund reason must be 2 to 220 characters.')
  const now = new Date().toISOString()
  let request: SaleRefundRequest | null = null

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const sale = await transaction.getFirstAsync<{ id: string }>(
      'SELECT id FROM sales WHERE id = ? AND business_id = ? AND store_id = ?',
      input.saleId,
      workspace.businessId,
      workspace.storeId,
    )
    if (!sale) throw new Error('The sale is no longer available in the selected store.')

    const existing = await transaction.getFirstAsync<SaleRefundRequest>(
      `SELECT sale_id AS saleId, server_sale_id AS serverSaleId,
         amount_minor AS amountMinor, reason, idempotency_key AS idempotencyKey, status
       FROM sale_refunds
       WHERE sale_id = ? AND business_id = ? AND store_id = ?`,
      input.saleId,
      workspace.businessId,
      workspace.storeId,
    )
    if (existing) {
      if (
        existing.idempotencyKey !== input.idempotencyKey
        || existing.serverSaleId !== input.serverSaleId
        || existing.reason !== reason
      ) {
        throw new Error('This sale already has a different refund request.')
      }
      request = existing
      return
    }

    await transaction.runAsync(
      `INSERT INTO sale_refunds
         (id, business_id, store_id, sale_id, server_sale_id, amount_minor,
          reason, idempotency_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'pending', ?)`,
      createId(),
      workspace.businessId,
      workspace.storeId,
      input.saleId,
      input.serverSaleId,
      reason,
      input.idempotencyKey,
      now,
    )
    request = {
      saleId: input.saleId,
      serverSaleId: input.serverSaleId,
      amountMinor: 0,
      reason,
      idempotencyKey: input.idempotencyKey,
      status: 'pending',
    }
  })
  if (!request) throw new Error('The refund request could not be saved.')
  return request
}

export async function completeSaleRefund(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: SaleRefundRequest,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('The server returned an invalid refund amount.')
  }
  const now = new Date().toISOString()
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const existing = await transaction.getFirstAsync<{
      amountMinor: number
      idempotencyKey: string
      reason: string
      serverSaleId: string
      status: string
    }>(
      `SELECT amount_minor AS amountMinor, idempotency_key AS idempotencyKey,
         reason, server_sale_id AS serverSaleId, status
       FROM sale_refunds
       WHERE sale_id = ? AND business_id = ? AND store_id = ?`,
      input.saleId,
      workspace.businessId,
      workspace.storeId,
    )
    if (
      !existing
      || existing.idempotencyKey !== input.idempotencyKey
      || existing.serverSaleId !== input.serverSaleId
      || existing.reason !== input.reason
    ) {
      throw new Error('The saved refund request no longer matches the server response.')
    }
    if (existing.amountMinor > 0) return

    await transaction.runAsync(
      `UPDATE sale_refunds SET amount_minor = ?, status = ?, created_at = ?
       WHERE sale_id = ? AND business_id = ? AND store_id = ? AND amount_minor = 0`,
      input.amountMinor,
      input.status,
      now,
      input.saleId,
      workspace.businessId,
      workspace.storeId,
    )
    await transaction.runAsync(
      `INSERT INTO cashbook_entries
         (id, business_id, store_id, entry_type, source, category, amount_minor,
          note, reference_id, actor_id, created_at)
       VALUES (?, ?, ?, 'expense', 'manual', 'Sale refund', ?, ?, ?, ?, ?)`,
      createId(),
      workspace.businessId,
      workspace.storeId,
      input.amountMinor,
      input.reason,
      `sale-refund:${input.saleId}`,
      workspace.userId,
      now,
    )
  })
}

async function assertSalesVisibility(database: SQLiteDatabase, workspace: Workspace): Promise<void> {
  const role = await assertActiveWorkspace(database, workspace)
  if (role === 'owner') return
  const allowed = await database.getFirstAsync<{ allowed: number }>(
    `SELECT 1 AS allowed FROM user_store_permissions
     WHERE business_id = ? AND store_id = ? AND user_id = ?
       AND permission IN ('sell', 'view_reports') LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
    workspace.userId,
  )
  if (!allowed) throw new Error('You do not have permission to view sales in the selected store.')
}

export interface SalesSummary {
  todayTotalMinor: number
  todayCount: number
  pendingSyncCount: number
}

export async function getSalesSummary(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<SalesSummary> {
  await assertActiveWorkspace(database, workspace)
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Dar_es_Salaam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const today = `${dateParts.find((part) => part.type === 'year')?.value}-${dateParts.find((part) => part.type === 'month')?.value}-${dateParts.find((part) => part.type === 'day')?.value}`
  const summary = await database.getFirstAsync<SalesSummary>(
    `SELECT
       COALESCE(SUM(CASE WHEN date(created_at, '+3 hours') = ? THEN total_minor ELSE 0 END), 0) AS todayTotalMinor,
       COALESCE(SUM(CASE WHEN date(created_at, '+3 hours') = ? THEN 1 ELSE 0 END), 0) AS todayCount,
       (SELECT COUNT(*) FROM outbox
        WHERE business_id = ? AND status IN ('pending', 'in_progress', 'failed', 'conflict')) AS pendingSyncCount
     FROM sales
     WHERE business_id = ? AND store_id = ?`,
    today,
    today,
    workspace.businessId,
    workspace.businessId,
    workspace.storeId,
  )

  return summary ?? { todayTotalMinor: 0, todayCount: 0, pendingSyncCount: 0 }
}
