import type { SQLiteDatabase } from 'expo-sqlite'
import { ApiError, authenticatedApiRequest, hasOnlineSession, type SyncPushResult } from './api.ts'
import { downloadRemoteCatalog } from './remoteCatalog.ts'
import type { Workspace } from '../repositories/workspace.ts'

interface OutboxRow {
  client_id: string
  entity_type: string
  entity_id: string
  payload_json: string
}

interface RegisteredDevice {
  id: string
}

export interface SyncSummary {
  synced: number
  failed: number
  pending: number
  failureMessage: string | null
}

let syncInProgress: Promise<SyncSummary> | null = null

function deviceSettingKey(businessId: string, userId: string): string {
  return `sync_device_id:${businessId}:${userId}`
}

export async function syncWorkspaceOutbox(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<SyncSummary> {
  if (syncInProgress) return syncInProgress
  syncInProgress = performSync(database, workspace)
  try {
    return await syncInProgress
  } finally {
    syncInProgress = null
  }
}

async function performSync(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<SyncSummary> {
  const activeContext = await database.getFirstAsync<{ setting_value: string }>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
  )
  if (activeContext?.setting_value !== 'online' || !(await hasOnlineSession())) {
    throw new Error('Sign in to an online business workspace before syncing.')
  }

  const stores = await database.getAllAsync<{ id: string }>(
    'SELECT id FROM stores WHERE business_id = ? AND is_active = 1',
    workspace.businessId,
  )
  await downloadRemoteCatalog(database, workspace.businessId, stores.map((store) => store.id), false)
  const rows = await database.getAllAsync<OutboxRow>(
    `SELECT client_id, entity_type, entity_id, payload_json
     FROM outbox
     WHERE business_id = ? AND status IN ('pending', 'failed', 'in_progress')
     ORDER BY CASE entity_type
       WHEN 'customer' THEN 0
       WHEN 'supplier' THEN 1
       WHEN 'customer_ledger' THEN 2
       WHEN 'supplier_ledger' THEN 3
       WHEN 'sale' THEN 4
       ELSE 5
     END, created_at ASC, rowid ASC
     LIMIT 100`,
    workspace.businessId,
  )
  if (rows.length === 0) return { synced: 0, failed: 0, pending: 0, failureMessage: null }

  const items = rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    return {
      ...payload,
      clientId: row.client_id,
      entity_type: row.entity_type,
      entryId: row.entity_id,
      store_id: payload.store_id ?? payload.storeId,
    }
  })
  const deviceId = await getOrRegisterDevice(database, workspace.businessId, workspace.userId)
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const row of rows) {
      await transaction.runAsync(
        `UPDATE outbox SET status = 'in_progress', attempt_count = attempt_count + 1,
         last_error = NULL WHERE client_id = ? AND business_id = ?`,
        row.client_id,
        workspace.businessId,
      )
    }
  })

  let results: SyncPushResult[]
  try {
    results = await pushItems(database, workspace.businessId, deviceId.id, items)
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 404) {
      await database.runAsync(
        'DELETE FROM app_settings WHERE setting_key = ?',
        deviceSettingKey(workspace.businessId, workspace.userId),
      )
      try {
        const replacement = await getOrRegisterDevice(database, workspace.businessId, workspace.userId)
        results = await pushItems(database, workspace.businessId, replacement.id, items)
      } catch (retryError) {
        await markBatchFailed(database, rows, workspace.businessId, retryError)
        throw retryError
      }
    } else {
      await markBatchFailed(database, rows, workspace.businessId, reason)
      throw reason
    }
  }

  const resultByClientId = new Map(results.map((result) => [result.client_id, result]))
  let synced = 0
  let failed = 0
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const row of rows) {
      const result = resultByClientId.get(row.client_id)
      const status = result?.state === 'synced' ? 'synced' : 'failed'
      const message = status === 'synced'
        ? null
        : result?.message ?? 'The server did not return a result for this sync item.'
      await transaction.runAsync(
        `UPDATE outbox SET status = ?, last_error = ? WHERE client_id = ? AND business_id = ?`,
        status,
        message,
        row.client_id,
        workspace.businessId,
      )
      if (row.entity_type === 'sale') {
        await transaction.runAsync(
          'UPDATE sales SET sync_state = ? WHERE id = ? AND business_id = ?',
          status,
          row.entity_id,
          workspace.businessId,
        )
      }
      if (status === 'synced') synced += 1
      else failed += 1
    }
  })
  const remaining = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox
     WHERE business_id = ? AND status IN ('pending', 'in_progress')`,
    workspace.businessId,
  )
  const failureMessage = results.find((result) => result.state !== 'synced')?.message ?? null
  return {
    synced,
    failed,
    pending: Number(remaining?.count ?? 0),
    failureMessage: failureMessage?.slice(0, 240) ?? null,
  }
}

async function getOrRegisterDevice(
  database: SQLiteDatabase,
  businessId: string,
  userId: string,
): Promise<RegisteredDevice> {
  const settingKey = deviceSettingKey(businessId, userId)
  const stored = await database.getFirstAsync<{ setting_value: string }>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    settingKey,
  )
  if (stored?.setting_value) return { id: stored.setting_value }
  const device = await authenticatedApiRequest<RegisteredDevice>(
    database,
    '/sync/devices',
    {
      method: 'POST',
      body: JSON.stringify({
        device_name: 'shopflow-mobile',
        device_type: 'mobile',
        platform: 'expo',
      }),
    },
    { businessId },
  )
  await database.runAsync(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    settingKey,
    device.id,
  )
  return device
}

async function pushItems(
  database: SQLiteDatabase,
  businessId: string,
  deviceId: string,
  items: Array<Record<string, unknown>>,
): Promise<SyncPushResult[]> {
  return authenticatedApiRequest<SyncPushResult[]>(
    database,
    '/sync/push',
    { method: 'POST', body: JSON.stringify({ items }) },
    { businessId, deviceId },
  )
}

async function markBatchFailed(
  database: SQLiteDatabase,
  rows: OutboxRow[],
  businessId: string,
  reason: unknown,
): Promise<void> {
  const message = reason instanceof Error ? reason.message : String(reason)
  await database.withExclusiveTransactionAsync(async (transaction) => {
    for (const row of rows) {
      await transaction.runAsync(
        `UPDATE outbox SET status = 'failed', last_error = ?
         WHERE client_id = ? AND business_id = ?`,
        message,
        row.client_id,
        businessId,
      )
      if (row.entity_type === 'sale') {
        await transaction.runAsync(
          `UPDATE sales SET sync_state = 'failed' WHERE id = ? AND business_id = ?`,
          row.entity_id,
          businessId,
        )
      }
    }
  })
}
