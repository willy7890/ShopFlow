import type { SQLiteDatabase } from 'expo-sqlite'
import { assertActiveWorkspace, type Workspace } from '../repositories/workspace.ts'

export interface LowStockInsight {
  name: string
  sku: string
  available: number
  threshold: number
}

export interface NotificationItem {
  id: string
  kind: 'low_stock' | 'sales' | 'recommendation'
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
}

export interface LocalInsightSummary {
  todayTotalMinor: number
  todayCount: number
  topSeller: { name: string; units: number } | null
  lowStock: LowStockInsight[]
  recommendation: string
  notifications: NotificationItem[]
}

export async function getLocalInsights(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<LocalInsightSummary> {
  await assertActiveWorkspace(database, workspace)

  const todaySales = await database.getFirstAsync<{ total: number; count: number }>(
    `SELECT
       COALESCE(SUM(sales.total_minor), 0) AS total,
       COUNT(*) AS count
     FROM sales
     WHERE sales.business_id = ?
       AND sales.store_id = ?
       AND date(sales.created_at) = date('now')`,
    workspace.businessId,
    workspace.storeId,
  ) ?? { total: 0, count: 0 }

  const topSeller = await database.getFirstAsync<{ name: string; units: number }>(
    `SELECT
       sale_items.product_name_snapshot AS name,
       SUM(sale_items.quantity) AS units
     FROM sale_items
     JOIN sales ON sales.id = sale_items.sale_id
     WHERE sales.business_id = ?
       AND sales.store_id = ?
       AND sales.created_at >= datetime('now', '-7 days')
     GROUP BY sale_items.product_name_snapshot
     ORDER BY units DESC, name COLLATE NOCASE
     LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
  ) ?? null

  const lowStock = await database.getAllAsync<LowStockInsight>(
    `SELECT
       products.name,
       product_variants.sku,
       COALESCE(inventory_balances.quantity, 0) AS available,
       product_variants.low_stock_threshold AS threshold
     FROM products
     JOIN product_variants ON product_variants.product_id = products.id
     LEFT JOIN inventory_balances
       ON inventory_balances.variant_id = product_variants.id
       AND inventory_balances.store_id = ?
     WHERE products.business_id = ?
       AND products.is_active = 1
       AND product_variants.is_active = 1
       AND COALESCE(inventory_balances.quantity, 0) <= product_variants.low_stock_threshold
     ORDER BY available ASC, products.name COLLATE NOCASE
     LIMIT 5`,
    workspace.storeId,
    workspace.businessId,
  )

  const recommendation = lowStock.length > 0
    ? `Reorder ${lowStock[0].name}: only ${lowStock[0].available} left, threshold ${lowStock[0].threshold}.`
    : topSeller
      ? `${topSeller.name} is selling well; keep at least 10 additional units ready for the next rush.`
      : 'No urgent stock issues. Keep the current product mix steady.'

  const notifications: NotificationItem[] = []

  for (const item of lowStock) {
    notifications.push({
      id: `low-stock-${item.name}-${item.sku}`,
      kind: 'low_stock',
      title: 'Low stock alert',
      message: `${item.name} (${item.sku}) is down to ${item.available} units against a threshold of ${item.threshold}.`,
      severity: item.available === 0 ? 'critical' : 'warning',
    })
  }

  if (topSeller) {
    notifications.push({
      id: `sales-${topSeller.name}`,
      kind: 'sales',
      title: 'Fast-moving item',
      message: `${topSeller.name} has sold ${topSeller.units} units in the last 7 days.`,
      severity: 'info',
    })
  }

  if (notifications.length === 0) {
    notifications.push({
      id: 'recommendation-default',
      kind: 'recommendation',
      title: 'Sales outlook',
      message: recommendation,
      severity: 'info',
    })
  }

  return {
    todayTotalMinor: Number(todaySales.total ?? 0),
    todayCount: Number(todaySales.count ?? 0),
    topSeller: topSeller ? { name: topSeller.name, units: Number(topSeller.units ?? 0) } : null,
    lowStock,
    recommendation,
    notifications,
  }
}

export async function listNotificationQueue(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<NotificationItem[]> {
  const summary = await getLocalInsights(database, workspace)
  return summary.notifications
}
