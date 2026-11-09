import { useMemo, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Plus, ScanBarcode } from 'lucide-react'
import { api } from '@/api'
import type { Category, Product, Variant } from '@/api/types'
import type { ProductInput } from '@/api/api'
import { useAuth } from '@/store/auth'
import { useT, TFn } from '@/i18n'
import { Chip, Field, Modal, PageHeader, QueryState, Seg, SelectField, Table, useNotify } from '@/components/ui'
import { Scanner } from '@/components/Scanner'
import { tzs, shrinkImage } from '@/lib/utils'

export const status = (v: Variant) => (v.stock <= 0 ? 'out' : v.stock <= v.min ? 'low' : 'ok')
export const StockChip = ({ v, t }: { v: Variant; t: TFn }) => { const s = status(v); return <Chip kind={s === 'ok' ? 'ok' : s === 'low' ? 'p' : 'e'}>{t('p_' + s)}</Chip> }
export const catPath = (cats: Category[], id: number): string => { const c = cats.find((x) => x.id === id); return c ? (c.parent ? catPath(cats, c.parent) + ' › ' : '') + c.name : '' }
export const subIds = (cats: Category[], id: number): number[] => [id, ...cats.filter((c) => c.parent === id).flatMap((c) => subIds(cats, c.id))]

export default function Products() {
  const { t } = useT(); const { can } = useAuth(); const qc = useQueryClient(); const notify = useNotify()
  const prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products }), cats = useQuery({ queryKey: ['categories'], queryFn: api.catalog.categories })
  const [form, setForm] = useState<Product | 'new' | null>(null); const [restock, setRestock] = useState<{ p: Product; v: Variant } | null>(null)
  const [q, setQ] = useState(''), [fc, setFc] = useState(''), [fs, setFs] = useState<'all' | 'low' | 'out'>('all'), [confirm, setConfirm] = useState(0)
  const archive = useMutation({ mutationFn: api.catalog.archiveProduct, onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); setConfirm(0); notify(t('p_saved')) } })
  const rows = useMemo(() => (prods.data ?? []).flatMap((p) => p.variants.map((v) => ({ p, v }))).filter(({ p, v }) =>
    (!fc || subIds(cats.data ?? [], +fc).includes(p.categoryId)) && (fs === 'all' || status(v) === fs) && (!q || `${p.name} ${v.label} ${v.barcode}`.toLowerCase().includes(q.toLowerCase()))), [prods.data, cats.data, q, fc, fs])
  if (form) return <ProductForm initial={form === 'new' ? null : form} cats={cats.data ?? []} onDone={() => setForm(null)} />
  const edit = can('catalog') || can('inventory')
  return (
    <>
      <PageHeader title={t('nav').products}>{can('catalog') && <button className="btn" onClick={() => setForm('new')}><Plus size={16} />{t('p_add')}</button>}</PageHeader>
      <div className="flex flex-wrap gap-2 mb-4">
        <input className="inp !max-w-[260px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('p_s')} aria-label={t('p_s')} />
        <select className="inp !w-auto" value={fc} onChange={(e) => setFc(e.target.value)} aria-label={t('p_cat')}><option value="">{t('p_allc')}</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{catPath(cats.data!, c.id)}</option>)}</select>
        <Seg value={fs} onChange={setFs} options={[['all', t('p_all')], ['low', t('p_low')], ['out', t('p_out')]]} />
      </div>
      <QueryState loading={prods.isLoading} error={prods.error} />
      {prods.data && <Table empty={rows.length ? undefined : t('p_none')} head={[t('p_name'), t('p_cat'), t('p_bc'), t('p_buy'), t('p_sell'), t('p_stc'), '']}>
        {rows.map(({ p, v }) => (
          <tr key={v.id}>
            <td className="td">{p.image && <img src={p.image} alt="" className="inline w-9 h-9 object-cover rounded mr-2 align-middle" />}<b>{p.name}</b> {v.label}</td>
            <td className="td">{catPath(cats.data ?? [], p.categoryId)}</td><td className="td"><small className="text-mu">{v.barcode}</small></td>
            <td className="td">{tzs(v.buy)}</td><td className="td">{tzs(v.sell)}</td>
            <td className="td whitespace-nowrap">{v.stock} <StockChip v={v} t={t} /> {edit && <button className="lnk" onClick={() => setRestock({ p, v })}>{t('rs_btn')}</button>}</td>
            <td className="td whitespace-nowrap">{v === p.variants[0] && can('catalog') && <><button className="lnk" onClick={() => setForm(p)}>{t('p_edt')}</button>{confirm === p.id ? <button className="lnk" onClick={() => archive.mutate(p.id)}>{t('p_conf')}</button> : <button className="lnk" onClick={() => setConfirm(p.id)}>{t('p_arch')}</button>}</>}</td>
          </tr>))}
      </Table>}
      {restock && <RestockDialog {...restock} onClose={() => setRestock(null)} onMore={() => { setForm(restock.p); setRestock(null) }} />}
    </>
  )
}

