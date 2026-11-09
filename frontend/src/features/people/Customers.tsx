import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Method } from '@/api/types'
import type { CustomerRow } from '@/api/api'
import { useT } from '@/i18n'
import { Chip, Field, Kpis, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'
import { StatusChip } from '@/features/sales/Sales'
import { tzs } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'

export default function Customers() {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify(); const [sp, setSp] = useSearchParams()
  const q = useQuery({ queryKey: ['customers'], queryFn: api.people.customers }), sales = useQuery({ queryKey: ['sales'], queryFn: api.sales.list })
  const [search, setSearch] = useState(''), [add, setAdd] = useState(false), [n, setN] = useState(''), [ph, setPh] = useState(''), [err, setErr] = useState(''), [amt, setAmt] = useState(''), [m, setM] = useState<Method>('cash'), [perr, setPerr] = useState('')
  const sel = q.data?.find((c) => c.name === sp.get('c'))
  const save = useMutation({ mutationFn: () => api.people.addCustomer(n.trim(), ph), onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); setAdd(false); setN(''); setPh(''); notify(t('p_saved')) }, onError: (e: Error) => setErr(e.message === 'DUPLICATE' ? t('p_dup') : e.message) })
  const pay = useMutation({ mutationFn: () => api.people.payDebt(sel!.name, +amt, m), onSuccess: () => { qc.invalidateQueries(); setAmt(''); notify(t('c_pr')) }, onError: (e: Error) => setPerr(e.message === 'INVALID_AMOUNT' ? t('c_big') : e.message) })
  if (sel) return <Detail c={sel} sales={(sales.data ?? []).filter((s) => s.customer === sel.name)} back={() => setSp({})} amt={amt} setAmt={setAmt} m={m} setM={setM} pay={() => (+amt > 0 ? (setPerr(''), pay.mutate()) : setPerr(t('q_nz')))} err={perr} busy={pay.isPending} />
  const list = (q.data ?? []).filter((c) => !search || `${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <>
      <PageHeader title={t('nav').customers}><button className="btn" onClick={() => setAdd(!add)}>+ {t('c_add2')}</button></PageHeader>
      {add && <section className="border-t border-bd pt-3 mb-4"><div className="grid sm:grid-cols-2 gap-x-3"><Field label={t('v_name')} value={n} onChange={(e) => { setN(e.target.value); setErr('') }} error={err} /><Field label={t('c_ph')} type="tel" value={ph} onChange={(e) => setPh(e.target.value)} /></div><button className="btn" onClick={() => (n.trim() ? save.mutate() : setErr(t('req')))}>{t('p_save')}</button></section>}
      <input className="inp !max-w-[300px] mb-3" placeholder={t('c_srch')} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t('c_srch')} />
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table head={[t('v_name'), t('c_ph'), t('c_bal')]}>{list.map((c) => <tr key={c.id}><td className="td"><button className="lnk" onClick={() => setSp({ c: c.name })}>{c.name}</button></td><td className="td">{c.phone}</td><td className="td">{c.balance ? <Chip kind="e">{tzs(c.balance)}</Chip> : t('c_none')}</td></tr>)}</Table>}
    </>
  )
}

function Detail({ c, sales, back, amt, setAmt, m, setM, pay, err, busy }: { c: CustomerRow; sales: import('@/api/types').Sale[]; back: () => void; amt: string; setAmt: (v: string) => void; m: Method; setM: (m: Method) => void; pay: () => void; err: string; busy: boolean }) {
  const { t } = useT()
  return (
    <div>
      <button className="lnk" onClick={back}>‹ {t('ret')}</button><PageHeader title={c.name} /><p className="text-mu -mt-2 mb-3">{c.phone}</p>
      <Kpis items={[[t('c_bal'), tzs(c.balance)], [t('d_a'), tzs(c.aging[0])], [t('d_b'), tzs(c.aging[1])], [t('d_c'), tzs(c.aging[2])]]} />
      {c.balance > 0 && <section className="border-t border-bd pt-3 mb-6 max-w-[520px]"><h3 className="font-semibold mb-2">{t('c_rec')}</h3>
        <div className="grid grid-cols-2 gap-3"><Field label={t('e_amt')} type="number" value={amt} onChange={(e) => setAmt(e.target.value)} error={err} /><SelectField label={t('x_pay')} value={m} onChange={(e) => setM(e.target.value as Method)}>{(['cash', 'mm', 'bank'] as Method[]).map((x) => <option key={x} value={x}>{t('x_' + x)}</option>)}</SelectField></div>
        <button className="btn" disabled={busy} onClick={pay}>{busy ? t('wait') : t('c_rec')}</button></section>}
      <h3 className="font-semibold mb-2">{t('c_hist')}</h3>
      <Table head={[t('s_no'), t('i_date'), t('x_tot'), t('x_due'), '']}>{sales.map((s) => <tr key={s.no}><td className="td">{s.no}</td><td className="td">{s.date}</td><td className="td">{tzs(s.total)}</td><td className="td">{tzs(s.due)}</td><td className="td"><StatusChip s={s} /></td></tr>)}</Table>
    </div>
  )
}
