import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'
import { tzs } from '@/lib/utils'

interface Line { vid: string; unit: 'base' | 'pack'; pk: string; q: string; cost: string }
const blank = (): Line => ({ vid: '', unit: 'base', pk: '24', q: '', cost: '' })
export const baseQty = (l: Line) => (l.unit === 'pack' ? (+l.q || 0) * (+l.pk || 0) : +l.q || 0)

/** Purchases may be entered by single unit or by pack/carton; the UI converts to base units before sending. */
export default function Purchases() {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify()
  const pur = useQuery({ queryKey: ['purchases'], queryFn: api.people.purchases }), sup = useQuery({ queryKey: ['suppliers'], queryFn: api.people.suppliers }), prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products })
  const [form, setForm] = useState(false), [supplier, setSupplier] = useState(''), [lines, setLines] = useState<Line[]>([blank()]), [paid, setPaid] = useState(''), [err, setErr] = useState(''), [open, setOpen] = useState('')
  const rows = (prods.data ?? []).flatMap((p) => p.variants.map((v) => ({ p, v })))
  const total = lines.reduce((a, l) => a + (+l.q || 0) * (+l.cost || 0), 0)
  const m = useMutation({
    mutationFn: () => {
      if (!supplier) throw new Error(t('req'))
      if (lines.some((l) => !l.vid || !(+l.q > 0) || !(+l.cost > 0) || (l.unit === 'pack' && !(+l.pk > 0)))) throw new Error(t('p_pos'))
      const p = paid === '' ? total : +paid; if (p > total) throw new Error(t('u_over'))
      return api.people.createPurchase({ supplier, paid: p, lines: lines.map((l) => ({ variantId: +l.vid, qty: baseQty(l), cost: l.unit === 'pack' ? +l.cost / +l.pk : +l.cost })) })
    },
    onSuccess: () => { qc.invalidateQueries(); setForm(false); setLines([blank()]); setPaid(''); setSupplier(''); setErr(''); notify(t('p_saved')) }, onError: (e: Error) => setErr(e.message),
  })
  if (form) return (
    <div className="max-w-[760px]"><PageHeader title={t('u_new')} />
      <SelectField label={t('u_sup')} value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">{t('pick')}</option>{(sup.data ?? []).map((s) => <option key={s.id}>{s.name}</option>)}</SelectField>
      {lines.map((l, i) => { const set = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x))); const r = rows.find((x) => x.v.id === +l.vid)
        return <div key={i} className="border border-bd rounded-xl bg-sf p-3 mb-3"><div className="grid sm:grid-cols-2 gap-x-3"><SelectField label={t('u_prod')} value={l.vid} onChange={(e) => set({ vid: e.target.value })}><option value="">{t('pick')}</option>{rows.map(({ p, v }) => <option key={v.id} value={v.id}>{`${p.name} ${v.label}`.trim()}</option>)}</SelectField>
          <SelectField label={t('u_unit')} value={l.unit} onChange={(e) => set({ unit: e.target.value as Line['unit'] })}><option value="base">{t('u_base')}</option><option value="pack">{t('u_pack')}</option></SelectField></div>
          <div className="grid grid-cols-3 gap-x-3">{l.unit === 'pack' && <Field label={t('u_pk')} type="number" value={l.pk} onChange={(e) => set({ pk: e.target.value })} />}<Field label={t('u_q')} type="number" value={l.q} onChange={(e) => set({ q: e.target.value })} /><Field label={t('u_cost')} type="number" value={l.cost} onChange={(e) => set({ cost: e.target.value })} /></div>
          {l.unit === 'pack' && +l.q > 0 && <small className="text-mu">{l.q} × {l.pk} {t('u_conv')} {baseQty(l)} {r?.p.unit}</small>}{lines.length > 1 && <button className="lnk block" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</div> })}
      <button className="lnk" onClick={() => setLines([...lines, blank()])}>{t('u_addl')}</button>
      <Kpis items={[[t('u_tot'), tzs(total)]]} /><Field label={t('u_paid')} type="number" value={paid} onChange={(e) => setPaid(e.target.value)} />
      {err && <p className="text-er text-sm mb-2" role="alert">{err}</p>}
      <div className="flex gap-3"><button className="btn btn-ghost" onClick={() => setForm(false)}>{t('p_cancel')}</button><button className="btn flex-1" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? t('wait') : t('p_save')}</button></div></div>)
  return (
    <>
      <PageHeader title={t('nav').purchases}><button className="btn" onClick={() => setForm(true)}>+ {t('u_new')}</button></PageHeader>
      <QueryState loading={pur.isLoading} error={pur.error} />
      {pur.data && <Table empty={pur.data.length ? undefined : t('u_none')} head={[t('u_no'), t('i_date'), t('u_sup'), t('u_tot'), t('x_paid'), t('x_due')]}>
        {pur.data.map((p) => <Fragment key={p.no}><tr><td className="td"><button className="lnk" onClick={() => setOpen(open === p.no ? '' : p.no)}>{p.no}</button></td><td className="td">{p.date}</td><td className="td">{p.supplier}</td><td className="td">{tzs(p.total)}</td><td className="td">{tzs(p.paid)}</td><td className="td">{tzs(p.total - p.paid)}</td></tr>
          {open === p.no && <tr><td colSpan={6} className="td text-mu">{p.lines.map((l) => `${l.name}: ${l.qty} × ${tzs(l.cost)}`).join(' · ')}</td></tr>}</Fragment>)}</Table>}
    </>
  )
}
