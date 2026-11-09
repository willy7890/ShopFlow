import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Method, Sale } from '@/api/types'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, SelectField, useNotify } from '@/components/ui'
import { isOffline, useOffline, useSync } from '@/offline/sync'
import { tzs, uid, today } from '@/lib/utils'
import { Receipt } from './Receipt'

/** Sales Book mode: record totals without a product catalog. Never touches stock. */
export default function QuickSales() {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify(); const offline = useOffline(); const enqueue = useSync((s) => s.enqueue)
  const custs = useQuery({ queryKey: ['customers'], queryFn: api.people.customers })
  const [desc, setDesc] = useState(''), [amt, setAmt] = useState(''), [lines, setLines] = useState<{ d: string; a: string }[]>([]), [method, setMethod] = useState<Method>('cash'), [cust, setCust] = useState(''), [recv, setRecv] = useState(''), [err, setErr] = useState(''), [receipt, setReceipt] = useState<Sale | null>(null)
  const total = lines.length ? lines.reduce((a, l) => a + (+l.a || 0), 0) : +amt || 0
  const got = recv === '' ? total : +recv, due = Math.max(total - got, 0)
  const m = useMutation({
    mutationFn: async () => {
      if (!(total > 0)) throw new Error(t('q_nz')); if (got > total) throw new Error(t('q_over')); if (due > 0 && !cust) throw new Error(t('x_needc'))
      if (isOffline() && method !== 'cash') throw new Error(t('o_cashonly'))
      const items = lines.length ? lines.map((l) => ({ name: l.d || '—', qty: 1, price: +l.a || 0, discount: 0 })) : [{ name: desc || t('q_deflt'), qty: 1, price: total, discount: 0 }]
      const payload = { clientId: uid(), type: 'quick' as const, customer: cust, items, description: desc || t('q_deflt'), payments: [{ method, amount: got }, ...(due > 0 ? [{ method: 'credit' as Method, amount: due }] : [])].filter((p) => p.amount > 0) }
      if (isOffline()) { const s: Sale = { no: 'OFFLINE-' + payload.clientId.slice(0, 6), date: today(), type: 'quick', customer: cust, total, paid: got, initialPaid: got, due, methods: [method], items, payments: [], sync: 'pending', description: payload.description }; enqueue(payload, s.no); return s }
      return api.sales.create(payload)
    },
    onSuccess: (s) => { setReceipt(s); setDesc(''); setAmt(''); setLines([]); setRecv(''); setCust(''); setErr(''); qc.invalidateQueries(); notify(t('x_done')) },
    onError: (e: Error) => setErr(e.message),
  })
  return (
    <div className="max-w-[640px]">
      <PageHeader title={t('q_title')} />
      {offline && <p className="text-sm border border-dashed border-bd rounded-lg p-2 mb-3">{t('o_banner')}</p>}
      <Field label={t('q_desc')} placeholder={t('q_deflt')} value={desc} onChange={(e) => setDesc(e.target.value)} />
      <Field label={t('q_amt')} type="number" min={0} disabled={lines.length > 0} value={amt} onChange={(e) => setAmt(e.target.value)} />
      <section className="border-t border-bd pt-3 mb-4"><h3 className="font-semibold mb-2">{t('q_lines')}</h3>
        {lines.map((l, i) => <div key={i} className="grid grid-cols-[1fr_130px_auto] gap-2 mb-2"><input className="inp" placeholder={t('q_desc')} value={l.d} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, d: e.target.value } : x)))} /><input className="inp" type="number" min={0} placeholder={t('x_price')} value={l.a} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} /><button className="lnk" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></div>)}
        <button className="lnk" onClick={() => setLines([...lines, { d: '', a: '' }])}>{t('q_addl')}</button></section>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <SelectField label={t('x_pay')} value={method} onChange={(e) => setMethod(e.target.value as Method)}>{(['cash', 'mm', 'bank'] as Method[]).map((x) => <option key={x} value={x}>{t('x_' + x)}</option>)}</SelectField>
        <SelectField label={t('x_cust')} value={cust} onChange={(e) => setCust(e.target.value)}><option value="">{t('walk')}</option>{(custs.data ?? []).map((c) => <option key={c.id}>{c.name}</option>)}</SelectField>
      </div>
      <Field label={t('q_recv')} type="number" min={0} value={recv} onChange={(e) => setRecv(e.target.value)} />
      <Kpis items={[[t('x_rev'), tzs(total)], [t('x_paid'), tzs(Math.min(got, total))], [t('x_due'), tzs(due)]]} />
      {err && <p className="text-er text-sm mb-2" role="alert">{err}</p>}
      <button className="btn w-full" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? t('wait') : t('q_rec')}</button>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-4">{t('q_n')}</p>
      {receipt && <Receipt sale={receipt} closeLabel={t('n_close')} onClose={() => setReceipt(null)} />}
    </div>
  )
}
