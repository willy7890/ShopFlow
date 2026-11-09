import type { Method, SaleItem } from '@/api/types'

export interface PayRow { method: Method; amount: string }
export const lineTotal = (l: SaleItem) => l.price * l.qty - Math.min(l.discount || 0, l.price * l.qty)
export function totals(lines: SaleItem[]) {
  const sub = lines.reduce((a, l) => a + l.price * l.qty, 0)
  const total = lines.reduce((a, l) => a + lineTotal(l), 0)
  return { sub, discount: sub - total, total }
}
/** Rows with an empty amount absorb the remainder (first such row only). */
export function effectivePayments(total: number, rows: PayRow[]) {
  const fixed = rows.reduce((a, p) => a + (p.amount === '' ? 0 : +p.amount), 0)
  let used = false
  return rows.map((p) => {
    if (p.amount === '' && !used) { used = true; return { method: p.method, amount: Math.max(total - fixed, 0) } }
    return { method: p.method, amount: p.amount === '' ? 0 : +p.amount }
  })
}
export type PayCheck = '' | 'x_short' | 'x_needc' | 'o_cashonly'
export function validatePayments(total: number, pays: { method: Method; amount: number }[], customer: string, offline: boolean): PayCheck {
  const active = pays.filter((p) => p.amount > 0)
  if (offline && active.some((p) => p.method !== 'cash')) return 'o_cashonly'
  if (Math.round(active.reduce((a, p) => a + p.amount, 0)) !== Math.round(total)) return 'x_short'
  if (active.some((p) => p.method === 'credit') && !customer) return 'x_needc'
  return ''
}
