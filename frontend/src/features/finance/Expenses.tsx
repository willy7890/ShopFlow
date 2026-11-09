import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Expense, Method } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'
import { today, tzs } from '@/lib/utils'

export const EXPENSE_CATS = ['rent', 'electricity', 'water', 'transport', 'salaries', 'internet', 'maintenance', 'equipment', 'other']

export default function Expenses() {
  const { t } = useT(); const { me } = useAuth(); const q = useQuery({ queryKey: ['expenses'], queryFn: api.finance.expenses })
  const [form, setForm] = useState<Expense | 'new' | null>(null), [cat, setCat] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('')
  if (form) return <ExpenseForm initial={form === 'new' ? null : form} onDone={() => setForm(null)} />
  const rows = (q.data ?? []).filter((x) => (!cat || x.category === cat) && (!from || x.date >= from) && (!to || x.date <= to)).sort((a, b) => (a.date < b.date ? 1 : -1))
  return (
    <>
      <PageHeader title={t('nav').expenses}><button className="btn" onClick={() => setForm('new')}>+ {t('e_add')}</button></PageHeader>
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select className="inp !w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('e_cat')}><option value="">{t('e_all')}</option>{EXPENSE_CATS.map((c) => <option key={c} value={c}>{t('ec_' + c)}</option>)}</select>
        <label className="flex items-center gap-1.5 text-sm">{t('n_from')}<input type="date" className="inp !w-auto !min-h-[38px]" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-sm">{t('n_to')}<input type="date" className="inp !w-auto !min-h-[38px]" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <Kpis items={[[t('e_tot'), tzs(rows.reduce((a, x) => a + x.amount, 0))]]} />
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table empty={rows.length ? undefined : t('e_none')} head={[t('e_date'), t('e_cat'), t('e_desc'), t('store'), t('x_pay'), t('e_amt'), '']}>
        {rows.map((x) => <tr key={x.id}><td className="td">{x.date}</td><td className="td">{t('ec_' + x.category)}</td><td className="td">{x.description}{x.receipt && ' 📎'}{x.edited && <small className="text-mu"> ({t('e_ed')})</small>}</td><td className="td">{me?.stores.find((s) => s.id === x.store)?.name}</td><td className="td">{t('x_' + x.method)}</td><td className="td">{tzs(x.amount)}</td><td className="td"><button className="lnk" onClick={() => setForm(x)}>{t('p_edt')}</button></td></tr>)}</Table>}
    </>
  )
}

function ExpenseForm({ initial, onDone }: { initial: Expense | null; onDone: () => void }) {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify(); const { me } = useAuth()
  const S = z.object({ category: z.string().min(1, t('req')), amount: z.coerce.number().positive(t('p_pos')), date: z.string().min(1, t('req')), store: z.string(), method: z.string(), description: z.string(), receipt: z.string().optional() })
  const f = useForm<z.infer<typeof S>>({ resolver: zodResolver(S), defaultValues: initial ?? { category: '', amount: '' as unknown as number, date: today(), store: me?.stores[0]?.id ?? 's1', method: 'cash', description: '' } })
  const m = useMutation({ mutationFn: (d: z.infer<typeof S>) => api.finance.saveExpense({ ...d, method: d.method as Method, id: initial?.id }), onSuccess: () => { qc.invalidateQueries(); notify(t('p_saved')); onDone() } })
  const e = f.formState.errors, rc = f.watch('receipt')
  return (
    <form className="max-w-[600px]" onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
      <PageHeader title={initial ? t('e_edit') : t('e_add')} />
      <SelectField label={t('e_cat')} error={e.category?.message} {...f.register('category')}><option value="">{t('pick')}</option>{EXPENSE_CATS.map((c) => <option key={c} value={c}>{t('ec_' + c)}</option>)}</SelectField>
      <div className="grid grid-cols-2 gap-3"><Field label={t('e_amt')} type="number" error={e.amount?.message} {...f.register('amount')} /><Field label={t('e_date')} type="date" error={e.date?.message} {...f.register('date')} /></div>
      <div className="grid grid-cols-2 gap-3"><SelectField label={t('store')} {...f.register('store')}>{me?.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField><SelectField label={t('x_pay')} {...f.register('method')}>{(['cash', 'mm', 'bank'] as Method[]).map((x) => <option key={x} value={x}>{t('x_' + x)}</option>)}</SelectField></div>
      <Field label={t('e_desc')} {...f.register('description')} />
      <label className="block mb-4"><span className="block text-sm font-semibold mb-1">{t('e_rc')}</span><input type="file" accept="image/*,application/pdf" onChange={(ev) => f.setValue('receipt', ev.target.files?.[0]?.name ?? '')} />{rc && <small className="text-mu block">📎 {rc}</small>}<small className="text-mu">{t('e_rc')}: demo stores the file name only.</small></label>
      {m.error && <p className="text-er text-sm mb-2" role="alert">{(m.error as Error).message}</p>}
      <div className="flex gap-3"><button type="button" className="btn btn-ghost" onClick={onDone}>{t('p_cancel')}</button><button className="btn flex-1" disabled={m.isPending}>{m.isPending ? t('wait') : t('p_save')}</button></div>
    </form>
  )
}
