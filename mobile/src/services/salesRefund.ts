import type { SQLiteDatabase } from 'expo-sqlite'
import type { SaleDetail, SaleRefundRequest } from '../repositories/sales.ts'
import {
  completeSaleRefund,
  getSaleRefundRequest,
  prepareSaleRefund,
} from '../repositories/sales.ts'
import { assertPermission, type Workspace } from '../repositories/workspace.ts'
import { authenticatedApiRequest, hasOnlineSession } from './api.ts'
import { refreshRemoteStock } from './remoteCatalog.ts'

interface RemoteSale {
  id: string
  store_id: string
  status: string
  balance_due: string | number
  idempotency_key: string | null
}

interface RemoteRefund {
  refund_amount: string | number
  status: string
}

export async function refundSaleOnline(
  database: SQLiteDatabase,
  workspace: Workspace,
  sale: SaleDetail,
  reason: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'sell')
  const cleanReason = reason.trim()
  if (cleanReason.length < 2 || cleanReason.length > 220) {
    throw new Error('Refund reason must be 2 to 220 characters.')
  }
  if (sale.syncState !== 'synced') {
    throw new Error('Sync this sale before requesting a refund.')
  }
  if (sale.balanceDueMinor !== 0 || sale.paidMinor !== sale.totalMinor) {
    throw new Error('Only fully paid sales can be refunded from mobile.')
  }
  if (!(await hasOnlineSession())) throw new Error('Sign in to the online business workspace before refunding a sale.')
  const activeContext = await database.getFirstAsync<{ setting_value: string }>(
    "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
  )
  if (activeContext?.setting_value !== 'online') {
    throw new Error('Select the online business workspace before refunding a sale.')
  }
  const context = { businessId: workspace.businessId, storeId: workspace.storeId }
  let pending = await getSaleRefundRequest(database, workspace, sale.id)
  if (pending && pending.amountMinor > 0) {
    await refreshRemoteStock(database, workspace.businessId, [workspace.storeId])
    return
  }

  if (!pending) {
    const remoteSales = await authenticatedApiRequest<RemoteSale[]>(
      database,
      `/sales?store_id=${encodeURIComponent(workspace.storeId)}`,
      {},
      context,
    )
    const remoteSale = remoteSales.find(
      (candidate) => candidate.idempotency_key === sale.id && candidate.store_id === workspace.storeId,
    )
    if (!remoteSale) throw new Error('The synced sale could not be found on the server.')
    if (remoteSale.status === 'refunded') throw new Error('This sale has already been refunded on the server.')
    if (Number(remoteSale.balance_due) !== 0) {
      throw new Error('Only fully paid sales can be refunded from mobile.')
    }
    pending = await prepareSaleRefund(database, workspace, {
      saleId: sale.id,
      serverSaleId: remoteSale.id,
      reason: cleanReason,
      idempotencyKey: `mobile-full-refund:${sale.id}`,
    }, createId)
  }

  const refund = await authenticatedApiRequest<RemoteRefund>(
    database,
    `/sales/${encodeURIComponent(pending.serverSaleId)}/refund`,
    {
      method: 'POST',
      body: JSON.stringify({
        reason: pending.reason,
        idempotency_key: pending.idempotencyKey,
      }),
    },
    context,
  )
  const amountMinor = Number(refund.refund_amount)
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error('The server returned a refund amount this mobile release cannot represent.')
  }
  const completed: SaleRefundRequest = {
    ...pending,
    amountMinor,
    status: refund.status,
  }
  await completeSaleRefund(database, workspace, completed, createId)

  try {
    await refreshRemoteStock(database, workspace.businessId, [workspace.storeId])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Refund was recorded, but server stock could not be refreshed: ${message}`)
  }
}
