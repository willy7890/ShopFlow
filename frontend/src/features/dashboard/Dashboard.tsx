import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { tzs } from '@/lib/utils'
import { Chip, Kpis, PageHeader, Panel, QueryState, Table } from '@/components/ui'

export default function Dashboard() {
  const { t } = useT(); const { storeId, me } = useAuth(); const [period, setPeriod] = useState('today')
  const q = useQuery({ queryKey: ['dashboard', period, storeId], queryFn: () => api.finance.dashboard(period, storeId) })
  const quick = me?.business?.mode === 'quick'; const d = q.data
  return (
    <>
      <PageHeader title={t('nav').dash}>
        <select aria-label={t('ctx')} className="inp !w-auto !min-h-[38px]" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {Object.entries(t('per') as Record<string, string>).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </PageHeader>
      {!d ? <QueryState loading={q.isLoading} error={q.error} /> : <>
        <Kpis items={[[t('k_sales'), tzs(d.sales)], [t('k_rec'), tzs(d.received)], [t('k_debt'), tzs(d.debt)], [t('k_exp'), tzs(d.expenses)], ...(quick || d.grossProfit === null ? [] : [[t('k_gp'), tzs(d.grossProfit)] as [string, string]]), [`${t('k_net')} (${t('est')})`, tzs(d.netProfit)]]} />
        <div className="grid lg:grid-cols-[3fr_2fr] gap-6">
          <div>
            <Panel title={t('c_sales')}><div className="h-44"><ResponsiveContainer><BarChart data={d.series}><XAxis dataKey="label" tick={{ fontSize: 11 }} /><Tooltip formatter={(v: number) => tzs(v)} /><Bar dataKey="value" fill="var(--ac)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
            <Panel title={t('recent')}><Table head={[t('s_no'), t('x_cust'), t('x_tot'), '']}>{d.recent.map((s) => <tr key={s.no}><td className="td">{s.no}</td><td className="td">{s.customer || t('walk')}</td><td className="td">{tzs(s.total)}</td><td className="td">{s.sync && s.sync !== 'synced' ? <Chip kind="p">{t('o_pend')}</Chip> : <Chip>{t('synced')}</Chip>}</td></tr>)}</Table></Panel>
          </div>
          <div>
            {!quick && <><Panel title={t('top')}><Table head={[t('p_name'), t('units')]}>{d.top.map((x) => <tr key={x.name}><td className="td">{x.name}</td><td className="td">{x.qty}</td></tr>)}</Table></Panel>
              <Panel title={t('low')}><Table head={[t('p_name'), t('p_stc')]} empty={d.low.length ? undefined : t('a_low0')}>{d.low.map((x) => <tr key={x.name}><td className="td">{x.name}</td><td className="td">{x.stock} {t('left')}</td></tr>)}</Table></Panel></>}
            {storeId === 'all' && <Panel title={t('storesP')}><Table head={[t('store'), t('k_sales')]}>{d.byStore.map((s) => <tr key={s.store}><td className="td">{me?.stores.find((x) => x.id === s.store)?.name}</td><td className="td">{tzs(s.sales)}</td></tr>)}</Table></Panel>}
          </div>
        </div>
      </>}
    </>
  )
}
