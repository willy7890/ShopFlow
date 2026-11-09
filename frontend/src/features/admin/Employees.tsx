import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Role } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Chip, Field, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'

export const ROLES: Role[] = ['owner', 'manager', 'storemgr', 'cashier', 'accountant', 'invmgr']
/** Display-only copy of the permission matrix. The BACKEND is the source of truth and returns `permissions` in /auth/me. */
const MATRIX: Record<Role, string[]> = {
  owner: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'ai', 'employees', 'stores', 'subscription', 'void', 'discount', 'settings'],
  manager: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'ai', 'employees', 'stores', 'void', 'discount', 'settings'],
  storemgr: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'void', 'discount', 'settings'],
  cashier: ['dash', 'pos', 'sales', 'customers', 'settings'], accountant: ['dash', 'sales', 'customers', 'finance', 'reports', 'ai', 'settings'], invmgr: ['dash', 'catalog', 'inventory', 'purchases', 'settings'],
}
const PERM_KEYS = MATRIX.owner

export default function Employees() {
  const { t } = useT(); const { me } = useAuth(); const qc = useQueryClient(); const notify = useNotify()
  const q = useQuery({ queryKey: ['employees'], queryFn: api.admin.employees })
  const [add, setAdd] = useState(false), [name, setName] = useState(''), [email, setEmail] = useState(''), [role, setRole] = useState<Role>('cashier'), [stores, setStores] = useState<string[]>(['s1']), [err, setErr] = useState<{ n?: string; e?: string }>({})
  const lim = me?.entitlements.limits.employees ?? 0, full = (q.data?.length ?? 0) >= lim
  const invite = useMutation({ mutationFn: () => api.admin.invite({ name, email, role, stores }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setAdd(false); setName(''); setEmail(''); notify(t('em_sent')) }, onError: (e: Error) => setErr({ e: e.message === 'DUPLICATE' ? t('p_dup') : e.message === 'PLAN_LIMIT' ? t('em_limit') : e.message }) })
  const upd = useMutation({ mutationFn: (a: { id: string; patch: Parameters<typeof api.admin.updateEmployee>[1] }) => api.admin.updateEmployee(a.id, a.patch), onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }) })
  const submit = () => { const er: typeof err = {}; if (!name.trim()) er.n = t('req'); if (!/^\S+@\S+\.\S+$/.test(email)) er.e = t('bademail'); setErr(er); if (!er.n && !er.e) invite.mutate() }
  const stName = (id: string) => me?.stores.find((s) => s.id === id)?.name ?? id
  return (
    <>
      <PageHeader title={t('nav').employees}><button className="btn" disabled={full} onClick={() => setAdd(!add)}>+ {t('em_invite')}</button></PageHeader>
      {full && <p className="text-sm border border-dashed border-bd rounded-lg p-2 mb-3">{t('em_limit')}</p>}
      {add && <section className="border-t border-bd pt-3 mb-4"><div className="grid sm:grid-cols-2 gap-x-3"><Field label={t('v_name')} value={name} onChange={(e) => setName(e.target.value)} error={err.n} /><Field label={t('email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={err.e} /></div>
        <div className="grid sm:grid-cols-2 gap-x-3"><SelectField label={t('em_role')} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{t('r_' + r)}</option>)}</SelectField>
          <div className="mb-4"><span className="block text-sm font-semibold mb-1">{t('em_stores')}</span>{me?.stores.map((s) => <label key={s.id} className="mr-3 text-sm"><input type="checkbox" checked={stores.includes(s.id)} onChange={(e) => setStores(e.target.checked ? [...stores, s.id] : stores.filter((x) => x !== s.id))} /> {s.name}</label>)}</div></div>
        <button className="btn" disabled={invite.isPending} onClick={submit}>{invite.isPending ? t('wait') : t('em_invite')}</button></section>}
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && <Table head={[t('v_name'), t('email'), t('em_role'), t('em_stores'), t('em_status'), '']}>{q.data.map((m) => <tr key={m.id}><td className="td">{m.name}</td><td className="td">{m.email}</td>
        <td className="td"><select className="inp !min-h-[34px] !w-auto" value={m.role} onChange={(e) => upd.mutate({ id: m.id, patch: { role: e.target.value as Role } })}>{ROLES.map((r) => <option key={r} value={r}>{t('r_' + r)}</option>)}</select></td>
        <td className="td">{m.stores.map(stName).join(', ')}</td><td className="td"><Chip kind={m.status === 'active' ? 'ok' : m.status === 'invited' ? 'p' : 'e'}>{t('em_' + m.status)}</Chip></td>
        <td className="td"><button className="lnk" onClick={() => upd.mutate({ id: m.id, patch: { status: m.status === 'active' ? 'inactive' : 'active' } })}>{t('em_toggle')}</button></td></tr>)}</Table>}
      <section className="mt-6"><h3 className="font-semibold mb-2">{t('em_matrix')}</h3>
        <Table head={['', ...ROLES.map((r) => t('r_' + r))]}>{PERM_KEYS.map((k) => <tr key={k}><td className="td">{k}</td>{ROLES.map((r) => <td key={r} className="td">{MATRIX[r].includes(k) ? <span className="text-ok">✓</span> : '—'}</td>)}</tr>)}</Table></section>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('em_note')}</p>
    </>
  )
}
