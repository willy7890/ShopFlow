import type { SQLiteDatabase } from 'expo-sqlite'
import { withDatabaseTransaction } from '../database/transactions.ts'
import { stockAdjustmentInput, type StockAdjustmentInput } from '../domain/validation.ts'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'
import { writeProductAuditEvent } from './productAudit.ts'

export interface StockMovement {
  id: string
  productName: string
  sku: string
  movementType: 'opening' | 'sale' | 'purchase' | 'adjustment' | 'return'
  quantityDelta: number
  reason: string | null
  createdAt: string
}

export async function adjustStock(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: StockAdjustmentInput,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_inventory')
  const parsed = stockAdjustmentInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Stock adjustment is invalid.')
  const variant = await database.getFirstAsync<{
    costPriceMinor: number
    trackStock: number
    productId: string
    productName: string
    categoryId: string | null
    categoryName: string | null
  }>(
    `SELECT product_variants.cost_price_minor AS costPriceMinor,
       product_variants.track_stock AS trackStock, products.id AS productId,
       products.name AS productName, products.category_id AS categoryId,
       categories.name AS categoryName
     FROM product_variants
     JOIN products ON products.id = product_variants.product_id
     LEFT JOIN categories ON categories.id = products.category_id
     WHERE product_variants.id = ? AND product_variants.business_id = ? AND product_variants.is_active = 1`,
    parsed.data.variantId,
    workspace.businessId,
  )
  if (!variant) throw new Error('Product is not available in this business.')
  if (!variant.trackStock) throw new Error('Stock cannot be adjusted while this product is not tracked.')

  const now = new Date().toISOString()
  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      `INSERT OR IGNORE INTO inventory_balances
         (id, business_id, store_id, variant_id, quantity, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
      createId(),
      workspace.businessId,
      workspace.storeId,
      parsed.data.variantId,
      now,
    )
    const update = await transaction.runAsync(
      `UPDATE inventory_balances SET quantity = quantity + ?, updated_at = ?
       WHERE business_id = ? AND store_id = ? AND variant_id = ? AND quantity + ? >= 0`,
      parsed.data.quantityDelta,
      now,
      workspace.businessId,
      workspace.storeId,
      parsed.data.variantId,
      parsed.data.quantityDelta,
    )
    if (update.changes !== 1) throw new Error('Stock reduction exceeds the available quantity.')
    await transaction.runAsync(
      `INSERT INTO stock_movements
         (id, business_id, store_id, variant_id, movement_type, quantity_delta, unit_cost_minor,
          reference_type, reference_id, actor_id, created_at, reason)
       VALUES (?, ?, ?, ?, 'adjustment', ?, ?, 'manual', ?, ?, ?, ?)`,
      createId(),
      workspace.businessId,
      workspace.storeId,
      parsed.data.variantId,
      parsed.data.quantityDelta,
      variant.costPriceMinor,
      parsed.data.reason,
      workspace.userId,
      now,
      parsed.data.reason,
    )
    await writeProductAuditEvent(transaction, {
      id: createId(),
      workspace,
      productId: variant.productId,
      variantId: parsed.data.variantId,
      categoryId: variant.categoryId,
      categoryName: variant.categoryName ?? '',
      eventType: 'stock_adjusted',
      before: { reason: parsed.data.reason },
      after: { quantityDelta: parsed.data.quantityDelta, reason: parsed.data.reason },
      createdAt: now,
    })
  })
}

export async function listRecentMovements(
  database: SQLiteDatabase,
  workspace: Workspace,
  limit = 50,
): Promise<StockMovement[]> {
  await assertActiveWorkspace(database, workspace)
  return database.getAllAsync<StockMovement>(
    `SELECT
       stock_movements.id AS id,
       products.name AS productName,
       product_variants.sku AS sku,
       stock_movements.movement_type AS movementType,
       stock_movements.quantity_delta AS quantityDelta,
       stock_movements.reason AS reason,
       stock_movements.created_at AS createdAt
     FROM stock_movements
     JOIN product_variants ON product_variants.id = stock_movements.variant_id
     JOIN products ON products.id = product_variants.product_id
     WHERE stock_movements.business_id = ? AND stock_movements.store_id = ?
     ORDER BY stock_movements.created_at DESC
     LIMIT ?`,
    workspace.businessId,
    workspace.storeId,
    limit,
  )
}
