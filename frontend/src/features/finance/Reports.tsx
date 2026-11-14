import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Kpis, PageHeader, Panel, QueryState, Seg, Table } from '@/components/ui'

const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat('en-TZ', { style: 'currency', currency, maximumFractionDigits: currency === 'TZS' ? 0 : 2 }).format(value) }
  catch { return `${currency} ${Math.round(value).toLocaleString('en-US')}` }
}
const Chart = ({ data, fmt }: { data: { label: string; value: number }[]; fmt: (n: number) => string }) => (
  <div className="h-44 min-w-[300px]"><ResponsiveContainer><BarChart data={data}><XAxis dataKey="label" tick={{ fontSize: 10 }} /><Tooltip formatter={(v: number) => fmt(v)} /><Bar dataKey="value" fill="var(--ac)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
)
type Tab = 'sales' | 'profit' | 'exp' | 'debts' | 'inv' | 'prod'

/** All figures are calculated by the backend; estimates are labelled as estimates. */
export default function Reports() {
  const { t } = useT(); const quick = useAuth((s) => s.me?.business?.mode === 'quick'); const currency = useAuth((s) => s.me?.business?.currency ?? 'TZS')
  const fmt = (value: number) => money(value, currency)
  const [tab, setTab] = useState<Tab>('sales'), [group, setGroup] = useState<'day' | 'week' | 'month' | 'year'>('day'), [from, setFrom] = useState(''), [to, setTo] = useState('')
  const q = useQuery({ queryKey: ['report', from, to, group], queryFn: () => api.finance.report(from, to, group) })
  const tabs: [Tab, string][] = [['sales', t('rp_sales')], ['profit', t('rp_profit')], ['exp', t('rp_exp')], ['debts', t('rp_debts')], ...(quick ? [] : ([['inv', t('rp_inv')], ['prod', t('rp_prod')]] as [Tab, string][]))]
  const r = q.data, shown = tabs.some(([k]) => k === tab) ? tab : 'sales'
  const preset = (n: number | null) => { setTo(''); setFrom(n === null ? '' : new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)) }
  return (
    <>
      <PageHeader title={t('nav').reports}><Seg value={shown} onChange={setTab} options={tabs} /></PageHeader>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <label className="flex items-center gap-1.5 text-sm">{t('n_from')}<input type="date" className="inp !w-auto !min-h-[38px]" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-sm">{t('n_to')}<input type="date" className="inp !w-auto !min-h-[38px]" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn btn-ghost !min-h-[38px]" onClick={() => preset(7)}>{t('rp_7')}</button><button className="btn btn-ghost !min-h-[38px]" onClick={() => preset(30)}>{t('rp_30')}</button><button className="btn btn-ghost !min-h-[38px]" onClick={() => preset(null)}>{t('rp_all')}</button>
      </div>
      {!r ? <QueryState loading={q.isLoading} error={q.error} /> : <>
        {shown === 'sales' && <><div className="mb-3 flex gap-2 items-center"><span className="text-sm text-mu">{t('rp_by')}</span><Seg value={group} onChange={setGroup} options={[['day', t('rp_day')], ['week', t('rp_week')], ['month', t('rp_month')], ['year', t('rp_year')]]} /></div>
          <Kpis items={[[t('rp_rev'), fmt(r.revenue)], [t('rp_cnt'), String(r.salesByPeriod.reduce((a, x) => a + x.count, 0))]]} /><Chart data={r.salesByPeriod} fmt={fmt} />
          <Table head={[t('e_date'), t('rp_cnt'), t('rp_rev')]}>{r.salesByPeriod.map((x) => <tr key={x.label}><td className="td">{x.label}</td><td className="td">{x.count}</td><td className="td">{fmt(x.value)}</td></tr>)}</Table></>}
        {shown === 'profit' && <><Kpis items={[[t('rp_rev'), fmt(r.revenue)], ...(r.grossProfit === null ? [[t('rp_cash'), fmt(r.operatingProfit)] as [string, string]] : [[t('rp_cogs'), fmt(r.cogs)], [t('rp_gp'), fmt(r.grossProfit)], [t('rp_op'), fmt(r.operatingProfit)]] as [string, string][]), [t('e_tot'), fmt(r.expenses)]]} /><p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2">{t('rp_qn')}</p></>}
        {shown === 'exp' && <><Kpis items={[[t('e_tot'), fmt(r.expenses)]]} /><Chart data={r.expensesByCategory.map((x) => ({ ...x, label: t('ec_' + x.label) }))} fmt={fmt} /><Table head={[t('e_cat'), t('e_amt')]}>{r.expensesByCategory.map((x) => <tr key={x.label}><td className="td">{t('ec_' + x.label)}</td><td className="td">{fmt(x.value)}</td></tr>)}</Table></>}
        {shown === 'debts' && <><Kpis items={[[t('c_bal'), fmt(r.debts.total)], [t('d_a'), fmt(r.debts.aging[0])], [t('d_b'), fmt(r.debts.aging[1])], [t('d_c'), fmt(r.debts.aging[2])]]} /><Table empty={r.debts.top.length ? undefined : t('d_empty')} head={[t('x_cust'), t('c_bal')]}>{r.debts.top.map((d) => <tr key={d.name}><td className="td">{d.name}</td><td className="td">{fmt(d.balance)}</td></tr>)}</Table></>}
        {shown === 'inv' && <Kpis items={[[t('i_cost'), fmt(r.inventory.cost)], [t('i_ret'), fmt(r.inventory.retail)], [t('rp_low'), String(r.inventory.low)], [t('rp_outn'), String(r.inventory.out)]]} />}
        {shown === 'prod' && <><Panel title={t('rp_best')}><Chart data={r.best.map((x) => ({ label: x.name, value: x.qty }))} fmt={(n) => `${n} ${t('units')}`} /></Panel><Panel title={t('rp_slow')}><Table head={[t('p_name'), t('p_stc')]}>{r.slow.map((x) => <tr key={x.name}><td className="td">{x.name}</td><td className="td">{x.stock}</td></tr>)}</Table></Panel></>}
        <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('rp_br')}</p>
      </>}
    </>
  )
}
