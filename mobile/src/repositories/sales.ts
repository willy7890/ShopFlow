import type { SQLiteDatabase } from 'expo-sqlite'
import { multiplyMoney } from '../domain/money.ts'
import { cashSaleInput, type CashSaleInput } from '../domain/validation.ts'
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
  const outboxId = createId()
  const now = new Date().toISOString()
  let totalMinor = 0

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const products: SaleProduct[] = []

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

    if (parsed.data.cashTenderedMinor < totalMinor) {
      throw new Error('Cash received must cover the sale total.')
    }
    if (!Number.isSafeInteger(parsed.data.cashTenderedMinor)) {
      throw new Error('Cash received is too large to represent safely.')
    }

    const changeMinor = parsed.data.cashTenderedMinor - totalMinor
    await transaction.runAsync(
      `INSERT INTO sales
         (id, business_id, store_id, actor_id, sale_number, subtotal_minor, discount_minor, total_minor,
          cash_tendered_minor, change_minor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
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
       VALUES (?, ?, ?, ?, 'cash', ?, 'confirmed', ?)`,
      paymentId,
      workspace.businessId,
      workspace.storeId,
      saleId,
      totalMinor,
      now,
    )

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
      cashTenderedMinor: parsed.data.cashTenderedMinor,
      changeMinor,
      payments: [{ method: 'cash', amountMinor: totalMinor, status: 'confirmed' }],
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
    changeMinor: parsed.data.cashTenderedMinor - totalMinor,
  }
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
       COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN total_minor ELSE 0 END), 0) AS todayTotalMinor,
       COALESCE(SUM(CASE WHEN substr(created_at, 1, 10) = ? THEN 1 ELSE 0 END), 0) AS todayCount,
       (SELECT COUNT(*) FROM outbox WHERE business_id = ? AND status = 'pending') AS pendingSyncCount
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
