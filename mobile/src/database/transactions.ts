import { Platform } from 'react-native'
import type { SQLiteDatabase } from 'expo-sqlite'

/** Use Expo SQLite's supported transaction API on web and retain exclusive transactions on native. */
export function withDatabaseTransaction(
  database: SQLiteDatabase,
  task: (transaction: SQLiteDatabase) => Promise<void>,
): Promise<void> {
  if (Platform.OS === 'web') {
    return database.withTransactionAsync(() => task(database))
  }
  return database.withExclusiveTransactionAsync(task)
}
