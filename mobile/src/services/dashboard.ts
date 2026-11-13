import type { SQLiteDatabase } from 'expo-sqlite'
import type { BackendDashboard, BackendRecentSale } from '../domain/dashboard.ts'
import type { Workspace } from '../repositories/workspace.ts'
import { authenticatedApiRequest } from './api.ts'

export async function fetchMobileDashboard(
  database: SQLiteDatabase,
  workspace: Workspace,
  date: string,
): Promise<BackendDashboard> {
  const query = `?store_id=${encodeURIComponent(workspace.storeId)}&start_date=${date}&end_date=${date}`
  return authenticatedApiRequest<BackendDashboard>(
    database,
    `/reports/mobile-dashboard${query}`,
    { method: 'GET' },
    { businessId: workspace.businessId, storeId: workspace.storeId },
  )
}

export async function fetchRecentSales(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<BackendRecentSale[]> {
  const query = `?store_id=${encodeURIComponent(workspace.storeId)}&limit=5`
  return authenticatedApiRequest<BackendRecentSale[]>(
    database,
    `/sales/recent${query}`,
    { method: 'GET' },
    { businessId: workspace.businessId, storeId: workspace.storeId },
  )
}
