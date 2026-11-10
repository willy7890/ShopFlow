import type { SQLiteDatabase } from 'expo-sqlite'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export type ProductAuditEventType = 'created' | 'updated' | 'stock_adjusted'

export interface ProductAuditEvent {
  id: string
  productId: string
  productName: string
  variantId: string | null
  sku: string | null
  categoryName: string
  eventType: ProductAuditEventType
  beforeJson: string | null
  afterJson: string
  actorName: string
  createdAt: string
}

export async function writeProductAuditEvent(
  transaction: SQLiteDatabase,
  input: {
    id: string
    workspace: Workspace
    productId: string
    variantId?: string | null
    categoryId?: string | null
    categoryName?: string
    eventType: ProductAuditEventType
    before?: object | null
    after: object
    createdAt: string
  },
): Promise<void> {
  await transaction.runAsync(
    `INSERT INTO product_audit_events
       (id, business_id, store_id, product_id, variant_id, category_id, category_name,
        event_type, before_json, after_json, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.workspace.businessId,
    input.workspace.storeId,
    input.productId,
    input.variantId ?? null,
    input.categoryId ?? null,
    input.categoryName ?? '',
    input.eventType,
    input.before ? JSON.stringify(input.before) : null,
    JSON.stringify(input.after),
    input.workspace.userId,
    input.createdAt,
  )
}

export async function listProductAuditEvents(
  database: SQLiteDatabase,
  workspace: Workspace,
  categoryName?: string,
): Promise<ProductAuditEvent[]> {
  await assertActiveWorkspace(database, workspace)
  if (workspace.role !== 'owner') {
    const allowed = await database.getFirstAsync<{ allowed: number }>(
      `SELECT 1 AS allowed FROM user_store_permissions
       WHERE business_id = ? AND store_id = ? AND user_id = ?
         AND permission IN ('view_reports', 'manage_products', 'manage_inventory')
       LIMIT 1`,
      workspace.businessId,
      workspace.storeId,
      workspace.userId,
    )
    if (!allowed) throw new Error('You do not have permission to view product history in this store.')
  }
  const categoryFilter = categoryName?.trim()
  return database.getAllAsync<ProductAuditEvent>(
    `SELECT events.id, events.product_id AS productId, products.name AS productName,
       events.variant_id AS variantId, product_variants.sku AS sku,
       events.category_name AS categoryName, events.event_type AS eventType,
       events.before_json AS beforeJson, events.after_json AS afterJson,
       COALESCE(users.display_name, '') AS actorName, events.created_at AS createdAt
     FROM product_audit_events AS events
     JOIN products ON products.id = events.product_id
     LEFT JOIN product_variants ON product_variants.id = events.variant_id
     LEFT JOIN users ON users.id = events.actor_id
     WHERE events.business_id = ? AND events.store_id = ?
       AND (? IS NULL OR events.category_name = ?)
     ORDER BY events.created_at DESC, events.id DESC
     LIMIT 200`,
    workspace.businessId,
    workspace.storeId,
    categoryFilter ?? null,
    categoryFilter ?? null,
  )
}