export function RestockDialog({ p, v, onClose, onMore }: { p: Product; v: Variant; onClose: () => void; onMore?: () => void }) {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify()
  const S = z.object({ qty: z.coerce.number().int().positive(t('p_pos')), buy: z.coerce.number().min(0, t('p_pos')), sell: z.coerce.number().positive(t('p_pos')) })
  const f = useForm({ resolver: zodResolver(S), defaultValues: { qty: '' as unknown as number, buy: v.buy, sell: v.sell } })
  const qty = Number(f.watch('qty')) || 0
  const m = useMutation({ mutationFn: (d: z.infer<typeof S>) => api.catalog.restock(v.id, d), onSuccess: (_, d) => { qc.invalidateQueries(); notify(`${t('rs_ok')}: +${d.qty}`); onClose() } })
  return (
    <Modal open onClose={onClose} title={t('rs_title')}>
      <p className="text-mu mb-3"><b className="text-tx">{`${p.name} ${v.label}`.trim()}</b> · {t('rs_cur')}: <b>{v.stock}</b></p>
      <form onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <Field label={t('rs_qty')} type="number" inputMode="numeric" autoFocus error={f.formState.errors.qty?.message} {...f.register('qty')} />
        {qty > 0 && <p className="text-mu -mt-2 mb-3">{t('rs_after')}: {v.stock + qty}</p>}
        <div className="grid grid-cols-2 gap-3"><Field label={t('rs_buy')} type="number" error={f.formState.errors.buy?.message} {...f.register('buy')} /><Field label={t('rs_sell')} type="number" error={f.formState.errors.sell?.message} {...f.register('sell')} /></div>
        {m.error && <p className="text-er text-sm mb-2" role="alert">{(m.error as Error).message}</p>}
        <div className="flex gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>{t('p_cancel')}</button><button className="btn flex-1" disabled={m.isPending}>{m.isPending ? t('wait') : t('p_save')}</button></div>
        {onMore && <button type="button" className="lnk mt-2" onClick={onMore}>{t('rs_more')}</button>}
      </form>
    </Modal>
  )
}

