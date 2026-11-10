import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, Panel, QueryState, SelectField, Table, useNotify } from '@/components/ui'

export default function PlatformAdmin() {
  const { t } = useT()
  const isSuperAdmin = useAuth((state) => state.me?.user.isSuperAdmin ?? false)
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [reason, setReason] = useState('')
  const [grantBusiness, setGrantBusiness] = useState('')
  const [planId, setPlanId] = useState('')
  const [durationDays, setDurationDays] = useState('')
  const [createPlan, setCreatePlan] = useState(false)
  const [planSlug, setPlanSlug] = useState('')
  const [planName, setPlanName] = useState('')
  const [planPrice, setPlanPrice] = useState('')
  const [planCurrency, setPlanCurrency] = useState('TZS')
  const [planDays, setPlanDays] = useState('30')
  const [planFeatures, setPlanFeatures] = useState('{}')
  const [error, setError] = useState('')

  const analytics = useQuery({ queryKey: ['platform-admin', 'analytics'], queryFn: api.platformAdmin.analytics, enabled: isSuperAdmin })
  const businesses = useQuery({ queryKey: ['platform-admin', 'businesses'], queryFn: api.platformAdmin.businesses, enabled: isSuperAdmin })
  const users = useQuery({ queryKey: ['platform-admin', 'users'], queryFn: api.platformAdmin.users, enabled: isSuperAdmin })
  const plans = useQuery({ queryKey: ['platform-admin', 'plans'], queryFn: api.platformAdmin.plans, enabled: isSuperAdmin })
  const audit = useQuery({ queryKey: ['platform-admin', 'audit'], queryFn: api.platformAdmin.audit, enabled: isSuperAdmin })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['platform-admin'] })
  }
  const createPlanMutation = useMutation({
    mutationFn: async () => {
      const features: unknown = JSON.parse(planFeatures)
      if (!features || typeof features !== 'object' || Array.isArray(features)) throw new Error(t('sa_validation'))
      await api.platformAdmin.createPlan({
        slug: planSlug.trim().toLowerCase(),
        name: planName.trim(),
        price: planPrice,
        currency: planCurrency.trim().toUpperCase(),
        duration_days: Number(planDays),
        features: features as Record<string, boolean | number | string>,
      })
    },
    onSuccess: async () => {
      await refresh()
      setCreatePlan(false)
      setPlanSlug('')
      setPlanName('')
      setPlanPrice('')
      setPlanFeatures('{}')
      setError('')
      notify(t('sa_plan_created'))
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const grant = useMutation({
    mutationFn: () => api.platformAdmin.grantPlan(
      grantBusiness,
      planId,
      durationDays ? Number(durationDays) : undefined,
      reason.trim(),
    ),
    onSuccess: async () => {
      await refresh()
      setGrantBusiness('')
      setDurationDays('')
      setError('')
      notify(t('sa_saved'))
    },
    onError: (reason: Error) => setError(reason.message),
  })
  const setBusinessStatus = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api.platformAdmin.setBusinessStatus(input.id, input.isActive, reason.trim()),
    onSuccess: async () => { await refresh(); setError(''); notify(t('sa_saved')) },
    onError: (reason: Error) => setError(reason.message),
  })
  const setUserStatus = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      api.platformAdmin.setUserStatus(input.id, input.isActive, reason.trim()),
    onSuccess: async () => { await refresh(); setError(''); notify(t('sa_saved')) },
    onError: (reason: Error) => setError(reason.message),
  })

  if (!isSuperAdmin) return <p role="alert" className="text-er">{t('sa_forbidden')}</p>

  const loading = analytics.isLoading || businesses.isLoading || users.isLoading || plans.isLoading || audit.isLoading
  const queryError = analytics.error ?? businesses.error ?? users.error ?? plans.error ?? audit.error
  const planNameFor = (id: string | null) => plans.data?.find((plan) => plan.id === id)?.name ?? t('sa_no_plan')
  const reasonValid = reason.trim().length >= 5

  return (
    <>
      <PageHeader title={t('sa_title')} />
      <QueryState loading={loading} error={queryError} />
      {analytics.data && (
        <Panel title={t('sa_overview')}>
          <Kpis items={[
            [t('sa_businesses'), String(analytics.data.business_count)],
            [t('sa_active_businesses'), String(analytics.data.active_business_count)],
            [t('sa_users'), String(analytics.data.user_count)],
            [t('sa_active_subscriptions'), String(analytics.data.active_subscription_count)],
            [t('sa_pending_subscriptions'), String(analytics.data.pending_subscription_count)],
            [t('sa_revenue'), analytics.data.confirmed_subscription_revenue === null
              ? '—'
              : `${analytics.data.currency ?? ''} ${analytics.data.confirmed_subscription_revenue}`],
          ]} />
        </Panel>
      )}

      <Panel title={t('sa_reason')}>
        <Field label={t('sa_reason')} value={reason} onChange={(event) => setReason(event.target.value)} />
        {error && <p role="alert" className="text-er text-sm mb-3">{error}</p>}
      </Panel>

      <Panel title={t('sa_businesses')}>
        {plans.data?.length === 0 && <p className="text-sm text-mu mb-3">{t('sa_no_plans')}</p>}
        <div className="mb-3">
          <button className="btn btn-ghost" onClick={() => setCreatePlan((open) => !open)}>{t('sa_create_plan')}</button>
        </div>
        {createPlan && (
          <section className="rounded-lg border border-bd p-4 mb-4">
            <div className="grid sm:grid-cols-2 gap-x-3">
              <Field label={t('sa_plan_slug')} value={planSlug} onChange={(event) => setPlanSlug(event.target.value)} />
              <Field label={t('sa_plan_name')} value={planName} onChange={(event) => setPlanName(event.target.value)} />
              <Field label={t('sa_plan_price')} type="number" value={planPrice} onChange={(event) => setPlanPrice(event.target.value)} />
              <Field label={t('sa_plan_currency')} value={planCurrency} onChange={(event) => setPlanCurrency(event.target.value)} />
              <Field label={t('sa_plan_days')} type="number" value={planDays} onChange={(event) => setPlanDays(event.target.value)} />
              <Field label={t('sa_plan_features')} value={planFeatures} onChange={(event) => setPlanFeatures(event.target.value)} />
            </div>
            <button
              className="btn"
              disabled={createPlanMutation.isPending || !reasonValid || !planSlug.trim() || !planName.trim() || !planPrice || !planDays}
              onClick={() => createPlanMutation.mutate()}
            >
              {createPlanMutation.isPending ? t('wait') : t('sa_create_plan')}
            </button>
          </section>
        )}
        {businesses.data && (
          <Table head={[t('sa_businesses'), t('sa_plan'), t('sa_status'), t('sa_actions')]}>
            {businesses.data.map((business) => (
              <tr key={business.id}>
                <td className="td">
                  <b>{business.name}</b>
                  <small className="block text-mu">{business.business_type} · {business.currency}</small>
                </td>
                <td className="td">
                  {planNameFor(business.subscription?.plan_id ?? null)}
                  {business.subscription?.expires_at && (
                    <small className="block text-mu">{t('sa_expires')}: {business.subscription.expires_at.slice(0, 10)}</small>
                  )}
                </td>
                <td className="td">{t(business.is_active ? 'sa_active' : 'sa_inactive')}</td>
                <td className="td whitespace-nowrap">
                  <button
                    className="lnk mr-2"
                    disabled={!reasonValid || setBusinessStatus.isPending}
                    onClick={() => setBusinessStatus.mutate({ id: business.id, isActive: !business.is_active })}
                  >
                    {t(business.is_active ? 'sa_deactivate' : 'sa_activate')}
                  </button>
                  <button
                    className="lnk"
                    disabled={!plans.data?.some((plan) => plan.is_active)}
                    onClick={() => {
                      setGrantBusiness(business.id)
                      setPlanId(plans.data?.find((plan) => plan.is_active)?.id ?? '')
                      setError('')
                    }}
                  >
                    {t('sa_grant')}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {grantBusiness && (
        <Panel title={t('sa_granting')}>
          <div className="grid sm:grid-cols-3 gap-x-3">
            <SelectField label={t('sa_plan')} value={planId} onChange={(event) => setPlanId(event.target.value)}>
              {(plans.data ?? []).filter((plan) => plan.is_active).map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} · {plan.currency} {plan.price}</option>
              ))}
            </SelectField>
            <Field label={t('sa_duration')} type="number" value={durationDays} onChange={(event) => setDurationDays(event.target.value)} />
          </div>
          <button
            className="btn mr-2"
            disabled={!reasonValid || !planId || grant.isPending}
            onClick={() => grant.mutate()}
          >
            {grant.isPending ? t('wait') : t('sa_apply')}
          </button>
          <button className="btn btn-ghost" onClick={() => setGrantBusiness('')}>{t('sa_cancel')}</button>
        </Panel>
      )}

      <Panel title={t('sa_users')}>
        {users.data && (
          <Table head={[t('v_name'), t('email'), t('sa_status'), t('sa_actions')]}>
            {users.data.map((user) => (
              <tr key={user.id}>
                <td className="td">{user.full_name}{user.is_super_admin && <small className="block text-mu">Super Admin</small>}</td>
                <td className="td">{user.email}</td>
                <td className="td">{t(user.is_active ? 'sa_active' : 'sa_inactive')}</td>
                <td className="td">
                  <button
                    className="lnk"
                    disabled={!reasonValid || setUserStatus.isPending || (user.is_super_admin && user.id === useAuth.getState().me?.user.id)}
                    onClick={() => setUserStatus.mutate({ id: user.id, isActive: !user.is_active })}
                  >
                    {t(user.is_active ? 'sa_deactivate' : 'sa_activate')}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={t('sa_audit')}>
        {audit.data && (
          <Table head={[t('sa_date'), t('sa_event'), t('sa_details')]}>
            {audit.data.map((entry) => (
              <tr key={entry.id}>
                <td className="td whitespace-nowrap">{entry.created_at.slice(0, 16).replace('T', ' ')}</td>
                <td className="td">{entry.event_type}</td>
                <td className="td max-w-[360px] break-words">{JSON.stringify(entry.details)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  )
}
