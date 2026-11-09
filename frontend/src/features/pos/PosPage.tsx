import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus, ScanBarcode, X } from 'lucide-react'
import { api } from '@/api'
import type { Method, Sale, SaleItem, SalePayload } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Chip, Field, PageHeader, QueryState, SelectField, useNotify } from '@/components/ui'
import { Scanner } from '@/components/Scanner'
import { Receipt } from './Receipt'
import { StockChip, subIds } from '@/features/catalog/Products'
import { effectivePayments, lineTotal, PayRow, totals, validatePayments } from '@/lib/cart'
import { isOffline, useOffline, useSync } from '@/offline/sync'
import { tzs, uid, today } from '@/lib/utils'
import QuickSales from './QuickSales'

const METHODS: Method[] = ['cash', 'mm', 'bank', 'credit']

export default function PosPage() { const quick = useAuth((s) => s.me?.business?.mode === 'quick'); return quick ? <QuickSales /> : <Pos /> }

function Pos() {
  const { t } = useT(); const { can } = useAuth(); const qc = useQueryClient(); const notify = useNotify(); const offline = useOffline(); const enqueue = useSync((s) => s.enqueue)
  const prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products }), cats = useQuery({ queryKey: ['categories'], queryFn: api.catalog.categories }), custs = useQuery({ queryKey: ['customers'], queryFn: api.people.customers })
  const [cart, setCart] = useState<(SaleItem & { custom?: boolean })[]>([]); const [pay, setPay] = useState<PayRow[]>([{ method: 'cash', amount: '' }]); const [customer, setCustomer] = useState('')
  const [q, setQ] = useState(''), [cat, setCat] = useState(0), [code, setCode] = useState(''), [unk, setUnk] = useState(''), [err, setErr] = useState(''), [scan, setScan] = useState(false), [receipt, setReceipt] = useState<Sale | null>(null), [cu, setCu] = useState({ n: '', p: '' })
  const rows = (prods.data ?? []).flatMap((p) => p.variants.map((v) => ({ p, v })))
  const T0 = totals(cart), eff = effectivePayments(T0.total, pay)
  const stockOf = (vid?: number) => rows.find((r) => r.v.id === vid)?.v.stock ?? Infinity

  const add = (vid: number): string => {
    const r = rows.find((x) => x.v.id === vid); if (!r) return ''
    const name = `${r.p.name} ${r.v.label}`.trim(), l = cart.find((x) => x.variantId === vid)
    if ((l?.qty ?? 0) + 1 > r.v.stock) { notify(t('x_stock')); return `✕ ${name} — ${t('sc_nostock')}` }
    setCart(l ? cart.map((x) => (x.variantId === vid ? { ...x, qty: x.qty + 1 } : x)) : [...cart, { variantId: vid, name, qty: 1, price: r.v.sell, discount: 0 }]); setUnk('')
    return `✓ ${name} — ${tzs(r.v.sell)}`
  }
  const byCode = (c: string) => { const r = rows.find((x) => x.v.barcode === c); if (r) return add(r.v.id); setUnk(c); return `${t('x_unk')} ${c}` }
  const filtered = rows.filter(({ p, v }) => (!cat || subIds(cats.data ?? [], cat).includes(p.categoryId)) && (!q || `${p.name} ${v.label} ${v.barcode}`.toLowerCase().includes(q.toLowerCase())))

  const checkout = useMutation({
    mutationFn: async () => {
      const bad = validatePayments(T0.total, eff, customer, offline); if (bad) throw new Error(t(bad))
      const payload: SalePayload = { clientId: uid(), type: 'pos', customer, items: cart.map(({ custom, ...i }) => i), payments: eff.filter((p) => p.amount > 0) }
      if (isOffline()) {      // offline: queue locally, never show it as synced
        const credit = 0, sale: Sale = { no: 'OFFLINE-' + payload.clientId.slice(0, 6), date: today(), type: 'pos', customer, total: T0.total, paid: T0.total - credit, initialPaid: T0.total, due: credit, methods: ['cash'], items: payload.items, payments: [], sync: 'pending' }
        enqueue(payload, sale.no); return sale
      }
      return api.sales.create(payload)
    },
    onSuccess: (s) => { setReceipt(s); setCart([]); setPay([{ method: 'cash', amount: '' }]); setCustomer(''); setErr(''); qc.invalidateQueries() },
    onError: (e: Error) => setErr(e.message),
  })

  return (
    <>
      <PageHeader title={t('nav').pos} />
      {offline && <p className="text-sm border border-dashed border-bd rounded-lg p-2 mb-3" role="status">{t('o_banner')}</p>}
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <div>
          <div className="grid sm:grid-cols-2 gap-2 mb-3">
            <div className="flex gap-2"><input className="inp" placeholder={t('x_scan')} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('x_scan')}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) { byCode(code.trim()); setCode('') } }} />
              <button className="btn whitespace-nowrap" onClick={() => setScan(true)}><ScanBarcode size={16} />{t('sc_btn')}</button></div>
            <input className="inp" placeholder={t('x_srch')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('x_srch')} />
          </div>
          {unk && (can('catalog') || true) && <div className="border border-dashed border-bd rounded-lg p-3 mb-3 text-sm">{t('x_unk')} <b>{unk}</b>
            <div className="flex gap-2 mt-2 flex-wrap"><input className="inp !w-40" placeholder={t('x_item')} value={cu.n} onChange={(e) => setCu({ ...cu, n: e.target.value })} /><input className="inp !w-28" type="number" placeholder={t('x_price')} value={cu.p} onChange={(e) => setCu({ ...cu, p: e.target.value })} />
              <button className="btn btn-ghost" onClick={() => { if (cu.n && +cu.p > 0) { setCart([...cart, { name: cu.n, qty: 1, price: +cu.p, discount: 0, custom: true }]); setUnk(''); setCu({ n: '', p: '' }) } else notify(t('req')) }}>{t('x_cu')}: {t('x_add')}</button></div></div>}
          <div className="flex gap-1.5 flex-wrap mb-3">{[{ id: 0, name: t('p_all') }, ...(cats.data ?? []).filter((c) => !c.parent)].map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => setCat(c.id)} className={`px-3 min-h-[36px] rounded-lg border text-sm font-semibold ${cat === c.id ? 'bg-ac text-on border-ac' : 'bg-sf border-bd text-mu'}`}>{c.name}</button>)}</div>
          <QueryState loading={prods.isLoading} error={prods.error} />
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
            {filtered.map(({ p, v }) => (
              <button key={v.id} disabled={v.stock <= 0} onClick={() => add(v.id)} className="flex flex-col gap-1 text-left bg-sf border border-bd rounded-xl p-3 min-h-[92px] hover:border-ac disabled:opacity-45 disabled:cursor-not-allowed">
                {p.image && <img src={p.image} alt="" className="w-full h-16 object-cover rounded" />}
                <b>{`${p.name} ${v.label}`.trim()}</b><span className="text-ac font-bold">{tzs(v.sell)}</span><small className="text-mu mt-auto">{v.stock} · <StockChip v={v} t={t} /></small>
              </button>))}
            {prods.data && !filtered.length && <p className="text-mu">{t('p_none')}</p>}
          </div>
        </div>
        <aside className="lg:sticky lg:top-20 border border-bd rounded-xl bg-sf p-4">
          <h3 className="font-semibold mb-2">{t('x_cart')}</h3>
          {cart.length ? cart.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 border-b border-bd text-sm">
              <div><b>{l.name}</b><br /><small className="text-mu">{tzs(l.price)}</small></div>
              <div className="flex items-center gap-1.5"><button className="btn btn-ghost !min-h-[32px] !px-2" aria-label="-" onClick={() => setCart(cart.flatMap((x, j) => (j === i ? (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []) : [x])))}><Minus size={14} /></button><b>{l.qty}</b>
                <button className="btn btn-ghost !min-h-[32px] !px-2" aria-label="+" onClick={() => (l.qty + 1 > stockOf(l.variantId) ? notify(t('x_stock')) : setCart(cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x))))}><Plus size={14} /></button></div>
              <div className="text-right"><b>{tzs(lineTotal(l))}</b><br /><input type="number" min={0} className="inp !min-h-[30px] !w-24 !py-0 text-xs" placeholder={t('x_disc')} disabled={!can('discount')} value={l.discount || ''} onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, discount: +e.target.value } : x)))} /></div>
              <button className="lnk" aria-label="remove" onClick={() => setCart(cart.filter((_, j) => j !== i))}><X size={16} /></button>
            </div>)) : <p className="text-mu text-sm">{t('x_empty')}</p>}
          <div className="border border-bd rounded-lg divide-y divide-bd my-3 text-sm">
            {[[t('x_sub'), tzs(T0.sub)], [t('x_disc'), '−' + tzs(T0.discount)], [t('x_tot'), tzs(T0.total)]].map(([a, b], i) => <div key={a} className="flex justify-between p-2.5"><span className="text-mu">{a}</span><b className={i === 2 ? 'text-lg' : ''}>{b}</b></div>)}
          </div>
          <SelectField label={t('x_cust')} value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">{t('walk')}</option>{(custs.data ?? []).map((c) => <option key={c.id}>{c.name}</option>)}</SelectField>
          <span className="block text-xs text-mu mb-1">{t('x_pay')}</span>
          {pay.map((p, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <select className="inp" value={p.method} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, method: e.target.value as Method } : x)))}>{METHODS.map((m) => <option key={m} value={m}>{t('x_' + m)}</option>)}</select>
              <input className="inp" type="number" min={0} value={p.amount} placeholder={p.amount === '' ? String(Math.round(eff[i]?.amount ?? 0)) : t('x_amt')} onChange={(e) => setPay(pay.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              {pay.length > 1 && <button className="lnk" onClick={() => setPay(pay.filter((_, j) => j !== i))}><X size={16} /></button>}
            </div>))}
          <button className="lnk" onClick={() => setPay([...pay, { method: 'mm', amount: '' }])}>{t('x_addp')}</button>
          {err && <p className="text-er text-sm my-2" role="alert">{err}</p>}
          {checkout.isPending && eff.some((p) => p.method === 'mm') && <p className="text-sm border border-dashed border-bd rounded-lg p-2 my-2">{t('x_wait')}</p>}
          <button className="btn w-full mt-2" disabled={!cart.length || checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? t('wait') : `${t('x_complete')} · ${tzs(T0.total)}`}</button>
          <p className="text-xs text-mu mt-3">{t('pm_pin')}</p>
        </aside>
      </div>
      <Scanner open={scan} mode="barcode" log onClose={() => setScan(false)} onCode={(c) => byCode(c)} />
      {receipt && <Receipt sale={receipt} closeLabel={t('x_new')} onClose={() => setReceipt(null)} />}
    </>
  )
}
export { Chip }
