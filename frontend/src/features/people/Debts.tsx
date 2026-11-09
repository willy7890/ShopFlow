import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { useT } from '@/i18n'
import { PageHeader, QueryState, Table } from '@/components/ui'
import { tzs } from '@/lib/utils'

export default function Debts() {
  const { t } = useT(); const q = useQuery({ queryKey: ['customers'], queryFn: api.people.customers })
  const rows = (q.data ?? []).filter((c) => c.balance > 0)
  return (
    <>
      <PageHeader title={t('nav').debts} />
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table empty={rows.length ? undefined : t('d_empty')} head={[t('x_cust'), t('d_a'), t('d_b'), t('d_c'), t('c_bal'), '']}>
        {rows.map((c) => <tr key={c.id}><td className="td"><b>{c.name}</b></td><td className="td">{tzs(c.aging[0])}</td><td className="td">{tzs(c.aging[1])}</td><td className={`td ${c.aging[2] ? 'text-er' : 'text-mu'}`}>{tzs(c.aging[2])}</td><td className="td"><b>{tzs(c.balance)}</b></td><td className="td"><Link className="lnk" to={`/customers?c=${encodeURIComponent(c.name)}`}>{t('d_view')}</Link></td></tr>)}</Table>}
    </>
  )
}
