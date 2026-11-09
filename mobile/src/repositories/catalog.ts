import type { SQLiteDatabase } from 'expo-sqlite'
import {
  productInput,
  type ProductInput,
} from '../domain/validation.ts'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export interface LocalProduct {
  productId: string
  name: string
  variantId: string
  sku: string
  barcode: string | null
  categoryId: string | null
  categoryName: string | null
  unitCode: string
  costPriceMinor: number
  sellPriceMinor: number
  quantity: number
  lowStockThreshold: number
  trackStock: number
}

export interface Category {
  id: string
  name: string
}

function productQuery(whereClause: string): string {
  return `SELECT
       products.id AS productId,
       products.name,
       products.barcode,
       products.category_id AS categoryId,
       categories.name AS categoryName,
       product_variants.id AS variantId,
       product_variants.sku,
       product_variants.unit_code AS unitCode,
       product_variants.cost_price_minor AS costPriceMinor,
       product_variants.sell_price_minor AS sellPriceMinor,
       COALESCE(inventory_balances.quantity, 0) AS quantity,
       product_variants.low_stock_threshold AS lowStockThreshold,
       product_variants.track_stock AS trackStock
     FROM products
     JOIN product_variants ON product_variants.product_id = products.id
     LEFT JOIN categories ON categories.id = products.category_id
       AND categories.business_id = products.business_id
     LEFT JOIN inventory_balances
       ON inventory_balances.variant_id = product_variants.id
       AND inventory_balances.store_id = ?
     WHERE products.business_id = ?
       AND products.is_active = 1
       AND product_variants.is_active = 1
       ${whereClause}
     ORDER BY products.name COLLATE NOCASE`
}

export async function listProducts(
  database: SQLiteDatabase,
  workspace: Workspace,
  search = '',
): Promise<LocalProduct[]> {
  await assertActiveWorkspace(database, workspace)
  const query = search.trim()
  return database.getAllAsync<LocalProduct>(
    productQuery(`AND (? = '' OR products.name LIKE ? OR product_variants.sku LIKE ?
      OR COALESCE(products.barcode, '') LIKE ? OR COALESCE(categories.name, '') LIKE ?)`),
    workspace.storeId,
    workspace.businessId,
    query,
    `%${query}%`,
    `%${query}%`,
    `%${query}%`,
    `%${query}%`,
  )
}

export async function findProductByBarcode(
  database: SQLiteDatabase,
  workspace: Workspace,
  barcode: string,
): Promise<LocalProduct | null> {
  await assertActiveWorkspace(database, workspace)
  const normalizedBarcode = barcode.trim()
  if (!normalizedBarcode) return null
  return database.getFirstAsync<LocalProduct>(
    productQuery('AND products.barcode = ? COLLATE NOCASE'),
    workspace.storeId,
    workspace.businessId,
    normalizedBarcode,
  )
}

export async function listCategories(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<Category[]> {
  await assertActiveWorkspace(database, workspace)
  return database.getAllAsync<Category>(
    `SELECT id, name FROM categories WHERE business_id = ? ORDER BY name COLLATE NOCASE`,
    workspace.businessId,
  )
}

export async function createCategory(
  database: SQLiteDatabase,
  workspace: Workspace,
  name: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_products')
  const normalized = name.trim()
  if (normalized.length < 2 || normalized.length > 100) {
    throw new Error('Category name must contain 2 to 100 characters.')
  }
  const duplicate = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM categories WHERE business_id = ? AND name = ? COLLATE NOCASE LIMIT 1',
    workspace.businessId,
    normalized,
  )
  if (duplicate) throw new Error('That category already exists in this business.')
  await database.runAsync(
    'INSERT INTO categories (id, business_id, name, created_at) VALUES (?, ?, ?, ?)',
    createId(),
    workspace.businessId,
    normalized,
    new Date().toISOString(),
  )
}

export async function deleteCategory(
  database: SQLiteDatabase,
  workspace: Workspace,
  categoryId: string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_products')
  const result = await database.runAsync(
    'DELETE FROM categories WHERE id = ? AND business_id = ?',
    categoryId,
    workspace.businessId,
  )
  if (result.changes !== 1) throw new Error('Category does not belong to this business.')
}

async function validateCategory(
  database: SQLiteDatabase,
  businessId: string,
  categoryId: string | null | undefined,
): Promise<void> {
  if (!categoryId) return
  const category = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM categories WHERE id = ? AND business_id = ?',
    categoryId,
    businessId,
  )
  if (!category) throw new Error('Choose a category from this business.')
}

