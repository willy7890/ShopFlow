import type { SQLiteDatabase } from 'expo-sqlite'
import { withDatabaseTransaction } from '../database/transactions.ts'
import { authenticatedApiRequest } from './api.ts'

interface RemoteCategory {
  id: string
  name: string
}

interface RemoteUnit {
  id: string
  code: string
}

interface RemoteProduct {
  id: string
  name: string
  category_id: string | null
  is_active: boolean
}

interface RemoteVariant {
  id: string
  product_id: string
  unit_id: string
  name: string
  sku: string
  barcode: string | null
  purchase_price: string | number
  selling_price: string | number
  low_stock_threshold: string | number
  track_stock: boolean
  is_active: boolean
}

interface RemoteBalance {
  variant_id: string
  quantity: string | number
}

function wholeValue(value: string | number, label: string, minimum = 0): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label} must be a whole-number value to use this offline catalog.`)
  }
  return parsed
}

export async function downloadRemoteCatalog(
  database: SQLiteDatabase,
  businessId: string,
  storeIds: string[],
): Promise<Set<string>> {
  const context = { businessId }
  const [categories, units, products, stockByStore] = await Promise.all([
    authenticatedApiRequest<RemoteCategory[]>(database, '/catalog/categories', {}, context),
    authenticatedApiRequest<RemoteUnit[]>(database, '/catalog/units', {}, context),
    authenticatedApiRequest<RemoteProduct[]>(database, '/catalog/products', {}, context),
    Promise.all(storeIds.map(async (storeId) => [
      storeId,
      await authenticatedApiRequest<RemoteBalance[]>(
        database,
        `/inventory/stock?store_id=${encodeURIComponent(storeId)}`,
        {},
        context,
      ),
    ] as const)),
  ])
  const unitCodes = new Map(units.map((unit) => [unit.id, unit.code]))
  const activeProducts = products.filter((product) => product.is_active)
  const variantsByProduct = await Promise.all(activeProducts.map(async (product) => {
    const variants = await authenticatedApiRequest<RemoteVariant[]>(
      database,
      `/catalog/products/${encodeURIComponent(product.id)}/variants`,
      {},
      context,
    )
    return [product.id, variants.filter((variant) => variant.is_active)] as const
  }))
  const productVariants = new Map(variantsByProduct)
  const trackedVariants = new Set(
    variantsByProduct.flatMap(([, variants]) =>
      variants.filter((variant) => variant.track_stock).map((variant) => variant.id)),
  )
  const stockMaps = new Map(stockByStore.map(([storeId, balances]) => [
    storeId,
    new Map(balances.map((balance) => [balance.variant_id, balance.quantity])),
  ]))
  const now = new Date().toISOString()

  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      `UPDATE product_variants SET is_active = 0
       WHERE business_id = ? AND remote_catalog = 1`,
      businessId,
    )
    await transaction.runAsync(
      `UPDATE products SET is_active = 0
       WHERE business_id = ? AND id IN (
         SELECT product_id FROM product_variants
         WHERE business_id = ? AND remote_catalog = 1
       )`,
      businessId,
      businessId,
    )
    const pendingLines = await transaction.getAllAsync<{ payload_json: string }>(
      `SELECT payload_json FROM outbox
       WHERE business_id = ? AND entity_type = 'sale' AND status != 'synced'`,
      businessId,
    )
    const unsyncedQuantities = new Map<string, number>()
    for (const pending of pendingLines) {
      const payload = JSON.parse(pending.payload_json) as {
        storeId?: string
        store_id?: string
        items?: Array<{ variantId?: string; quantity?: number }>
      }
      const pendingStoreId = payload.storeId ?? payload.store_id
      if (!pendingStoreId) continue
      for (const line of payload.items ?? []) {
        if (!line.variantId) continue
        if (!trackedVariants.has(line.variantId)) continue
        const quantity = wholeValue(line.quantity ?? 0, 'Pending-sale quantity')
        const key = `${pendingStoreId}\u0000${line.variantId}`
        unsyncedQuantities.set(
          key,
          (unsyncedQuantities.get(key) ?? 0) + quantity,
        )
      }
    }

    for (const category of categories) {
      await transaction.runAsync(
        `INSERT INTO categories (id, business_id, name, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
        category.id,
        businessId,
        category.name,
        now,
      )
    }

    for (const product of activeProducts) {
      const categoryId = product.category_id && categories.some((category) => category.id === product.category_id)
        ? product.category_id
        : null
      await transaction.runAsync(
        `INSERT INTO products (id, business_id, category_id, name, barcode, is_active, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           category_id = excluded.category_id, name = excluded.name, is_active = excluded.is_active`,
        product.id,
        businessId,
        categoryId,
        product.name,
        1,
        now,
      )
      for (const variant of productVariants.get(product.id) ?? []) {
        const unitCode = unitCodes.get(variant.unit_id)
        if (!unitCode) throw new Error(`Catalog unit ${variant.unit_id} is missing; refresh the business catalog and retry.`)
        const costPrice = wholeValue(variant.purchase_price, `${product.name} cost price`)
        const sellPrice = wholeValue(variant.selling_price, `${product.name} selling price`)
        const lowStockThreshold = wholeValue(variant.low_stock_threshold, `${product.name} low-stock threshold`)
        await transaction.runAsync(
          `INSERT INTO product_variants
             (id, business_id, product_id, label, sku, unit_code, cost_price_minor,
              sell_price_minor, low_stock_threshold, track_stock, is_active, barcode,
              remote_catalog, remote_track_stock, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label, sku = excluded.sku, unit_code = excluded.unit_code,
             cost_price_minor = excluded.cost_price_minor,
             sell_price_minor = excluded.sell_price_minor,
             low_stock_threshold = excluded.low_stock_threshold,
             track_stock = excluded.track_stock, is_active = excluded.is_active,
             barcode = excluded.barcode, remote_catalog = 1,
             remote_track_stock = excluded.remote_track_stock`,
          variant.id,
          businessId,
          product.id,
          variant.name,
          variant.sku,
          unitCode,
          costPrice,
          sellPrice,
          lowStockThreshold,
          variant.track_stock ? 1 : 0,
          1,
          variant.barcode,
          variant.track_stock ? 1 : 0,
          now,
        )
        for (const storeId of storeIds) {
          const serverQuantity = wholeValue(
            stockMaps.get(storeId)?.get(variant.id) ?? 0,
            `${product.name} stock quantity`,
          )
          const unsyncedQuantity = unsyncedQuantities.get(`${storeId}\u0000${variant.id}`) ?? 0
          const localQuantity = Math.max(0, serverQuantity - unsyncedQuantity)
          await transaction.runAsync(
            `INSERT INTO inventory_balances
               (id, business_id, store_id, variant_id, quantity, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(business_id, store_id, variant_id)
             DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
            `remote-${storeId}-${variant.id}`,
            businessId,
            storeId,
            variant.id,
            localQuantity,
            now,
          )
        }
      }
    }
  })
  return trackedVariants
}

export async function refreshRemoteStock(
  database: SQLiteDatabase,
  businessId: string,
  storeIds: string[],
): Promise<Set<string>> {
  const context = { businessId }
  const [trackedRows, stockByStore] = await Promise.all([
    database.getAllAsync<{ id: string }>(
      `SELECT id FROM product_variants
       WHERE business_id = ? AND remote_catalog = 1 AND remote_track_stock = 1 AND is_active = 1`,
      businessId,
    ),
    Promise.all(storeIds.map(async (storeId) => [
      storeId,
      await authenticatedApiRequest<RemoteBalance[]>(
        database,
        `/inventory/stock?store_id=${encodeURIComponent(storeId)}`,
        {},
        context,
      ),
    ] as const)),
  ])
  const trackedVariants = new Set(trackedRows.map((row) => row.id))
  const stockMaps = new Map(stockByStore.map(([storeId, balances]) => [
    storeId,
    new Map(balances.map((balance) => [balance.variant_id, balance.quantity])),
  ]))
  const now = new Date().toISOString()

  await withDatabaseTransaction(database, async (transaction) => {
    const pendingLines = await transaction.getAllAsync<{ payload_json: string }>(
      `SELECT payload_json FROM outbox
       WHERE business_id = ? AND entity_type = 'sale' AND status != 'synced'`,
      businessId,
    )
    const unsyncedQuantities = new Map<string, number>()
    for (const pending of pendingLines) {
      const payload = JSON.parse(pending.payload_json) as {
        storeId?: string
        store_id?: string
        items?: Array<{ variantId?: string; quantity?: number }>
      }
      const pendingStoreId = payload.storeId ?? payload.store_id
      if (!pendingStoreId) continue
      for (const line of payload.items ?? []) {
        if (!line.variantId || !trackedVariants.has(line.variantId)) continue
        const quantity = wholeValue(line.quantity ?? 0, 'Pending-sale quantity')
        const key = `${pendingStoreId}\u0000${line.variantId}`
        unsyncedQuantities.set(key, (unsyncedQuantities.get(key) ?? 0) + quantity)
      }
    }

    for (const storeId of storeIds) {
      for (const variantId of trackedVariants) {
        const serverQuantity = wholeValue(
          stockMaps.get(storeId)?.get(variantId) ?? 0,
          'Stock quantity',
        )
        const unsyncedQuantity = unsyncedQuantities.get(`${storeId}\u0000${variantId}`) ?? 0
        await transaction.runAsync(
          `INSERT INTO inventory_balances
             (id, business_id, store_id, variant_id, quantity, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(business_id, store_id, variant_id)
           DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
          `remote-${storeId}-${variantId}`,
          businessId,
          storeId,
          variantId,
          Math.max(0, serverQuantity - unsyncedQuantity),
          now,
        )
      }
    }
  })
  return trackedVariants
}
