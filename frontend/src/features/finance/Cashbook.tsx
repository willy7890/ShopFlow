import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import { useT } from '@/i18n'
import { Kpis, PageHeader, QueryState, Table } from '@/components/ui'
import { tzs } from '@/lib/utils'

export default function Cashbook() {
  const { t } = useT(); const q = useQuery({ queryKey: ['cashbook'], queryFn: api.finance.cashbook }), sales = useQuery({ queryKey: ['sales'], queryFn: api.sales.list })
  const [from, setFrom] = useState(''), [to, setTo] = useState('')
  const all = q.data ?? [], rows = all.filter((x) => (!from || x.date >= from) && (!to || x.date <= to))
  const cr = (sales.data ?? []).filter((s) => !s.voided && (!from || s.date >= from) && (!to || s.date <= to)).reduce((a, s) => a + (s.total - s.initialPaid), 0)
  return (
    <>
      <PageHeader title={t('nav').cashbook} />
      <div className="flex gap-2 mb-4 items-center flex-wrap"><label className="flex items-center gap-1.5 text-sm">{t('n_from')}<input type="date" className="inp !w-auto !min-h-[38px]" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="flex items-center gap-1.5 text-sm">{t('n_to')}<input type="date" className="inp !w-auto !min-h-[38px]" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <>
        <Kpis items={[[t('cb_in'), tzs(rows.reduce((a, x) => a + x.in, 0))], [t('cb_out'), tzs(rows.reduce((a, x) => a + x.out, 0))], [t('cb_bal'), tzs(all[all.length - 1]?.balance ?? 0)], [t('cb_cr'), tzs(cr)]]} />
        <Table head={[t('e_date'), t('s_type'), t('i_ref'), t('x_pay'), t('cb_in'), t('cb_out'), t('cb_run')]}>
          {[...rows].reverse().map((x, i) => <tr key={i}><td className="td">{x.date}</td><td className="td">{t('cb_' + x.type)}</td><td className="td">{x.type === 'expense' ? t('ec_' + x.ref) : x.ref}</td><td className="td">{x.method.split(', ').map((m) => (m ? t('x_' + m) : '')).join(', ')}</td><td className="td text-ok">{x.in ? tzs(x.in) : ''}</td><td className="td text-er">{x.out ? tzs(x.out) : ''}</td><td className="td">{tzs(x.balance)}</td></tr>)}
        </Table>
        <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('cb_note')}</p></>}
    </>
  )
}