function ProductForm({ initial, cats, onDone }: { initial: Product | null; cats: Category[]; onDone: () => void }) {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify()
  const S = z.object({
    name: z.string().min(1, t('req')), categoryId: z.coerce.number().min(1, t('req')), brand: z.string(), unit: z.string(), image: z.string().optional(),
    variants: z.array(z.object({ id: z.number().optional(), label: z.string(), barcode: z.string(), sku: z.string(), buy: z.coerce.number().min(0), sell: z.coerce.number().positive(t('p_pos')), stock: z.coerce.number().min(0), min: z.coerce.number().min(0) })).min(1),
  })
  const f = useForm<z.infer<typeof S>>({ resolver: zodResolver(S), defaultValues: initial ?? { name: '', categoryId: 0, brand: '', unit: 'pc', variants: [{ label: '', barcode: '', sku: '', buy: 0, sell: 0, stock: 0, min: 0 }] } as never })
  const arr = useFieldArray({ control: f.control, name: 'variants' }); const [scan, setScan] = useState<number | null>(null); const [cam, setCam] = useState(false)
  const img = f.watch('image'); const e = f.formState.errors
  const m = useMutation({ mutationFn: (d: ProductInput) => api.catalog.saveProduct(d), onSuccess: () => { qc.invalidateQueries({ queryKey: ['products'] }); notify(t('p_saved')); onDone() } })
  const many = arr.fields.length > 1
  return (
    <div className="max-w-[720px]">
      <PageHeader title={initial ? t('p_edit') : t('p_add')} />
      <form onSubmit={f.handleSubmit((d) => { if (many && d.variants.some((v) => !v.label.trim())) return f.setError('variants.0.label', { message: t('req') }); m.mutate(d as ProductInput) })} noValidate>
        <Field label={t('p_name')} error={e.name?.message} {...f.register('name')} />
        <div className="mb-4"><span className="block text-sm font-semibold mb-1">{t('sc_ph')}</span>
          <div className="flex gap-3 items-center flex-wrap">
            {img ? <img src={img} alt="" className="w-24 h-24 object-cover rounded-lg border border-bd" /> : <div className="w-24 h-24 rounded-lg border border-bd bg-sf grid place-items-center"><Camera /></div>}
            <button type="button" className="btn btn-ghost" onClick={() => setCam(true)}><Camera size={16} />{t('sc_photo')}</button>
            <label className="btn btn-ghost cursor-pointer">{t('sc_gal')}<input hidden type="file" accept="image/*" onChange={async (ev) => { const x = ev.target.files?.[0]; if (x) f.setValue('image', await shrinkImage(x)) }} /></label>
            {img && <button type="button" className="lnk" onClick={() => f.setValue('image', '')}>{t('sc_rm')}</button>}
          </div><small className="text-mu">{t('sc_note')}</small></div>
        <div className="grid sm:grid-cols-3 gap-x-3">
          <SelectField label={t('p_cat')} error={e.categoryId?.message} {...f.register('categoryId')}><option value={0}>{t('pick')}</option>{cats.map((c) => <option key={c.id} value={c.id}>{catPath(cats, c.id)}</option>)}</SelectField>
          <Field label={t('p_brand')} {...f.register('brand')} /><Field label={t('p_unit')} {...f.register('unit')} />
        </div>
        {arr.fields.map((fl, i) => {
          const ve = e.variants?.[i]
          return (
            <div key={fl.id} className="border border-bd rounded-xl bg-sf p-3 mb-3">
              <div className="grid sm:grid-cols-3 gap-x-3">
                <Field label={t('p_var')} error={ve?.label?.message} {...f.register(`variants.${i}.label`)} />
                <div><Field label={t('p_bc')} inputMode="numeric" {...f.register(`variants.${i}.barcode`)} /><button type="button" className="lnk -mt-2 mb-2" onClick={() => setScan(i)}><ScanBarcode size={14} className="inline" /> {t('sc_btn')}</button></div>
                <Field label={t('p_sku')} {...f.register(`variants.${i}.sku`)} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3">
                <Field label={t('p_buy')} type="number" {...f.register(`variants.${i}.buy`)} /><Field label={t('p_sell')} type="number" error={ve?.sell?.message} {...f.register(`variants.${i}.sell`)} />
                <Field label={fl.id && initial?.variants.some((x) => x.id === (fl as { id?: number }).id) ? t('p_stc') : t('p_st')} type="number" disabled={!!initial?.variants.some((x) => x.id === f.getValues(`variants.${i}.id`))} {...f.register(`variants.${i}.stock`)} />
                <Field label={t('p_min')} type="number" {...f.register(`variants.${i}.min`)} />
              </div>
              {many && <button type="button" className="lnk" onClick={() => arr.remove(i)}>{t('p_del')}</button>}
            </div>)
        })}
        <button type="button" className="lnk" onClick={() => arr.append({ label: '', barcode: '', sku: '', buy: 0, sell: 0, stock: 0, min: 0 })}>{t('p_addv')}</button>
        <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 my-3">{t('p_note')} {t('p_bcn')}</p>
        {m.error && <p className="text-er text-sm mb-2" role="alert">{(m.error as Error).message}</p>}
        <div className="flex gap-3"><button type="button" className="btn btn-ghost" onClick={onDone}>{t('p_cancel')}</button><button className="btn flex-1" disabled={m.isPending}>{m.isPending ? t('wait') : t('p_save')}</button></div>
      </form>
      <Scanner open={scan !== null} mode="barcode" onClose={() => setScan(null)} onCode={(c) => { if (scan !== null) f.setValue(`variants.${scan}.barcode`, c); setScan(null) }} />
      <Scanner open={cam} mode="photo" onClose={() => setCam(false)} onPhoto={(d) => f.setValue('image', d)} />
    </div>
  )
}
