import type { SQLiteDatabase } from 'expo-sqlite'
import type { Workspace } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export type SyncEntityType =
  | 'sale'
  | 'customer'
  | 'customer_update'
  | 'supplier'
  | 'supplier_update'
  | 'customer_ledger'
  | 'supplier_ledger'
  | 'cashbook_entry'

export type SyncQueueStatus = 'pending' | 'in_progress' | 'failed' | 'conflict'

export interface SyncQueueItem {
  clientId: string
  entityType: SyncEntityType
  operation: string
  status: SyncQueueStatus
  attemptCount: number
  lastError: string | null
  createdAt: string
}

export async function listSyncQueue(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<SyncQueueItem[]> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'manage_settings')
  return database.getAllAsync<SyncQueueItem>(
    `SELECT client_id AS clientId, entity_type AS entityType, operation, status,
       attempt_count AS attemptCount, last_error AS lastError, created_at AS createdAt
     FROM outbox
     WHERE business_id = ?
       AND COALESCE(
         json_extract(payload_json, '$.storeId'),
         json_extract(payload_json, '$.store_id')
       ) = ?
       AND status IN ('pending', 'in_progress', 'failed', 'conflict')
     ORDER BY CASE status
       WHEN 'conflict' THEN 0
       WHEN 'failed' THEN 1
       WHEN 'in_progress' THEN 2
       ELSE 3
     END, created_at DESC
     LIMIT 100`,
    workspace.businessId,
    workspace.storeId,
  )
}

export async function retryFailedSyncItems(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<number> {
  await assertActiveWorkspace(database, workspace)
  await assertPermission(database, workspace, 'manage_settings')
  const context = await database.getFirstAsync<{ setting_value: string }>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
  )
  if (context?.setting_value !== 'online') {
    throw new Error('Switch to an online business workspace before retrying sync items.')
  }
  let changes = 0
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const result = await transaction.runAsync(
      `UPDATE outbox SET status = 'pending', last_error = NULL
       WHERE business_id = ?
         AND COALESCE(
           json_extract(payload_json, '$.storeId'),
           json_extract(payload_json, '$.store_id')
         ) = ?
         AND status = 'failed'`,
      workspace.businessId,
      workspace.storeId,
    )
    changes = result.changes
    await transaction.runAsync(
      `UPDATE sales SET sync_state = 'pending'
       WHERE business_id = ? AND store_id = ? AND sync_state = 'failed'
         AND id IN (
           SELECT entity_id FROM outbox
           WHERE business_id = ? AND status = 'pending' AND entity_type = 'sale'
         )`,
      workspace.businessId,
      workspace.storeId,
      workspace.businessId,
    )
  })
  return changes
}