async function validateUniqueCodes(
  database: SQLiteDatabase,
  businessId: string,
  sku: string,
  barcode: string | null | undefined,
  exceptProductId?: string,
): Promise<void> {
  const skuExists = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM product_variants
     WHERE business_id = ? AND sku = ? COLLATE NOCASE
       AND product_id != COALESCE(?, '') LIMIT 1`,
    businessId,
    sku.trim(),
    exceptProductId ?? '',
  )
  if (skuExists) throw new Error('That SKU is already in use. Choose another SKU.')
  if (barcode?.trim()) {
    const barcodeExists = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM products WHERE business_id = ? AND barcode = ? COLLATE NOCASE
       AND id != COALESCE(?, '') LIMIT 1`,
      businessId,
      barcode.trim(),
      exceptProductId ?? '',
    )
    if (barcodeExists) throw new Error('That barcode is already assigned to another product.')
  }
}

export async function createProduct(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: ProductInput,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_products')
  const parsed = productInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Product details are invalid.')
  await validateCategory(database, workspace.businessId, parsed.data.categoryId)
  await validateUniqueCodes(database, workspace.businessId, parsed.data.sku, parsed.data.barcode)

  const productId = createId()
  const variantId = createId()
  const balanceId = createId()
  const now = new Date().toISOString()
  const tracking = await database.getFirstAsync<{ trackingMode: string }>(
    'SELECT tracking_mode AS trackingMode FROM businesses WHERE id = ?',
    workspace.businessId,
  )
  const trackStock = tracking?.trackingMode === 'simple_sales' ? 0 : 1
  if (!trackStock && parsed.data.initialQuantity !== 0) {
    throw new Error('Opening stock must be zero while simplified sales mode is enabled.')
  }

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO products (id, business_id, category_id, name, barcode, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      productId,
      workspace.businessId,
      parsed.data.categoryId ?? null,
      parsed.data.name,
      parsed.data.barcode?.trim() || null,
      now,
    )
    await transaction.runAsync(
      `INSERT INTO product_variants
         (id, business_id, product_id, label, sku, unit_code, cost_price_minor, sell_price_minor,
          low_stock_threshold, track_stock, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      variantId,
      workspace.businessId,
      productId,
      parsed.data.name,
      parsed.data.sku.trim(),
      parsed.data.unitCode,
      parsed.data.costPriceMinor,
      parsed.data.sellPriceMinor,
      parsed.data.lowStockThreshold,
      trackStock,
      now,
    )
    if (trackStock) {
      await transaction.runAsync(
        `INSERT INTO inventory_balances (id, business_id, store_id, variant_id, quantity, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        balanceId,
        workspace.businessId,
        workspace.storeId,
        variantId,
        parsed.data.initialQuantity,
        now,
      )
      if (parsed.data.initialQuantity > 0) {
        await transaction.runAsync(
          `INSERT INTO stock_movements
             (id, business_id, store_id, variant_id, movement_type, quantity_delta, unit_cost_minor,
              reference_type, reference_id, actor_id, created_at)
           VALUES (?, ?, ?, ?, 'opening', ?, ?, 'product', ?, ?, ?)`,
          createId(),
          workspace.businessId,
          workspace.storeId,
          variantId,
          parsed.data.initialQuantity,
          parsed.data.costPriceMinor,
          productId,
          workspace.userId,
          now,
        )
      }
    }
  })
}

export async function updateProduct(
  database: SQLiteDatabase,
  workspace: Workspace,
  productId: string,
  variantId: string,
  input: ProductInput,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_products')
  const parsed = productInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Product details are invalid.')
  await validateCategory(database, workspace.businessId, parsed.data.categoryId)
  await validateUniqueCodes(database, workspace.businessId, parsed.data.sku, parsed.data.barcode, productId)

  const existing = await database.getFirstAsync<{ id: string }>(
    `SELECT product_variants.id FROM product_variants
     JOIN products ON products.id = product_variants.product_id
     WHERE products.id = ? AND product_variants.id = ? AND products.business_id = ?`,
    productId,
    variantId,
    workspace.businessId,
  )
  if (!existing) throw new Error('Product does not belong to this business.')

  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.runAsync(
      `UPDATE products SET category_id = ?, name = ?, barcode = ?
       WHERE id = ? AND business_id = ?`,
      parsed.data.categoryId ?? null,
      parsed.data.name,
      parsed.data.barcode?.trim() || null,
      productId,
      workspace.businessId,
    )
    await transaction.runAsync(
      `UPDATE product_variants SET label = ?, sku = ?, unit_code = ?, cost_price_minor = ?,
       sell_price_minor = ?, low_stock_threshold = ? WHERE id = ? AND business_id = ?`,
      parsed.data.name,
      parsed.data.sku.trim(),
      parsed.data.unitCode,
      parsed.data.costPriceMinor,
      parsed.data.sellPriceMinor,
      parsed.data.lowStockThreshold,
      variantId,
      workspace.businessId,
    )
  })
}
