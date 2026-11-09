import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import type { Sale } from '@/api/types'
import { useT } from '@/i18n'
import { Chip, PageHeader, QueryState, Seg, Table } from '@/components/ui'
import { tzs } from '@/lib/utils'
import { useSync } from '@/offline/sync'

export const payStatus = (s: Sale) => (s.voided ? 'void' : s.due <= 0 ? 'paid' : s.paid > 0 ? 'part' : 'unpaid')
export const StatusChip = ({ s }: { s: Sale }) => { const { t } = useT(); const st = payStatus(s); return <Chip kind={st === 'paid' ? 'ok' : st === 'part' ? 'p' : 'e'}>{t('s_' + st)}</Chip> }
export const SyncChip = ({ state }: { state?: string }) => { const { t } = useT(); if (!state || state === 'synced') return null; return <Chip kind={state === 'pending' ? 'p' : 'e'}>{t('o_' + (state === 'pending' ? 'pend' : state))}</Chip> }

export default function Sales() {
  const { t } = useT(); const [tab, setTab] = useState<'sales' | 'pay'>('sales')
  const q = useQuery({ queryKey: ['sales'], queryFn: api.sales.list }); const queue = useSync((s) => s.items)
  const local: Sale[] = queue.filter((i) => i.state !== 'synced').map((i) => ({ no: i.ref ?? i.clientId.slice(0, 6), date: i.at.slice(0, 10), type: i.payload.type, customer: i.payload.customer, total: i.payload.items.reduce((a, l) => a + l.price * l.qty - l.discount, 0), paid: 0, initialPaid: 0, due: 0, methods: ['cash'], items: i.payload.items, payments: [], sync: i.state }))
  const all = [...local, ...(q.data ?? [])]
  const pays = (q.data ?? []).flatMap((s) => s.payments.map((p) => ({ date: s.date, inv: s.no, ...p })))
  return (
    <>
      <PageHeader title={t('nav').sales}><Seg value={tab} onChange={setTab} options={[['sales', t('nav').sales], ['pay', t('pm_title')]]} /></PageHeader>
      <QueryState loading={q.isLoading} error={q.error} />
      {tab === 'sales' && q.data && <Table empty={all.length ? undefined : t('s_none')} head={[t('s_no'), t('i_date'), t('s_type'), t('x_cust'), t('x_tot'), t('x_paid'), t('x_due'), '']}>
        {all.map((s) => <tr key={s.no}><td className="td"><b>{s.no}</b></td><td className="td">{s.date}</td><td className="td">{t(s.type === 'pos' ? 's_pos' : 's_quick')}</td><td className="td">{s.customer || t('walk')}</td><td className="td">{tzs(s.total)}</td><td className="td">{tzs(s.paid)}</td><td className="td">{tzs(s.due)}</td><td className="td"><StatusChip s={s} /> <SyncChip state={s.sync} /></td></tr>)}</Table>}
      {tab === 'pay' && <><Table head={[t('i_date'), t('nav').invoices, t('x_pay'), t('e_amt'), t('pm_ref'), t('pm_st')]}>
        {pays.map((p, i) => <tr key={i}><td className="td">{p.date}</td><td className="td">{p.inv}</td><td className="td">{t('x_' + p.method)}</td><td className="td">{tzs(p.amount)}</td><td className="td">{p.ref ?? '—'}</td><td className="td"><Chip kind={p.status === 'confirmed' ? 'ok' : p.status === 'failed' ? 'e' : 'p'}>{t('pm_' + p.status)}</Chip></td></tr>)}</Table>
        <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('pm_pin')} {t('pm_card')}</p></>}
    </>
  )
}
