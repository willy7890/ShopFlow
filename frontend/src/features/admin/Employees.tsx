import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Role } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Chip, Field, PageHeader, QueryState, SelectField, Table, useNotify } from '@/components/ui'

export const ROLES: Role[] = ['owner', 'manager', 'storemgr', 'cashier', 'accountant', 'invmgr']

const PERMISSIONS = [
  'manage_business', 'manage_stores', 'manage_employees', 'manage_products',
  'manage_inventory', 'manage_sales', 'manage_orders', 'manage_finance',
  'manage_customers', 'manage_suppliers', 'view_reports', 'view_dashboard', 'manage_sync',
]
const DEFAULT_PERMISSIONS: Record<Role, string[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((permission) => permission !== 'manage_sync'),
  storemgr: ['manage_products', 'manage_inventory', 'manage_sales', 'manage_orders', 'view_reports', 'view_dashboard'],
  cashier: ['manage_sales', 'view_dashboard'],
  accountant: ['manage_finance', 'manage_customers', 'manage_suppliers', 'view_reports', 'view_dashboard'],
  invmgr: ['manage_inventory', 'manage_products', 'view_reports', 'view_dashboard'],
}
export default function Employees() {
  const { t } = useT()
  const { me } = useAuth()
  const qc = useQueryClient()
  const notify = useNotify()
  const q = useQuery({ queryKey: ['employees'], queryFn: api.admin.employees })
  const [add, setAdd] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('cashier')
  const [stores, setStores] = useState<string[]>([])
  const [invitePermissions, setInvitePermissions] = useState<string[]>(DEFAULT_PERMISSIONS.cashier)
  const [editing, setEditing] = useState<{ id: string; permissions: string[] } | null>(null)
  const [error, setError] = useState('')
  const [emailError, setEmailError] = useState('')

  const isOwner = me?.user.role === 'owner'
  const assignablePermissions = isOwner
    ? PERMISSIONS
    : PERMISSIONS.filter((permission) => me?.user.businessPermissions?.includes(permission))
  const limit = me?.entitlements.limits.employees ?? 0
  const full = (q.data?.length ?? 0) >= limit

  const invite = useMutation({
    mutationFn: () => api.admin.invite({ email, role, stores, permissions: invitePermissions }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['employees'] })
      setAdd(false)
      setEmail('')
      setError('')
      notify(t('em_sent'))
    },
    onError: (reason: Error) => setError(reason.message === 'DUPLICATE'
      ? t('p_dup')
      : reason.message === 'PLAN_LIMIT' ? t('em_limit') : reason.message),
  })
  const update = useMutation({
    mutationFn: (args: { id: string; patch: Parameters<typeof api.admin.updateEmployee>[1] }) =>
      api.admin.updateEmployee(args.id, args.patch),
    onSuccess: async (_result, args) => {
      await qc.invalidateQueries({ queryKey: ['employees'] })
      if (args.patch.permissions) {
        setEditing(null)
        notify(t('em_permission_saved'))
      }
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const stName = (id: string) => me?.stores.find((store) => store.id === id)?.name ?? id
  const setRoleDefaults = (nextRole: Role) => {
    setRole(nextRole)
    setInvitePermissions(DEFAULT_PERMISSIONS[nextRole].filter((permission) => assignablePermissions.includes(permission)))
  }
  const submitInvite = () => {
    const validEmail = /^\S+@\S+\.\S+$/.test(email)
    setEmailError(validEmail ? '' : t('bademail'))
    setError('')
    if (validEmail) invite.mutate()
  }
  const toggle = (values: string[], permission: string) => values.includes(permission)
    ? values.filter((value) => value !== permission)
    : [...values, permission]

  return (
    <>
      <PageHeader title={t('nav').employees}>
        <button className="btn" disabled={full} onClick={() => { setAdd(!add); setError('') }}>
          + {t('em_invite')}
        </button>
      </PageHeader>
      {full && <p className="text-sm border border-dashed border-bd rounded-lg p-2 mb-3">{t('em_limit')}</p>}
      {add && (
        <section className="border-t border-bd pt-3 mb-4">
          <p className="text-sm text-mu mb-3">{t('em_registered_required')}</p>
          <Field label={t('email')} type="email" value={email} onChange={(event) => setEmail(event.target.value)} error={emailError} />
          <div className="grid sm:grid-cols-2 gap-x-3">
            <SelectField label={t('em_role')} value={role} onChange={(event) => setRoleDefaults(event.target.value as Role)}>
              {ROLES.filter((item) => isOwner || item !== 'owner').map((item) => (
                <option key={item} value={item}>{t('r_' + item)}</option>
              ))}
            </SelectField>
            <div className="mb-4">
              <span className="block text-sm font-semibold mb-1">{t('em_stores')}</span>
              {me?.stores.map((store) => (
                <label key={store.id} className="mr-3 text-sm">
                  <input
                    type="checkbox"
                    checked={stores.includes(store.id)}
                    onChange={(event) => setStores(event.target.checked ? [...stores, store.id] : stores.filter((id) => id !== store.id))}
                  /> {store.name}
                </label>
              ))}
            </div>
          </div>
          <h3 className="font-semibold mb-2">{t('em_grant_permissions')}</h3>
          <PermissionChoices
            available={assignablePermissions}
            selected={invitePermissions}
            onChange={(permission) => setInvitePermissions((current) => toggle(current, permission))}
            t={t}
          />
          <button className="btn mt-3" disabled={invite.isPending} onClick={submitInvite}>
            {invite.isPending ? t('wait') : t('em_invite')}
          </button>
          {error && <p role="alert" className="text-er text-sm mt-2">{error}</p>}
        </section>
      )}
      {!add && error && <p role="alert" className="text-er text-sm mb-3">{error}</p>}
      <QueryState loading={q.isLoading} error={q.error} />
      {q.data && (
        <Table head={[t('v_name'), t('email'), t('em_role'), t('em_stores'), t('em_status'), '']}>
          {q.data.map((employee) => (
            <tr key={employee.id}>
              <td className="td">{employee.name}</td>
              <td className="td">{employee.email}</td>
              <td className="td">
                <select
                  className="inp !min-h-[34px] !w-auto"
                  value={employee.role}
                  disabled={update.isPending || employee.role === 'owner'}
                  onChange={(event) => {
                    const nextRole = event.target.value as Role
                    const permissions = DEFAULT_PERMISSIONS[nextRole].filter((permission) => assignablePermissions.includes(permission))
                    update.mutate({ id: employee.id, patch: { role: nextRole, permissions } })
                  }}
                >
                  {ROLES.filter((item) => isOwner || item !== 'owner').map((item) => (
                    <option key={item} value={item}>{t('r_' + item)}</option>
                  ))}
                </select>
              </td>
              <td className="td">{employee.stores.map(stName).join(', ')}</td>
              <td className="td">
                <Chip kind={employee.status === 'active' ? 'ok' : employee.status === 'invited' ? 'p' : 'e'}>
                  {t('em_' + employee.status)}
                </Chip>
              </td>
              <td className="td whitespace-nowrap">
                <button
                  className="lnk mr-2"
                  onClick={() => { setEditing({ id: employee.id, permissions: employee.permissions }); setError('') }}
                  disabled={employee.role === 'owner'}
                >
                  {t('em_manage_permissions')}
                </button>
                <button
                  className="lnk"
                  disabled={update.isPending || employee.role === 'owner'}
                  onClick={() => update.mutate({ id: employee.id, patch: { status: employee.status === 'active' ? 'inactive' : 'active' } })}
                >
                  {t('em_toggle')}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && q.data && (
        <section className="mt-4 rounded-lg border border-bd p-4">
          <h3 className="font-semibold mb-1">{t('em_grant_permissions')}</h3>
          <p className="text-sm text-mu mb-3">{t('em_access_info')}</p>
          <PermissionChoices
            available={assignablePermissions}
            selected={editing.permissions}
            onChange={(permission) => setEditing((current) => current && ({
              ...current,
              permissions: toggle(current.permissions, permission),
            }))}
            t={t}
          />
          <div className="flex gap-2 mt-4">
            <button
              className="btn"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: editing.id, patch: { permissions: editing.permissions } })}
            >
              {update.isPending ? t('wait') : t('em_save_permissions')}
            </button>
            <button className="btn btn-ghost" onClick={() => setEditing(null)}>{t('back')}</button>
          </div>
        </section>
      )}
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('em_note')}</p>
    </>
  )
}

function PermissionChoices({
  available,
  selected,
  onChange,
  t,
}: {
  available: string[]
  selected: string[]
  onChange: (permission: string) => void
  t: (key: string) => string
}) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {available.map((permission) => (
        <label key={permission} className="flex items-center gap-2 rounded-md border border-bd p-2 text-sm">
          <input type="checkbox" checked={selected.includes(permission)} onChange={() => onChange(permission)} />
          {t(`em_perm_${permission}`)}
        </label>
      ))}
    </div>
  )
}
