import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Sale } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Field, PageHeader, QueryState, Table, useNotify } from '@/components/ui'
import { Receipt } from '@/features/pos/Receipt'
import { StatusChip } from './Sales'
import { lineTotal } from '@/lib/cart'
import { tzs } from '@/lib/utils'

/** Completed financial records are never edited: use void with a reason (which restores stock and creates a refund entry). */
export default function Invoices() {
  const { t } = useT(); const { can } = useAuth(); const qc = useQueryClient(); const notify = useNotify()
  const q = useQuery({ queryKey: ['sales'], queryFn: api.sales.list })
  const [search, setSearch] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [open, setOpen] = useState<Sale | null>(null), [rc, setRc] = useState(false), [reason, setReason] = useState('')
  const v = useMutation({ mutationFn: () => api.sales.voidSale(open!.no, reason), onSuccess: () => { qc.invalidateQueries(); notify(t('n_vd')); setOpen(null); setReason('') }, onError: (e: Error) => notify(e.message) })
  const list = (q.data ?? []).filter((s) => (!search || s.no.toLowerCase().includes(search.toLowerCase())) && (!from || s.date >= from) && (!to || s.date <= to))
  if (open) return (
    <div className="max-w-[640px]">
      <button className="lnk" onClick={() => setOpen(null)}>‹ {t('ret')}</button><PageHeader title={open.no} />
      <p className="text-mu mb-3">{open.date} · {open.customer || t('walk')} · {open.methods.map((m) => t('x_' + m)).join(', ')}</p>
      <div className="border border-bd rounded-xl bg-sf divide-y divide-bd mb-4 text-sm">
        {(open.items.length ? open.items : []).map((l, i) => <div key={i} className="flex justify-between p-3"><span>{l.qty}× {l.name}</span><b>{tzs(lineTotal(l))}</b></div>)}
        {[[t('x_tot'), tzs(open.total)], [t('x_paid'), tzs(open.paid)], [t('x_due'), tzs(open.due)]].map(([a, b]) => <div key={a} className="flex justify-between p-3"><span className="text-mu">{a}</span><b>{b}</b></div>)}
        <div className="flex justify-between p-3"><span className="text-mu">{t('s_type')}</span><StatusChip s={open} /></div>
      </div>
      <div className="flex gap-2 mb-5"><button className="btn btn-ghost" onClick={() => setRc(true)}>{t('n_rcp')}</button><button className="btn btn-ghost" onClick={() => window.print()}>{t('x_print')}</button></div>
      {!open.voided && <section className="border-t border-bd pt-3"><h3 className="font-semibold mb-2">{t('n_void')}</h3><Field label={t('n_reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-ghost" disabled={!can('void') || v.isPending || !reason.trim()} onClick={() => v.mutate()}>{t('n_void')}</button></section>}
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-4">{t('n_note')}</p>
      {rc && <Receipt sale={open} closeLabel={t('n_close')} onClose={() => setRc(false)} />}
    </div>)
  return (
    <>
      <PageHeader title={t('nav').invoices} />
      <div className="flex flex-wrap gap-2 mb-4 items-center"><input className="inp !max-w-[240px]" placeholder={t('n_s')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('n_s')} />
        <label className="flex items-center gap-1.5 text-sm">{t('n_from')}<input type="date" className="inp !w-auto !min-h-[38px]" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-sm">{t('n_to')}<input type="date" className="inp !w-auto !min-h-[38px]" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table empty={list.length ? undefined : t('s_none')} head={[t('s_no'), t('i_date'), t('x_cust'), t('x_tot'), t('pm_st')]}>{list.map((s) => <tr key={s.no}><td className="td"><button className="lnk" onClick={() => setOpen(s)}>{s.no}</button></td><td className="td">{s.date}</td><td className="td">{s.customer || t('walk')}</td><td className="td">{tzs(s.total)}</td><td className="td"><StatusChip s={s} /></td></tr>)}</Table>}
    </>
  )
}
