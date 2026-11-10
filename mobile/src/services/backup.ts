import { File, Paths } from 'expo-file-system'
import {
  backupDatabaseAsync,
  deserializeDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite'
import { migrateDatabase } from '../database/migrations.ts'
import type { Workspace } from '../repositories/workspace.ts'
import { assertPermission } from '../repositories/workspace.ts'
import { clearOnlineSession } from './api.ts'
import { validateShopFlowBackup } from './backupValidation.ts'

export async function createDatabaseBackup(
  database: SQLiteDatabase,
  workspace: Workspace,
  createId: () => string,
): Promise<File> {
  await assertPermission(database, workspace, 'manage_settings')
  const file = new File(Paths.cache, `shopflow-backup-${createId()}.shopflow`)
  try {
    await file.write(await database.serializeAsync())
    return file
  } catch (error) {
    if (file.exists) await file.delete()
    throw error
  }
}

export async function restoreDatabaseBackup(
  database: SQLiteDatabase,
  workspace: Workspace,
  bytes: Uint8Array,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_settings')
  if (bytes.byteLength === 0) throw new Error('The selected backup file is empty.')

  const imported = await deserializeDatabaseAsync(bytes)
  let safetyCopy: SQLiteDatabase | null = null
  try {
    await validateShopFlowBackup(imported)
    await migrateDatabase(imported)
    await validateShopFlowBackup(imported)
    await imported.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_context', 'local')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    )
    await imported.runAsync(
      "DELETE FROM app_settings WHERE setting_key = 'active_user_id'",
    )
    safetyCopy = await deserializeDatabaseAsync(await database.serializeAsync())
    await clearOnlineSession()
    try {
      await backupDatabaseAsync({
        sourceDatabase: imported,
        destDatabase: database,
      })
      await database.execAsync('PRAGMA foreign_keys = ON;')
      await migrateDatabase(database)
    } catch (error) {
      try {
        await backupDatabaseAsync({
          sourceDatabase: safetyCopy,
          destDatabase: database,
        })
        await database.execAsync('PRAGMA foreign_keys = ON;')
      } catch (rollbackError) {
        const cause = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        throw new Error(`Restore failed and the previous database could not be restored: ${cause}`)
      }
      throw error
    }
  } finally {
    await imported.closeAsync()
    await safetyCopy?.closeAsync()
  }
}
