import type { SQLiteDatabase } from 'expo-sqlite'

const CURRENT_SCHEMA_VERSION = 11
const REQUIRED_TABLES = ['businesses', 'stores', 'users', 'app_settings']

export async function validateShopFlowBackup(database: SQLiteDatabase): Promise<void> {
  const integrity = await database.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check')
  if (integrity?.integrity_check !== 'ok') {
    throw new Error('The selected file is not a valid, healthy ShopFlow backup.')
  }
  const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  if (!version || version.user_version < 1 || version.user_version > CURRENT_SCHEMA_VERSION) {
    throw new Error('The backup was created by an unsupported ShopFlow database version.')
  }
  const tables = await database.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table'`,
  )
  const tableNames = new Set(tables.map(({ name }) => name))
  if (REQUIRED_TABLES.some((name) => !tableNames.has(name))) {
    throw new Error('The selected file does not contain a ShopFlow database.')
  }
}
