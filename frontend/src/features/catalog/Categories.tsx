import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/api'
import type { Category } from '@/api/types'
import { useT } from '@/i18n'
import { Field, PageHeader, QueryState, SelectField, useNotify } from '@/components/ui'
import { catPath, subIds } from './Products'

export default function Categories() {
  const { t } = useT(); const qc = useQueryClient(); const notify = useNotify()
  const cats = useQuery({ queryKey: ['categories'], queryFn: api.catalog.categories }), prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products })
  const [name, setName] = useState(''), [parent, setParent] = useState(0), [err, setErr] = useState(''), [q, setQ] = useState(''), [open, setOpen] = useState<Record<number, boolean>>({ 1: true }), [conf, setConf] = useState(0)
  const done = () => qc.invalidateQueries({ queryKey: ['categories'] })
  const add = useMutation({ mutationFn: () => api.catalog.addCategory(name.trim(), parent), onSuccess: () => { done(); setName(''); notify(t('p_saved')) }, onError: (e: Error) => setErr(e.message === 'DUPLICATE' ? t('p_dup') : e.message) })
  const arch = useMutation({ mutationFn: api.catalog.archiveCategory, onSuccess: () => { done(); setConf(0); notify(t('p_saved')) }, onError: (e: Error) => { setConf(0); notify(e.message === 'CATEGORY_HAS_PRODUCTS' ? t('c_has') : e.message) } })
  const list = cats.data ?? []
  const count = (c: Category) => subIds(list, c.id).reduce((a, id) => a + (prods.data ?? []).filter((p) => p.categoryId === id).length, 0)
  const row = (c: Category, d: number, flat = false) => (
    <div key={c.id} className="flex items-center gap-2 py-1.5 border-b border-bd" style={{ paddingLeft: d * 22 }}>
      {!flat && list.some((x) => x.parent === c.id) ? <button className="lnk" aria-label="toggle" onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}>{open[c.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="w-7" />}
      <b>{flat ? catPath(list, c.id) : c.name}</b><small className="text-mu">{count(c)} {t('c_pc')}</small><span className="flex-1" />
      {conf === c.id ? <button className="lnk" onClick={() => arch.mutate(c.id)}>{t('p_conf')}</button> : <button className="lnk" onClick={() => setConf(c.id)}>{t('p_arch')}</button>}
    </div>)
  const tree = (pid: number, d: number): React.ReactNode => list.filter((c) => c.parent === pid).map((c) => <div key={c.id}>{row(c, d)}{open[c.id] && tree(c.id, d + 1)}</div>)
  return (
    <div className="max-w-[720px]">
      <PageHeader title={t('nav').categories} />
      <section className="border-t border-bd pt-3 mb-6"><h3 className="font-semibold mb-2">{t('c_add')}</h3>
        <div className="grid sm:grid-cols-2 gap-x-3"><Field label={t('c_name')} value={name} onChange={(e) => { setName(e.target.value); setErr('') }} error={err} />
          <SelectField label={t('c_par')} value={parent} onChange={(e) => setParent(+e.target.value)}><option value={0}>{t('c_top')}</option>{list.map((c) => <option key={c.id} value={c.id}>{catPath(list, c.id)}</option>)}</SelectField></div>
        <button className="btn" disabled={add.isPending} onClick={() => (name.trim() ? add.mutate() : setErr(t('req')))}>{t('c_add')}</button></section>
      <input className="inp mb-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('c_s')} aria-label={t('c_s')} />
      <QueryState loading={cats.isLoading} error={cats.error} />
      {q ? list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).map((c) => row(c, 0, true)) : tree(0, 0)}
    </div>
  )
}
