import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import type { Method } from '@/api/types'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'
import { tzs } from '@/lib/utils'

export default function Suppliers() {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify(); const [sp, setSp] = useSearchParams()
  const q = useQuery({ queryKey: ['suppliers'], queryFn: api.people.suppliers }), pur = useQuery({ queryKey: ['purchases'], queryFn: api.people.purchases })
  const [add, setAdd] = useState(false), [n, setN] = useState(''), [ph, setPh] = useState(''), [err, setErr] = useState(''), [amt, setAmt] = useState(''), [m, setM] = useState<Method>('cash'), [perr, setPerr] = useState('')
  const sel = q.data?.find((s) => s.name === sp.get('s'))
  const save = useMutation({ mutationFn: () => api.people.addSupplier(n.trim(), ph), onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); setAdd(false); setN(''); setPh(''); notify(t('p_saved')) }, onError: (e: Error) => setErr(e.message === 'DUPLICATE' ? t('p_dup') : e.message) })
  const pay = useMutation({ mutationFn: () => api.people.paySupplier(sel!.name, +amt, m), onSuccess: () => { qc.invalidateQueries(); setAmt(''); notify(t('p_saved')) }, onError: (e: Error) => setPerr(e.message === 'INVALID_AMOUNT' ? t('c_big') : e.message) })
  if (sel) return (
    <div><button className="lnk" onClick={() => setSp({})}>‹ {t('ret')}</button><PageHeader title={sel.name} />
      <Kpis items={[[t('v_bal'), tzs(sel.balance)]]} />
      {sel.balance > 0 && <section className="border-t border-bd pt-3 mb-6 max-w-[520px]"><h3 className="font-semibold mb-2">{t('v_pay')}</h3><div className="grid grid-cols-2 gap-3"><Field label={t('e_amt')} type="number" value={amt} onChange={(e) => setAmt(e.target.value)} error={perr} /><SelectField label={t('x_pay')} value={m} onChange={(e) => setM(e.target.value as Method)}>{(['cash', 'mm', 'bank'] as Method[]).map((x) => <option key={x} value={x}>{t('x_' + x)}</option>)}</SelectField></div>
        <button className="btn" disabled={pay.isPending} onClick={() => (+amt > 0 ? (setPerr(''), pay.mutate()) : setPerr(t('q_nz')))}>{t('p_save')}</button></section>}
      <h3 className="font-semibold mb-2">{t('nav').purchases}</h3>
      <Table head={[t('u_no'), t('i_date'), t('u_tot'), t('x_paid')]}>{(pur.data ?? []).filter((p) => p.supplier === sel.name).map((p) => <tr key={p.no}><td className="td">{p.no}</td><td className="td">{p.date}</td><td className="td">{tzs(p.total)}</td><td className="td">{tzs(p.paid)}</td></tr>)}</Table></div>)
  return (
    <>
      <PageHeader title={t('nav').suppliers}><button className="btn" onClick={() => setAdd(!add)}>+ {t('v_add')}</button></PageHeader>
      {add && <section className="border-t border-bd pt-3 mb-4"><div className="grid sm:grid-cols-2 gap-x-3"><Field label={t('v_name')} value={n} onChange={(e) => { setN(e.target.value); setErr('') }} error={err} /><Field label={t('v_ph')} type="tel" value={ph} onChange={(e) => setPh(e.target.value)} /></div><button className="btn" onClick={() => (n.trim() ? save.mutate() : setErr(t('req')))}>{t('p_save')}</button></section>}
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table head={[t('v_name'), t('v_ph'), t('v_bal')]}>{q.data.map((s) => <tr key={s.id}><td className="td"><button className="lnk" onClick={() => setSp({ s: s.name })}>{s.name}</button></td><td className="td">{s.phone}</td><td className="td">{tzs(s.balance)}</td></tr>)}</Table>}
    </>
  )
}
