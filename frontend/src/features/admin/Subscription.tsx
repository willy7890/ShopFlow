import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import { Field, Kpis, PageHeader, Panel, QueryState, Table, useNotify } from '@/components/ui'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'

const money = (price: string, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(price)) }
  catch { return `${currency} ${price}` }
}

export default function Subscription() {
  const { t } = useT()
  const me = useAuth((state) => state.me)
  const notify = useNotify()
  const queryClient = useQueryClient()
  const [reference, setReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'manual' | 'mobile_money' | 'bank' | 'cash'>('manual')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16))
  const canManage = ['owner', 'manager', 'business_manager'].includes(me?.user.role ?? '')

  const plans = useQuery({ queryKey: ['subscription', 'plans'], queryFn: api.subscription.plans })
  const current = useQuery({ queryKey: ['subscription', 'current'], queryFn: api.subscription.current })
  const history = useQuery({ queryKey: ['subscription', 'history'], queryFn: api.subscription.history })
  const payments = useQuery({ queryKey: ['subscription', 'payments'], queryFn: api.subscription.payments })
  const instructions = useQuery({ queryKey: ['subscription', 'payment-instructions'], queryFn: api.subscription.paymentInstructions })
  const refresh = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['subscription'] }),
    queryClient.invalidateQueries({ queryKey: ['me'] }),
  ])
  const requestPlan = useMutation({
    mutationFn: api.subscription.requestPlan,
    onSuccess: async () => { await refresh(); notify(t('sub_request_sent')) },
  })
  const submitPayment = useMutation({
    mutationFn: () => api.subscription.submitPayment({
      payment_method: paymentMethod,
      transaction_reference: reference.trim(),
      paid_at: new Date(paidAt).toISOString(),
    }),
    onSuccess: async () => { setReference(''); await refresh(); notify(t('sub_payment_submitted')) },
  })

  const error = plans.error || current.error || history.error || payments.error || instructions.error
  const loading = plans.isLoading || current.isLoading || history.isLoading || payments.isLoading || instructions.isLoading
  const activePlans = (plans.data ?? []).filter((plan) => plan.currency === me?.business?.currency)
  const configuredMethods = instructions.data?.methods ?? []
  useEffect(() => {
    if (configuredMethods.length && !configuredMethods.some((method) => method.method === paymentMethod)) {
      setPaymentMethod(configuredMethods[0].method)
    }
  }, [configuredMethods, paymentMethod])
  const selectedPlan = plans.data?.find((plan) => plan.id === current.data?.plan_id)
  const latestSub = current.data
  const paymentError = requestPlan.error || submitPayment.error
  const status = latestSub?.effective_status ?? latestSub?.status ?? t('sub_none')
  const dateLabel = latestSub?.expires_at ? new Date(latestSub.expires_at).toLocaleDateString() : '—'

  return (
    <div className="max-w-5xl">
      <PageHeader title={t('sb_title')} />
      <QueryState loading={loading} error={error} />
      {!loading && !error && <>
        <Kpis items={[
          [t('sb_cur'), selectedPlan?.name ?? t('sub_no_plan')],
          [t('sb_stat'), status],
          [t('sb_renew'), dateLabel],
          [t('sub_price'), latestSub ? money(latestSub.renewal_price, latestSub.currency) : '—'],
        ]} />

        <Panel title={t('sub_available_plans')}>
          {!activePlans.length && <p className="text-mu">{t('sub_no_currency_plans', { currency: me?.business?.currency ?? '' })}</p>}
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activePlans.map((plan) => {
              const alreadySelected = plan.id === latestSub?.plan_id && ['active', 'trial', 'pending'].includes(latestSub?.status ?? '')
              const features = Object.entries(plan.features).filter(([key, value]) => !key.startsWith('max_') && value === true)
              const limits = Object.entries(plan.features).filter(([key]) => key.startsWith('max_'))
              return <article key={plan.id} className="border border-bd rounded-xl p-4 flex flex-col">
                <div className="flex items-start gap-2"><h3 className="font-semibold text-lg mr-auto">{plan.name}</h3><b>{money(plan.price, plan.currency)}</b></div>
                <p className="text-sm text-mu">{plan.duration_days} {t('sub_days')}{plan.trial_days ? ` · ${plan.trial_days} ${t('sub_trial_days')}` : ''}</p>
                {plan.description && <p className="text-sm mt-2">{plan.description}</p>}
                <ul className="my-3 text-sm space-y-1">{features.map(([key]) => <li key={key}>✓ {t(`f_${key}`) === `f_${key}` ? key.split('_').join(' ') : t(`f_${key}`)}</li>)}</ul>
                {!!limits.length && <p className="text-sm text-mu mb-3">{limits.map(([key, value]) => `${key.replace('max_', '')}: ${value}`).join(' · ')}</p>}
                <button className="btn mt-auto" disabled={!canManage || alreadySelected || requestPlan.isPending} onClick={() => requestPlan.mutate(plan.id)}>
                  {alreadySelected ? t(latestSub?.status === 'pending' ? 'sub_requested' : 'sub_current') : t('sub_choose_plan')}
                </button>
              </article>
            })}
          </div>
          {!canManage && <p className="text-sm text-mu mt-3">{t('sub_manager_only')}</p>}
          {paymentError && <p role="alert" className="text-er mt-3">{(paymentError as Error).message}</p>}
        </Panel>

        <Panel title={t('sub_payments')}>
          {instructions.data?.configured
            ? <div className="rounded-lg bg-bg border border-bd p-3 mb-4 space-y-3">
              {configuredMethods.map((method) => <div key={method.id}>
                <p className="font-semibold">{method.display_name} · {method.recipient_name}</p>
                <p>{method.recipient_details}</p>
                <p className="text-sm text-mu">{method.reference_instructions}</p>
              </div>)}
            </div>
            : <p className="rounded-lg bg-bg border border-bd p-3 mb-4 text-mu">{t('sub_payment_instructions_missing')}</p>}
          {latestSub && ['pending', 'active', 'trial'].includes(latestSub.status) && latestSub.renewal_price !== '0.00' && canManage && instructions.data?.configured && configuredMethods.length > 0 && <form className="grid md:grid-cols-2 gap-x-3 items-end mb-5" onSubmit={(event) => { event.preventDefault(); submitPayment.mutate() }}>
            <p className="text-sm text-mu md:col-span-2">{t('sub_price')}: {money(latestSub.renewal_price, latestSub.currency)}{selectedPlan ? ` · ${selectedPlan.duration_days} ${t('sub_days')}` : ''}</p>
            <Field label={t('sub_transaction_reference')} value={reference} onChange={(event) => setReference(event.target.value)} required minLength={3} maxLength={160} />
            <label className="block mb-4"><span className="block text-sm font-semibold mb-1">{t('sub_payment_method')}</span><select className="inp" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>{configuredMethods.map((method) => <option key={method.id} value={method.method}>{method.display_name}</option>)}</select></label>
            <Field label={t('sub_paid_at')} type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} required />
            <button className="btn mb-4" disabled={submitPayment.isPending || !reference.trim()}>{t('sub_submit_payment')}</button>
            <p className="text-sm text-mu md:col-span-2">{t('sub_manual_review')}</p>
            {submitPayment.error && <p role="alert" className="text-er md:col-span-2">{(submitPayment.error as Error).message}</p>}
          </form>}
          {payments.data?.length ? <Table head={[t('sub_paid_at'), t('sub_payment_method'), t('sub_transaction_reference'), t('sub_price'), t('sb_stat')]}>
            {payments.data.map((payment) => <tr key={payment.id}><td className="td">{new Date(payment.paid_at).toLocaleString()}</td><td className="td">{payment.payment_method}</td><td className="td">{payment.transaction_reference ?? '—'}</td><td className="td">{money(payment.amount, payment.currency)}</td><td className="td">{payment.status}</td></tr>)}
          </Table> : <p className="text-mu">{t('sub_no_payments')}</p>}
        </Panel>

        <Panel title={t('sub_history')}>
          {history.data?.length ? <Table head={[t('sub_plan'), t('sb_stat'), t('sub_price'), t('sub_started'), t('sb_renew')]}>
            {history.data.map((item) => <tr key={item.id}><td className="td">{plans.data?.find((plan) => plan.id === item.plan_id)?.name ?? t('sub_plan_unavailable')}</td><td className="td">{item.effective_status ?? item.status}</td><td className="td">{money(item.renewal_price, item.currency)}</td><td className="td">{new Date(item.started_at).toLocaleDateString()}</td><td className="td">{item.expires_at ? new Date(item.expires_at).toLocaleDateString() : '—'}</td></tr>)}
          </Table> : <p className="text-mu">{t('sub_no_history')}</p>}
        </Panel>
      </>}
    </div>
  )
}
