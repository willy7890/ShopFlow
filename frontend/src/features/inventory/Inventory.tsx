import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, QueryState, Seg, SelectField, Table, useNotify } from '@/components/ui'
import { RestockDialog, StockChip, status } from '@/features/catalog/Products'
import type { Product, Variant } from '@/api/types'
import { tzs } from '@/lib/utils'

/** Stock is NEVER edited directly: it changes through sales, purchases, restocks and authorized adjustments. */
export default function Inventory() {
  const { t } = useT(); const { can } = useAuth(); const [tab, setTab] = useState<'stock' | 'mov' | 'adj'>('stock'); const [fs, setFs] = useState<'all' | 'low' | 'out'>('all')
  const prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products }), mov = useQuery({ queryKey: ['movements'], queryFn: api.inventory.movements })
  const [restock, setRestock] = useState<{ p: Product; v: Variant } | null>(null)
  const rows = (prods.data ?? []).flatMap((p) => p.variants.map((v) => ({ p, v })))
  return (
    <>
      <PageHeader title={t('nav').inventory}><Seg value={tab} onChange={setTab} options={[['stock', t('i_cur')], ['mov', t('i_mov')], ['adj', t('i_adj')]]} /></PageHeader>
      <QueryState loading={prods.isLoading} error={prods.error} />
      {tab === 'stock' && prods.data && <>
        <Kpis items={[[t('i_cost'), tzs(rows.reduce((a, { v }) => a + v.stock * v.buy, 0))], [t('i_ret'), tzs(rows.reduce((a, { v }) => a + v.stock * v.sell, 0))]]} />
        <div className="mb-3"><Seg value={fs} onChange={setFs} options={[['all', t('p_all')], ['low', t('p_low')], ['out', t('p_out')]]} /></div>
        <Table head={[t('p_name'), t('p_stc'), t('p_min'), '']}>{rows.filter(({ v }) => fs === 'all' || status(v) === fs).map(({ p, v }) => <tr key={v.id}><td className="td"><b>{p.name}</b> {v.label}</td><td className="td">{v.stock}</td><td className="td">{v.min}</td><td className="td"><StockChip v={v} t={t} /> {(can('inventory') || can('catalog')) && <button className="lnk" onClick={() => setRestock({ p, v })}>{t('rs_btn')}</button>}</td></tr>)}</Table></>}
      {tab === 'mov' && <Table head={[t('i_date'), t('p_name'), t('i_type'), t('i_qty'), t('i_ref'), t('i_user')]}>{(mov.data ?? []).map((m, i) => <tr key={i}><td className="td">{m.date}</td><td className="td">{m.product}</td><td className="td">{t('m_' + m.type)}</td><td className={`td font-bold ${m.qty < 0 ? 'text-er' : 'text-ok'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="td">{m.ref}</td><td className="td">{m.user}</td></tr>)}</Table>}
      {tab === 'adj' && <Adjust rows={rows} />}
      {restock && <RestockDialog {...restock} onClose={() => setRestock(null)} />}
    </>
  )
}

function Adjust({ rows }: { rows: { p: Product; v: Variant }[] }) {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify()
  const S = z.object({ variantId: z.coerce.number().min(1, t('req')), qty: z.coerce.number().int().refine((n) => n !== 0, t('i_nz')), reason: z.string().min(1, t('req')), note: z.string().optional() })
  const f = useForm<z.infer<typeof S>>({ resolver: zodResolver(S) })
  const m = useMutation({ mutationFn: api.inventory.adjust, onSuccess: () => { qc.invalidateQueries(); f.reset(); notify(t('p_saved')) }, onError: (e: Error) => f.setError('qty', { message: e.message === 'NEGATIVE_STOCK' ? t('i_neg') : e.message }) })
  const e = f.formState.errors
  return (
    <form className="max-w-[480px]" onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
      <SelectField label={t('p_name')} error={e.variantId?.message} {...f.register('variantId')}><option value="">{t('pick')}</option>{rows.map(({ p, v }) => <option key={v.id} value={v.id}>{`${p.name} ${v.label}`.trim()} ({v.stock})</option>)}</SelectField>
      <Field label={t('i_aq')} type="number" error={e.qty?.message} {...f.register('qty')} />
      <SelectField label={t('i_reason')} error={e.reason?.message} {...f.register('reason')}><option value="">{t('pick')}</option>{['damaged', 'counted', 'found', 'other'].map((r) => <option key={r} value={r}>{t('r_' + r)}</option>)}</SelectField>
      <Field label={t('i_note')} {...f.register('note')} />
      <button className="btn" disabled={m.isPending}>{m.isPending ? t('wait') : t('i_rec')}</button>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-4">{t('p_note')} {t('i_later')}</p>
    </form>
  )
}
