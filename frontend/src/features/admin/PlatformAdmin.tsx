import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { AdminPlan, PlatformStore } from '@/api/types'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Field, Kpis, PageHeader, Panel, QueryState, SelectField, Table, useNotify } from '@/components/ui'

type Section = 'overview' | 'businesses' | 'users' | 'stores' | 'plans' | 'subscriptions' | 'payments' | 'revenue' | 'reports' | 'audit' | 'health' | 'settings'
const sectionGroups: { label: string; items: [Section, string][] }[] = [
  { label: 'sa_group_global', items: [['overview', 'sa_overview'], ['businesses', 'sa_businesses'], ['users', 'sa_users'], ['stores', 'sa_stores']] },
  { label: 'sa_group_subscriptions', items: [['plans', 'sa_subscription_plans'], ['subscriptions', 'sa_subscriptions'], ['payments', 'sa_payment_ledger'], ['revenue', 'sa_revenue_analytics']] },
  { label: 'sa_group_platform', items: [['reports', 'sa_global_reports'], ['audit', 'sa_audit'], ['health', 'sa_system_health'], ['settings', 'sa_settings']] },
]
const planFeatureOptions: [string, string][] = [
  ['dashboard', 'Dashboard'], ['product_management', 'Product management'], ['product_categories', 'Product categories'], ['orders', 'Orders'],
  ['inventory', 'Inventory'], ['stock_alerts', 'Stock alerts'], ['sales_pos', 'Sales and POS'],
  ['invoices', 'Invoices'], ['customers', 'Customers'], ['customer_debtors', 'Customer debtors'],
  ['supplier_management', 'Supplier management'], ['supplier_payments', 'Supplier payments'], ['cashbook', 'Cashbook'],
  ['financial_reports', 'Financial reports'], ['sales_reports', 'Sales reports'],
  ['profit_reports', 'Profit reports'], ['inventory_reports', 'Inventory reports'], ['csv_exports', 'CSV exports'],
  ['pdf_exports', 'PDF exports'], ['advanced_analytics', 'Advanced analytics'], ['multi_store', 'Multi-store management'],
  ['employee_management', 'Employee management'], ['advanced_permissions', 'Advanced permissions'], ['offline_sync', 'Offline sync'],
]
const planLimitOptions: [string, string][] = [
  ['max_users', 'users'], ['max_employees', 'employees'], ['max_stores', 'stores'], ['max_products', 'products'],
]
const legacyLimitAliases: Record<string, string> = { max_employees: 'employees', max_stores: 'stores', max_products: 'products' }
const planProposals = [
  { slug: 'basic-tzs-proposed', name: 'Basic', price: '10000', features: ['dashboard', 'product_management', 'product_categories', 'inventory', 'sales_pos', 'customers'], limits: { max_users: 3, max_employees: 2, max_stores: 1, max_products: 100 } },
  { slug: 'standard-tzs-proposed', name: 'Standard', price: '20000', features: ['dashboard', 'product_management', 'product_categories', 'orders', 'inventory', 'stock_alerts', 'sales_pos', 'invoices', 'customers', 'customer_debtors', 'supplier_management', 'supplier_payments', 'cashbook', 'financial_reports', 'sales_reports', 'profit_reports', 'inventory_reports', 'csv_exports', 'employee_management'], limits: { max_users: 10, max_employees: 8, max_stores: 3, max_products: 1000 } },
  { slug: 'premium-tzs-proposed', name: 'Premium', price: '35000', features: planFeatureOptions.map(([key]) => key), limits: { max_users: 50, max_employees: 50, max_stores: 10, max_products: 10000 } },
]
const today = () => new Date().toISOString().slice(0, 10)
const dateDaysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
const dateRange = (preset: string): [string, string] => {
  const now = new Date()
  if (preset === 'today') return [today(), today()]
  if (preset === 'yesterday') { const day = dateDaysAgo(1); return [day, day] }
  if (preset === '7days') return [dateDaysAgo(6), today()]
  if (preset === '30days') return [dateDaysAgo(29), today()]
  if (preset === 'thisMonth') return [new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), today()]
  if (preset === 'lastMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)]
  }
  return [dateDaysAgo(29), today()]
}
const money = (value: string | number | null | undefined, currency: string) => {
  if (value == null) return '—'
  try { return new Intl.NumberFormat('en-TZ', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value)) }
  catch { return `${currency} ${value}` }
}
const parseFeatureJson = (value: string): Record<string, boolean | number | string> => {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new Error('Features must be valid JSON.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Features must be a JSON object.')
  if (Object.values(parsed).some((v) => typeof v !== 'boolean' && typeof v !== 'number' && typeof v !== 'string')) {
    throw new Error('Feature values must be text, numbers, or true/false.')
  }
  return parsed as Record<string, boolean | number | string>
}

export default function PlatformAdmin() {
  const { t } = useT()
  const isSuperAdmin = useAuth((state) => state.me?.user.isSuperAdmin ?? false)
  const currentUserId = useAuth((state) => state.me?.user.id)
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [section, setSection] = useState<Section>('overview')
  const [reason, setReason] = useState('')
  const [businessSearch, setBusinessSearch] = useState('')
  const [businessOffset, setBusinessOffset] = useState(0)
  const [businessStatusFilter, setBusinessStatusFilter] = useState('')
  const [businessPlanFilter, setBusinessPlanFilter] = useState('')
  const [businessSubscriptionFilter, setBusinessSubscriptionFilter] = useState('')
  const [businessRegisteredFrom, setBusinessRegisteredFrom] = useState('')
  const [businessRegisteredTo, setBusinessRegisteredTo] = useState('')
  const [userOffset, setUserOffset] = useState(0)
  const [userSearch, setUserSearch] = useState('')
  const [userBusinessFilter, setUserBusinessFilter] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('')
  const [userActiveFilter, setUserActiveFilter] = useState('')
  const [userVerifiedFilter, setUserVerifiedFilter] = useState('')
  const [userRegisteredFrom, setUserRegisteredFrom] = useState('')
  const [userRegisteredTo, setUserRegisteredTo] = useState('')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  const [paymentSubscriptionId, setPaymentSubscriptionId] = useState('')
  const [paymentConfigCurrency, setPaymentConfigCurrency] = useState('TZS')
  const [paymentConfigMethod, setPaymentConfigMethod] = useState<'manual' | 'mobile_money' | 'bank' | 'cash'>('mobile_money')
  const [paymentConfigName, setPaymentConfigName] = useState('')
  const [paymentRecipientName, setPaymentRecipientName] = useState('')
  const [paymentRecipientDetails, setPaymentRecipientDetails] = useState('')
  const [paymentReferenceInstructions, setPaymentReferenceInstructions] = useState('')
  const [paymentConfigActive, setPaymentConfigActive] = useState(true)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('manual')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentDate, setPaymentDate] = useState(today())
  const [selectedBusinessId, setSelectedBusinessId] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [showPlanBusinesses, setShowPlanBusinesses] = useState(false)
  const [planEditor, setPlanEditor] = useState<AdminPlan | 'new' | null>(null)
  const [grantDuration, setGrantDuration] = useState('')
  const [editBusiness, setEditBusiness] = useState(false)
  const [storeName, setStoreName] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [preset, setPreset] = useState('30days')
  const [range, setRange] = useState<[string, string]>(() => dateRange('30days'))
  const [actionError, setActionError] = useState('')

  const analytics = useQuery({ queryKey: ['platform-admin', 'analytics'], queryFn: api.platformAdmin.analytics, enabled: isSuperAdmin })
  const businesses = useQuery({
    queryKey: ['platform-admin', 'businesses', businessSearch, businessOffset, businessStatusFilter, businessPlanFilter, businessSubscriptionFilter, businessRegisteredFrom, businessRegisteredTo],
    queryFn: () => api.platformAdmin.businesses({
      search: businessSearch || undefined, offset: businessOffset, limit: 50,
      isActive: businessStatusFilter === '' ? undefined : businessStatusFilter === 'true',
      planId: businessPlanFilter || undefined, subscriptionStatus: businessSubscriptionFilter || undefined,
      registeredFrom: businessRegisteredFrom || undefined, registeredTo: businessRegisteredTo || undefined,
    }),
    enabled: isSuperAdmin,
  })
  const users = useQuery({
    queryKey: ['platform-admin', 'users', userOffset, userSearch, userBusinessFilter, userRoleFilter, userActiveFilter, userVerifiedFilter, userRegisteredFrom, userRegisteredTo],
    queryFn: () => api.platformAdmin.users({
      offset: userOffset, limit: 50, search: userSearch || undefined, businessId: userBusinessFilter || undefined,
      role: userRoleFilter || undefined, isActive: userActiveFilter === '' ? undefined : userActiveFilter === 'true',
      isVerified: userVerifiedFilter === '' ? undefined : userVerifiedFilter === 'true',
      registeredFrom: userRegisteredFrom || undefined, registeredTo: userRegisteredTo || undefined,
    }),
    enabled: isSuperAdmin,
  })
  const plans = useQuery({ queryKey: ['platform-admin', 'plans'], queryFn: api.platformAdmin.plans, enabled: isSuperAdmin })
  const audit = useQuery({ queryKey: ['platform-admin', 'audit'], queryFn: () => api.platformAdmin.audit(), enabled: isSuperAdmin && section === 'audit' })
  const subscriptions = useQuery({ queryKey: ['platform-admin', 'subscriptions'], queryFn: () => api.platformAdmin.subscriptions(), enabled: isSuperAdmin && ['subscriptions', 'payments'].includes(section) })
  const userDetail = useQuery({ queryKey: ['platform-admin', 'user', selectedUserId], queryFn: () => api.platformAdmin.user(selectedUserId), enabled: isSuperAdmin && !!selectedUserId && section === 'users' })
  const payments = useQuery({ queryKey: ['platform-admin', 'payments', paymentStatusFilter], queryFn: () => api.platformAdmin.payments({ status: paymentStatusFilter || undefined, offset: 0, limit: 100 }), enabled: isSuperAdmin && section === 'payments' })
  const paymentSettings = useQuery({ queryKey: ['platform-admin', 'payment-settings'], queryFn: api.platformAdmin.paymentSettings, enabled: isSuperAdmin && section === 'payments' })
  const revenue = useQuery({ queryKey: ['platform-admin', 'revenue', range[0], range[1]], queryFn: () => api.platformAdmin.revenue(range[0], range[1]), enabled: isSuperAdmin && section === 'revenue' })
  const businessDetail = useQuery({ queryKey: ['platform-admin', 'business', selectedBusinessId], queryFn: () => api.platformAdmin.business(selectedBusinessId), enabled: isSuperAdmin && !!selectedBusinessId && section === 'businesses' })
  const businessAudit = useQuery({ queryKey: ['platform-admin', 'business-audit', selectedBusinessId], queryFn: () => api.platformAdmin.audit({ businessId: selectedBusinessId }), enabled: isSuperAdmin && !!selectedBusinessId && section === 'businesses' })
  const stores = useQuery({ queryKey: ['platform-admin', 'business-stores', selectedBusinessId], queryFn: () => api.platformAdmin.businessStores(selectedBusinessId), enabled: isSuperAdmin && !!selectedBusinessId && section === 'stores' })
  const planBusinesses = useQuery({ queryKey: ['platform-admin', 'plan-businesses', selectedPlanId], queryFn: () => api.platformAdmin.planBusinesses(selectedPlanId), enabled: isSuperAdmin && !!selectedPlanId && section === 'plans' })
  const globalReport = useQuery({
    queryKey: ['platform-admin', 'global-report', range[0], range[1]],
    queryFn: () => api.platformAdmin.globalReports(range[0], range[1]),
    enabled: isSuperAdmin && section === 'reports',
  })
  const businessReport = useQuery({
    queryKey: ['platform-admin', 'business-report', selectedBusinessId, range[0], range[1]],
    queryFn: () => api.platformAdmin.businessReport(selectedBusinessId, range[0], range[1]),
    enabled: isSuperAdmin && section === 'reports' && !!selectedBusinessId,
  })
  const health = useQuery({ queryKey: ['platform-admin', 'health'], queryFn: api.platformAdmin.health, enabled: isSuperAdmin && section === 'health' })

  useEffect(() => {
    if (businesses.data?.length && !businesses.data.some((item) => item.id === selectedBusinessId)) setSelectedBusinessId(businesses.data[0].id)
  }, [businesses.data, selectedBusinessId])
  useEffect(() => {
    if (plans.data?.length && !plans.data.some((item) => item.id === selectedPlanId)) setSelectedPlanId(plans.data[0].id)
  }, [plans.data, selectedPlanId])
  useEffect(() => {
    const setting = paymentSettings.data?.find((item) => item.currency === paymentConfigCurrency && item.method === paymentConfigMethod)
    setPaymentConfigName(setting?.display_name ?? '')
    setPaymentRecipientName(setting?.recipient_name ?? '')
    setPaymentRecipientDetails(setting?.recipient_details ?? '')
    setPaymentReferenceInstructions(setting?.reference_instructions ?? '')
    setPaymentConfigActive(setting?.is_active ?? true)
  }, [paymentSettings.data, paymentConfigCurrency, paymentConfigMethod])

  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['platform-admin'] }) }
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: async () => { await refresh(); setActionError(''); notify(t('sa_saved')) },
    onError: (error: Error) => setActionError(error.message),
  })
  const savePlan = useMutation({
    mutationFn: async (draft: PlanDraft) => {
      const input = {
        slug: draft.slug.trim().toLowerCase(), name: draft.name.trim(), description: draft.description.trim() || undefined,
        price: draft.price, currency: draft.currency, duration_days: Number(draft.durationDays),
        trial_days: Number(draft.trialDays), features: parseFeatureJson(draft.features), is_active: draft.isActive,
      }
      if (draft.id) await api.platformAdmin.updatePlan(draft.id, { ...input, description: input.description ?? '', is_active: draft.isActive })
      else await api.platformAdmin.createPlan(input)
    },
    onSuccess: async () => { await refresh(); setPlanEditor(null); setActionError(''); notify(t('sa_saved')) },
    onError: (error: Error) => setActionError(error.message),
  })
  const ensureInitialPlans = useMutation({
    mutationFn: () => api.platformAdmin.ensureInitialPlans(reason.trim()),
    onSuccess: async (result) => {
      await refresh()
      setActionError('')
      notify(result.created_slugs.length
        ? t('sa_starter_plans_created', { count: result.created_slugs.length })
        : t('sa_starter_plans_unchanged'))
    },
    onError: (error: Error) => setActionError(error.message),
  })

  if (!isSuperAdmin) return <p role="alert" className="text-er">{t('sa_forbidden')}</p>

  const selectedBusiness = businesses.data?.find((business) => business.id === selectedBusinessId)
  const reasonValid = reason.trim().length >= 5
  const queryError = analytics.error ?? businesses.error ?? users.error ?? plans.error
  const loading = analytics.isLoading || businesses.isLoading || users.isLoading || plans.isLoading
  const currencyTotals = analytics.data?.currency_totals ?? []
  const reportTotals = globalReport.data?.currency_totals ?? []
  const activePlan = plans.data?.filter((plan) => plan.is_active) ?? []

  return (
    <>
      <PageHeader title="ShopFlow System Administration" />
      <nav aria-label={t('sa_title')} className="grid xl:grid-cols-3 gap-3 mb-5">
        {sectionGroups.map((group) => <div key={group.label} className="rounded-xl border border-bd p-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-mu mb-2">{t(group.label)}</h2>
          <div className="flex flex-wrap gap-2">{group.items.map(([id, label]) => <button key={id} className={`btn ${section === id ? '' : 'btn-ghost'}`} aria-pressed={section === id} onClick={() => setSection(id)}>{t(label)}</button>)}</div>
        </div>)}
      </nav>
      {actionError && <p role="alert" className="text-er mb-3">{actionError}</p>}
      {loading && <QueryState loading error={queryError} />}
      {!loading && queryError && <p role="alert" className="text-er mb-4">{(queryError as Error).message}</p>}

      {section === 'overview' && (
        <>
          <Panel title="System overview">
            {analytics.data ? <Kpis items={[
              ['Businesses', String(analytics.data.business_count)], ['Active businesses', String(analytics.data.active_business_count)],
              ['Users', String(analytics.data.user_count)], ['Stores', String(analytics.data.store_count)],
              ['Employees', String(analytics.data.employee_count)], ['Products', String(analytics.data.product_count)],
              ['Transactions', String(analytics.data.transaction_count)], ['Active subscriptions', String(analytics.data.active_subscription_count)],
              ['Pending requests', String(analytics.data.pending_subscription_count)],
            ]} /> : <p className="text-mu">No overview data is available.</p>}
            {currencyTotals.length > 0 && <Table head={['Currency', 'Sales revenue', 'Expenses', 'Gross profit', 'Debts', 'Supplier liabilities']}>
              {currencyTotals.map((row) => <tr key={row.currency}><td className="td">{row.currency}</td><td className="td">{money(row.sales_revenue, row.currency)}</td><td className="td">{money(row.expenses, row.currency)}</td><td className="td">{money(row.gross_profit, row.currency)}</td><td className="td">{money(row.outstanding_debt, row.currency)}</td><td className="td">{money(row.supplier_liabilities, row.currency)}</td></tr>)}
            </Table>}
            <p className="text-sm text-mu mt-3">Recorded subscription payment totals are available under Revenue analytics.</p>
          </Panel>
          <Panel title="Business growth">
            {analytics.data?.business_growth.length ? <Table head={['Month', 'New businesses']}>
              {analytics.data.business_growth.slice(-12).map((point) => <tr key={point.month}><td className="td">{point.month}</td><td className="td">{point.businesses}</td></tr>)}
            </Table> : <p className="text-mu">No business registrations have been recorded.</p>}
          </Panel>
          <QueryState loading={false} error={queryError} />
        </>
      )}

      {section === 'businesses' && (
        <>
          <Panel title="Registered businesses">
            <div className="grid sm:grid-cols-3 xl:grid-cols-6 gap-2 items-end mb-3">
              <Field label="Search name, owner, email or ID" value={businessSearch} onChange={(event) => { setBusinessSearch(event.target.value); setBusinessOffset(0) }} />
              <SelectField label="Business status" value={businessStatusFilter} onChange={(event) => { setBusinessStatusFilter(event.target.value); setBusinessOffset(0) }}><option value="">All businesses</option><option value="true">Active</option><option value="false">Suspended</option></SelectField>
              <SelectField label="Plan" value={businessPlanFilter} onChange={(event) => { setBusinessPlanFilter(event.target.value); setBusinessOffset(0) }}><option value="">All plans</option>{(plans.data ?? []).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.currency}</option>)}</SelectField>
              <SelectField label="Subscription status" value={businessSubscriptionFilter} onChange={(event) => { setBusinessSubscriptionFilter(event.target.value); setBusinessOffset(0) }}><option value="">All subscriptions</option><option value="active">Active</option><option value="trial">Trial</option><option value="pending">Pending</option><option value="expired">Expired</option><option value="suspended">Suspended</option><option value="none">No subscription</option></SelectField>
              <Field label="Registered from" type="date" value={businessRegisteredFrom} onChange={(event) => { setBusinessRegisteredFrom(event.target.value); setBusinessOffset(0) }} />
              <Field label="Registered to" type="date" value={businessRegisteredTo} onChange={(event) => { setBusinessRegisteredTo(event.target.value); setBusinessOffset(0) }} />
              <button className="btn btn-ghost mb-4" onClick={() => setBusinessOffset(Math.max(0, businessOffset - 50))} disabled={!businessOffset}>Previous</button>
              <button className="btn btn-ghost mb-4" onClick={() => setBusinessOffset(businessOffset + 50)} disabled={(businesses.data?.length ?? 0) < 50}>Next</button>
            </div>
            {businesses.isLoading ? <QueryState loading /> : businesses.error ? <p role="alert" className="text-er">{businesses.error.message}</p> : businesses.data?.length ? <Table head={['Business', 'Registered', 'Status', 'Subscription', 'Actions']}>
              {businesses.data.map((business) => <tr key={business.id}>
                <td className="td"><button className="lnk font-semibold" onClick={() => { setSelectedBusinessId(business.id); setEditBusiness(false) }}>{business.name}</button><small className="block text-mu">{business.business_type} · {business.currency}</small></td>
                <td className="td">{business.created_at ? new Date(business.created_at).toLocaleDateString() : '—'}</td>
                <td className="td">{business.is_active ? 'Active' : 'Suspended'}</td>
                <td className="td">{business.subscription ? `${business.subscription.effective_status ?? business.subscription.status} · ${business.subscription.expires_at?.slice(0, 10) ?? 'No expiry'}` : 'No subscription'}</td>
                <td className="td whitespace-nowrap"><button className="lnk mr-2" onClick={() => { setSelectedBusinessId(business.id); setSection('reports') }}>Reports</button><button className="lnk" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.setBusinessStatus(business.id, !business.is_active, reason.trim()))}>{business.is_active ? 'Suspend' : 'Activate'}</button></td>
              </tr>)}
            </Table> : <p className="text-mu">No businesses match this search.</p>}
          </Panel>
          {selectedBusinessId && <Panel title="Business details">
            {businessDetail.isLoading ? <QueryState loading /> : businessDetail.error ? <p role="alert" className="text-er">{businessDetail.error.message}</p> : businessDetail.data && <>
              <Kpis items={[
                ['Users', String(businessDetail.data.user_count)], ['Stores', String(businessDetail.data.store_count)], ['Employees', String(businessDetail.data.employee_count)],
                ['Products', String(businessDetail.data.product_count)], ['Sales', String(businessDetail.data.sales_count)],
              ]} />
              <dl className="grid sm:grid-cols-2 gap-2 mb-4"><Detail label="Business ID" value={businessDetail.data.id} /><Detail label="Owner" value={businessDetail.data.owner_name ?? 'No owner assigned'} /><Detail label="Owner email" value={businessDetail.data.owner_email ?? '—'} /><Detail label="Registered" value={new Date(businessDetail.data.created_at).toLocaleDateString()} /><Detail label="Current subscription" value={businessDetail.data.subscription?.effective_status ?? businessDetail.data.subscription?.status ?? 'None'} /><Detail label="Subscription started" value={businessDetail.data.subscription?.started_at?.slice(0, 10) ?? '—'} /><Detail label="Subscription expires" value={businessDetail.data.subscription?.expires_at?.slice(0, 10) ?? 'No expiry'} /></dl>
              <button className="btn btn-ghost mb-3" onClick={() => setEditBusiness((value) => !value)}>{editBusiness ? 'Close business editor' : 'Edit business information'}</button>
              {editBusiness && <BusinessEditor business={businessDetail.data} reason={reason} disabled={!reasonValid || mutation.isPending} onSave={(input) => mutation.mutate(() => api.platformAdmin.updateBusiness(businessDetail.data!.id, input))} />}
              <AssignPlan businessId={businessDetail.data.id} plans={activePlan} planId={selectedPlanId} onPlan={setSelectedPlanId} duration={grantDuration} onDuration={setGrantDuration} reason={reason} disabled={!reasonValid || mutation.isPending} onAssign={() => mutation.mutate(() => api.platformAdmin.grantPlan(businessDetail.data!.id, selectedPlanId, grantDuration ? Number(grantDuration) : undefined, reason.trim()))} onGrantTrial={() => mutation.mutate(() => api.platformAdmin.grantPlan(businessDetail.data!.id, selectedPlanId, grantDuration ? Number(grantDuration) : undefined, reason.trim(), 'trial'))} />
              <h4 className="font-semibold mt-4 mb-2">Business audit history</h4>
              {businessAudit.isLoading ? <QueryState loading /> : businessAudit.error ? <p role="alert" className="text-er">{businessAudit.error.message}</p> : businessAudit.data?.length ? <Table head={['Date', 'Action', 'Actor', 'Details']}>{businessAudit.data.map((entry) => <tr key={entry.id}><td className="td">{new Date(entry.created_at).toLocaleString()}</td><td className="td">{entry.event_type}</td><td className="td">{entry.user_id ?? 'System'}</td><td className="td">{JSON.stringify(entry.details)}</td></tr>)}</Table> : <p className="text-mu">No platform audit history is recorded for this business.</p>}
            </>}
          </Panel>}
          <ReasonField value={reason} onChange={setReason} />
        </>
      )}

      {section === 'users' && (
        <>
        <Panel title="Global user directory">
          <div className="grid sm:grid-cols-3 gap-2 items-end mb-3">
            <Field label="Search name, email or phone" value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserOffset(0) }} />
            <SelectField label="Business" value={userBusinessFilter} onChange={(event) => { setUserBusinessFilter(event.target.value); setUserOffset(0) }}>
              <option value="">All businesses</option>{(businesses.data ?? []).map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </SelectField>
            <SelectField label="Role" value={userRoleFilter} onChange={(event) => { setUserRoleFilter(event.target.value); setUserOffset(0) }}>
              <option value="">All roles</option><option value="owner">Owner</option><option value="business_manager">Business manager</option><option value="store_manager">Store manager</option><option value="cashier">Cashier</option><option value="accountant">Accountant</option><option value="inventory_manager">Inventory manager</option><option value="SUPER_ADMIN">Super Admin</option>
            </SelectField>
            <SelectField label="Account status" value={userActiveFilter} onChange={(event) => { setUserActiveFilter(event.target.value); setUserOffset(0) }}><option value="">Any status</option><option value="true">Active</option><option value="false">Suspended</option></SelectField>
            <SelectField label="Email verification" value={userVerifiedFilter} onChange={(event) => { setUserVerifiedFilter(event.target.value); setUserOffset(0) }}><option value="">Any verification</option><option value="true">Verified</option><option value="false">Unverified</option></SelectField>
            <div className="grid grid-cols-2 gap-2"><Field label="Registered from" type="date" value={userRegisteredFrom} onChange={(event) => { setUserRegisteredFrom(event.target.value); setUserOffset(0) }} /><Field label="Registered to" type="date" value={userRegisteredTo} onChange={(event) => { setUserRegisteredTo(event.target.value); setUserOffset(0) }} /></div>
          </div>
          <div className="flex justify-end gap-2 mb-3"><button className="btn btn-ghost" onClick={() => setUserOffset(Math.max(0, userOffset - 50))} disabled={!userOffset}>Previous</button><button className="btn btn-ghost" onClick={() => setUserOffset(userOffset + 50)} disabled={(users.data?.length ?? 0) < 50}>Next</button></div>
          {users.isLoading ? <QueryState loading /> : users.error ? <p role="alert" className="text-er">{users.error.message}</p> : users.data?.length ? <Table head={['User', 'Email / phone', 'Verification', 'Account', 'Business / role', 'Last login', t('sa_account_access')]}>
            {users.data.map((user) => <tr key={user.id}>
              <td className="td"><button className="lnk font-semibold" onClick={() => setSelectedUserId(user.id)}>{user.full_name}</button>{user.is_super_admin && <small className="block text-mu">SUPER_ADMIN</small>}</td>
              <td className="td">{user.email}<small className="block text-mu">{user.phone ?? 'No phone'}</small></td>
              <td className="td">{user.is_email_verified ? 'Verified' : 'Unverified'}</td>
              <td className="td">{user.is_active ? 'Active' : 'Suspended'}</td>
              <td className="td">{user.businesses.map((item) => <span className="block" key={item.business_id}>{item.business_name} · {item.role}</span>)}</td>
              <td className="td">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}</td>
              <td className="td whitespace-nowrap"><button className="lnk" onClick={() => setSelectedUserId(user.id)}>{t('sa_manage_account')}</button></td>
            </tr>)}
          </Table> : <p className="text-mu">No users match these filters.</p>}
        </Panel>
        {selectedUserId && <Panel title="User profile and activity">
          {userDetail.isLoading ? <QueryState loading /> : userDetail.error ? <p role="alert" className="text-er">{userDetail.error.message}</p> : userDetail.data && <>
            <dl className="grid sm:grid-cols-3 gap-3 mb-4"><Detail label="Full name" value={userDetail.data.full_name} /><Detail label="Email" value={userDetail.data.email} /><Detail label="Phone" value={userDetail.data.phone ?? '—'} /><Detail label="Email verification" value={userDetail.data.is_email_verified ? 'Verified' : 'Unverified'} /><Detail label="Account" value={userDetail.data.is_active ? 'Active' : 'Suspended'} /><Detail label="Registered" value={new Date(userDetail.data.created_at).toLocaleString()} /><Detail label="Last login" value={userDetail.data.last_login_at ? new Date(userDetail.data.last_login_at).toLocaleString() : 'Never'} /></dl>
            <section aria-label={t('sa_user_access_title')} className="rounded-xl border border-bd p-4 mb-4"><h3 className="font-semibold">{t('sa_user_access_title')}</h3><p className="text-sm text-mu mt-1 mb-3">{t('sa_user_access_description')}</p><button className={userDetail.data.is_active ? 'btn text-er' : 'btn'} disabled={!reasonValid || mutation.isPending || userDetail.data.id === currentUserId || userDetail.data.is_super_admin} onClick={() => mutation.mutate(() => api.platformAdmin.setUserStatus(userDetail.data!.id, !userDetail.data!.is_active, reason.trim()))}>{userDetail.data.is_active ? t('sa_suspend_user') : t('sa_reactivate_user')}</button>{userDetail.data.is_super_admin && <p className="text-sm text-mu mt-2">{t('sa_owner_protected')}</p>}<div className="mt-3"><ReasonField value={reason} onChange={setReason} /></div></section>
            <h4 className="font-semibold mb-2">Associated businesses and subscriptions</h4>
            {userDetail.data.businesses.length ? <Table head={['Business', 'Business status', 'Role', 'Membership', 'Plan', 'Subscription']}>
              {userDetail.data.businesses.map((item) => <tr key={item.business_id}><td className="td">{item.business_name}</td><td className="td">{item.business_is_active ? 'Active' : 'Suspended'}</td><td className="td">{item.role}</td><td className="td">{item.membership_is_active ? 'Active' : 'Inactive'}</td><td className="td">{item.plan_name ?? '—'}</td><td className="td">{item.subscription_status ?? 'None'}{item.subscription_expires_at ? ` · ${new Date(item.subscription_expires_at).toLocaleDateString()}` : ''}</td></tr>)}
            </Table> : <p className="text-mu">This user has no business memberships.</p>}
            <h4 className="font-semibold mt-4 mb-2">Recent administrative audit history</h4>
            {userDetail.data.audit_history.length ? <Table head={['Date', 'Event', 'Business', 'Details']}>
              {userDetail.data.audit_history.map((entry) => <tr key={entry.id}><td className="td">{new Date(entry.created_at).toLocaleString()}</td><td className="td">{entry.event_type}</td><td className="td">{entry.business_id ?? 'Platform'}</td><td className="td">{JSON.stringify(entry.details)}</td></tr>)}
            </Table> : <p className="text-mu">No administrative audit history for this user.</p>}
          </>}
        </Panel>}
        </>
      )}

      {section === 'stores' && (
        <Panel title="Business stores">
          <SelectField label="Business" value={selectedBusinessId} onChange={(event) => setSelectedBusinessId(event.target.value)}>
            {(businesses.data ?? []).map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
          </SelectField>
          {selectedBusiness && <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end mb-3">
            <Field label="Store name" value={storeName} onChange={(event) => setStoreName(event.target.value)} />
            <Field label="Store code" value={storeCode} onChange={(event) => setStoreCode(event.target.value)} />
            <button className="btn mb-4" disabled={!storeName.trim() || !storeCode.trim() || mutation.isPending} onClick={() => mutation.mutate(async () => { await api.platformAdmin.createStore(selectedBusiness.id, { name: storeName.trim(), code: storeCode.trim() }); setStoreName(''); setStoreCode('') })}>Add store</button>
          </div>}
          {stores.isLoading ? <QueryState loading /> : stores.error ? <p role="alert" className="text-er">{stores.error.message}</p> : stores.data?.length ? <Table head={['Store', 'Code', 'Address', 'Status', 'Actions']}>
            {stores.data.map((store) => <tr key={store.id}><td className="td">{store.name}</td><td className="td">{store.code}</td><td className="td">{store.address ?? '—'}</td><td className="td">{store.is_active ? 'Active' : 'Inactive'}</td><td className="td"><button className="lnk" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.setStoreStatus(store.id, !store.is_active, reason.trim()))}>{store.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>)}
          </Table> : <p className="text-mu">No stores are registered for this business.</p>}
          <ReasonField value={reason} onChange={setReason} />
        </Panel>
      )}

      {section === 'plans' && (
        <>
          <Panel title={t('sa_subscription_plans')}>
            <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => setPlanEditor('new')}>{t('sa_create_plan')}</button><button className="btn btn-ghost" disabled={!reasonValid || ensureInitialPlans.isPending} onClick={() => ensureInitialPlans.mutate()}>{ensureInitialPlans.isPending ? t('wait') : t('sa_create_missing_tzs_plans')}</button></div>
            <p className="text-sm text-mu mt-2">{t('sa_create_missing_tzs_description')}</p>
            <ReasonField value={reason} onChange={setReason} />
            {plans.isLoading ? <QueryState loading /> : plans.error ? <p role="alert" className="text-er">{plans.error.message}</p> : plans.data?.length ? <Table head={['Plan', 'Price', 'Duration', 'Trial', 'Status', 'Actions']}>
              {plans.data.map((plan) => <tr key={plan.id}><td className="td"><b>{plan.name}</b><small className="block text-mu">{plan.slug}{plan.description ? ` · ${plan.description}` : ''}</small></td><td className="td">{money(plan.price, plan.currency)}</td><td className="td">{plan.duration_days} days</td><td className="td">{plan.trial_days ? `${plan.trial_days} days` : 'None'}</td><td className="td">{plan.archived_at ? 'Archived' : plan.entitlement_schema_version < 1 ? 'Needs entitlement review' : plan.is_active ? 'Active' : 'Inactive'}</td><td className="td whitespace-nowrap"><button className="lnk mr-2" disabled={!!plan.archived_at} onClick={() => setPlanEditor(plan)}>Edit</button><button className="lnk mr-2" onClick={() => { setSelectedPlanId(plan.id); setShowPlanBusinesses(true) }}>Affected businesses</button>{!plan.archived_at && <><button className="lnk mr-2" disabled={mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updatePlan(plan.id, { name: plan.name, description: plan.description ?? '', price: plan.price, currency: plan.currency, duration_days: plan.duration_days, trial_days: plan.trial_days, features: plan.features, is_active: !plan.is_active }))}>{plan.is_active ? 'Deactivate' : 'Activate'}</button><button className="lnk text-er" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.archivePlan(plan.id, reason.trim()))}>Archive</button></>}</td></tr>)}
            </Table> : <p className="text-mu">No plans exist. Create the first plan to make it available to businesses.</p>}
          </Panel>
          {planEditor && <PlanEditor key={typeof planEditor === 'string' ? 'new' : planEditor.id} initial={planEditor} pending={savePlan.isPending} onCancel={() => setPlanEditor(null)} onSave={(draft) => savePlan.mutate(draft)} />}
          {showPlanBusinesses && selectedPlanId && <Panel title={`Businesses on ${plans.data?.find((plan) => plan.id === selectedPlanId)?.name ?? 'selected plan'}`}>
            {planBusinesses.isLoading ? <QueryState loading /> : planBusinesses.error ? <p role="alert" className="text-er">{planBusinesses.error.message}</p> : planBusinesses.data?.length ? <Table head={['Business', 'Status', 'Subscription', 'Expires']}>
              {planBusinesses.data.map((business) => <tr key={business.id}><td className="td">{business.name}</td><td className="td">{business.is_active ? 'Active' : 'Suspended'}</td><td className="td">{business.subscription?.status ?? '—'}</td><td className="td">{business.subscription?.expires_at?.slice(0, 10) ?? '—'}</td></tr>)}
            </Table> : <p className="text-mu">No businesses currently use this plan.</p>}
          </Panel>}
        </>
      )}

      {section === 'subscriptions' && (
        <>
          <Panel title="Subscription history and requests">
            {subscriptions.isLoading ? <QueryState loading /> : subscriptions.error ? <p role="alert" className="text-er">{subscriptions.error.message}</p> : subscriptions.data?.length ? <Table head={['Business', 'Plan', 'Status', 'Entitlements', 'Price', 'Started', 'Expires', 'Actions']}>
              {subscriptions.data.map((sub) => <tr key={sub.id}><td className="td">{sub.business_name}</td><td className="td">{plans.data?.find((plan) => plan.id === sub.plan_id)?.name ?? 'Plan removed'}</td><td className="td">{sub.effective_status ?? sub.status}</td><td className="td">{sub.entitlement_mode === 'legacy' ? 'Legacy access · review' : 'Enforced'}</td><td className="td">{money(sub.renewal_price, sub.currency)}</td><td className="td">{sub.started_at.slice(0, 10)}</td><td className="td">{sub.expires_at?.slice(0, 10) ?? 'No expiry'}</td><td className="td whitespace-nowrap"><button className="lnk mr-2" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updateSubscription(sub.id, { extend_days: 30, reason: reason.trim() }))}>Extend 30d</button>{sub.entitlement_mode === 'legacy' && <button className="lnk mr-2" disabled={!reasonValid || mutation.isPending || (plans.data?.find((plan) => plan.id === sub.plan_id)?.entitlement_schema_version ?? 0) < 1} onClick={() => mutation.mutate(() => api.platformAdmin.updateSubscription(sub.id, { entitlement_mode: 'enforced', reason: reason.trim() }))}>Apply reviewed entitlements</button>}{sub.status === 'pending' && sub.renewal_price === '0.00' && <button className="lnk mr-2" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updateSubscription(sub.id, { status: 'active', reason: reason.trim() }))}>Activate free plan</button>}{sub.status === 'pending' && sub.renewal_price !== '0.00' && <button className="lnk mr-2" onClick={() => { setPaymentSubscriptionId(sub.id); setSection('payments') }}>Record payment</button>}<button className="lnk" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updateSubscription(sub.id, { status: sub.status === 'suspended' ? 'active' : 'suspended', reason: reason.trim() }))}>{sub.status === 'suspended' ? 'Reactivate' : 'Suspend'}</button></td></tr>)}
            </Table> : <p className="text-mu">No subscription requests or history are recorded.</p>}
          </Panel>
          <ReasonField value={reason} onChange={setReason} />
        </>
      )}

      {section === 'payments' && (
        <>
          <Panel title="Customer payment instructions">
            <p className="text-sm text-mu mb-3">Enter verified official recipient details. Customers will see these details; no payment number or account is prefilled.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Field label="Currency" maxLength={3} value={paymentConfigCurrency} onChange={(event) => setPaymentConfigCurrency(event.target.value.toUpperCase())} />
              <SelectField label="Method" value={paymentConfigMethod} onChange={(event) => setPaymentConfigMethod(event.target.value as typeof paymentConfigMethod)}><option value="mobile_money">Mobile money</option><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="manual">Other manual</option></SelectField>
              <Field label="Payment method label" value={paymentConfigName} onChange={(event) => setPaymentConfigName(event.target.value)} />
              <Field label="Official recipient name" value={paymentRecipientName} onChange={(event) => setPaymentRecipientName(event.target.value)} />
              <Field label="Official number or account details" value={paymentRecipientDetails} onChange={(event) => setPaymentRecipientDetails(event.target.value)} />
              <Field label="Reference instructions" value={paymentReferenceInstructions} onChange={(event) => setPaymentReferenceInstructions(event.target.value)} />
            </div>
            <label className="flex items-center gap-2 mb-3"><input type="checkbox" checked={paymentConfigActive} onChange={(event) => setPaymentConfigActive(event.target.checked)} /> Available to customers</label>
            <button className="btn" disabled={!reasonValid || paymentSettings.isLoading || mutation.isPending || paymentConfigCurrency.length !== 3 || !paymentConfigName.trim() || !paymentRecipientName.trim() || !paymentRecipientDetails.trim() || !paymentReferenceInstructions.trim()} onClick={() => mutation.mutate(() => api.platformAdmin.updatePaymentSetting(paymentConfigCurrency, paymentConfigMethod, { display_name: paymentConfigName.trim(), recipient_name: paymentRecipientName.trim(), recipient_details: paymentRecipientDetails.trim(), reference_instructions: paymentReferenceInstructions.trim(), is_active: paymentConfigActive, reason: reason.trim() }))}>Save payment instructions</button>
            <ReasonField value={reason} onChange={setReason} />
          </Panel>
          <Panel title="Record a subscription payment for confirmation">
            <div className="grid sm:grid-cols-3 gap-x-3 items-end">
              <SelectField label="Business subscription" value={paymentSubscriptionId} onChange={(event) => {
                const id = event.target.value
                setPaymentSubscriptionId(id)
                const selected = subscriptions.data?.find((sub) => sub.id === id)
                if (selected) setPaymentAmount(selected.renewal_price)
              }}>
                <option value="">Select subscription</option>{(subscriptions.data ?? []).map((sub) => <option key={sub.id} value={sub.id}>{sub.business_name} · {money(sub.renewal_price, sub.currency)} · {sub.status}</option>)}
              </SelectField>
              <Field label="Paid amount" type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              <SelectField label="Payment method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="manual">Manual / cash</option><option value="mobile_money">Mobile money</option><option value="bank">Bank transfer</option></SelectField>
              <Field label="Transaction reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} />
              <Field label="Payment date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              <button className="btn mb-4" disabled={!paymentSubscriptionId || !paymentAmount || Number(paymentAmount) <= 0 || !reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.recordPayment({
                subscription_id: paymentSubscriptionId, amount: paymentAmount, payment_method: paymentMethod,
                transaction_reference: paymentReference.trim() || undefined, paid_at: new Date(`${paymentDate}T12:00:00`).toISOString(),
                confirmation_details: reason.trim(),
              }))}>Record pending payment</button>
            </div>
            <p className="text-sm text-mu">Recording a payment does not activate a paid subscription. Confirm the pending payment after checking its reference.</p>
          </Panel>
          <Panel title="Subscription payment ledger">
            <SelectField label="Payment status" value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}><option value="">All statuses</option><option value="pending">Pending confirmation</option><option value="confirmed">Confirmed</option><option value="failed">Failed</option><option value="refunded">Refunded</option></SelectField>
            {payments.isLoading ? <QueryState loading /> : payments.error ? <p role="alert" className="text-er">{payments.error.message}</p> : payments.data?.length ? <Table head={['Business', 'Plan', 'Amount', 'Method / reference', 'Paid date', 'Status', 'Actions']}>
              {payments.data.map((payment) => <tr key={payment.id}><td className="td">{payment.business_name}</td><td className="td">{payment.plan_name ?? 'Plan removed'}</td><td className="td">{money(payment.amount, payment.currency)}</td><td className="td">{payment.payment_method}<small className="block text-mu">{payment.transaction_reference ?? 'No reference'}</small></td><td className="td">{new Date(payment.paid_at).toLocaleDateString()}</td><td className="td">{payment.status}</td><td className="td whitespace-nowrap">{payment.status === 'pending' && <><button className="lnk mr-2" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updatePayment(payment.id, { status: 'confirmed', details: reason.trim() }))}>Confirm</button><button className="lnk text-er" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.updatePayment(payment.id, { status: 'failed', details: reason.trim() }))}>Mark failed</button></>}{payment.status === 'confirmed' && <button className="lnk text-er" disabled={!reasonValid || mutation.isPending} onClick={() => mutation.mutate(() => api.platformAdmin.refundPayment(payment.id, { details: reason.trim(), refund_amount: payment.amount }))}>Refund full</button>}</td></tr>)}
            </Table> : <p className="text-mu">No subscription payment records match this filter.</p>}
            <ReasonField value={reason} onChange={setReason} />
          </Panel>
        </>
      )}

      {section === 'revenue' && (
        <>
          <Panel title="Revenue date range">
            <div className="grid sm:grid-cols-2 gap-3"><Field label="Start date" type="date" value={range[0]} onChange={(event) => setRange([event.target.value, range[1]])} /><Field label="End date" type="date" value={range[1]} onChange={(event) => setRange([range[0], event.target.value])} /></div>
          </Panel>
          <Panel title="Collected subscription revenue">
            {revenue.isLoading ? <QueryState loading /> : revenue.error ? <p role="alert" className="text-er">{revenue.error.message}</p> : revenue.data && <>
              <Kpis items={[
                ['Active paying businesses', String(revenue.data.active_paying_business_count)],
                ['Payments pending', String(revenue.data.pending_count)],
                ['Failed payments', String(revenue.data.failed_count)],
                ['Expired subscriptions', String(revenue.data.expired_subscription_count)],
              ]} />
              <h4 className="font-semibold mt-4 mb-2">Monthly confirmed payments and refunds</h4>
              {revenue.data.monthly.length ? <Table head={['Month', 'Currency', 'Confirmed', 'Refunded', 'Net']}>{revenue.data.monthly.map((row) => <tr key={`${row.period}-${row.currency}`}><td className="td">{row.period}</td><td className="td">{row.currency}</td><td className="td">{money(row.confirmed_amount, row.currency)}</td><td className="td">{money(row.refunded_amount, row.currency)}</td><td className="td">{money(Number(row.confirmed_amount) - Number(row.refunded_amount), row.currency)}</td></tr>)}</Table> : <p className="text-mu">No confirmed subscription payments in this range.</p>}
              <h4 className="font-semibold mt-4 mb-2">Revenue by plan and currency</h4>
              {revenue.data.by_plan.length ? <Table head={['Plan', 'Currency', 'Confirmed amount']}>{revenue.data.by_plan.map((row) => <tr key={`${row.plan_id}-${row.currency}`}><td className="td">{row.plan_name}</td><td className="td">{row.currency}</td><td className="td">{money(row.confirmed_amount, row.currency)}</td></tr>)}</Table> : <p className="text-mu">No plan revenue is recorded for this range.</p>}
              <h4 className="font-semibold mt-4 mb-2">Pending amounts</h4>
              {revenue.data.pending_amount_by_currency.length ? <Table head={['Currency', 'Pending amount']}>{revenue.data.pending_amount_by_currency.map((row) => <tr key={row.currency}><td className="td">{row.currency}</td><td className="td">{money(row.sales_revenue, row.currency)}</td></tr>)}</Table> : <p className="text-mu">No payments are awaiting confirmation.</p>}
            </>}
          </Panel>
        </>
      )}

      {section === 'reports' && (
        <>
          <Panel title="Report date range">
            <div className="grid sm:grid-cols-3 gap-3 items-end"><SelectField label="Preset" value={preset} onChange={(event) => { setPreset(event.target.value); setRange(dateRange(event.target.value)) }}>
              <option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option><option value="thisMonth">This month</option><option value="lastMonth">Last month</option><option value="custom">Custom range</option>
            </SelectField><Field label="Start date" type="date" value={range[0]} onChange={(event) => { setPreset('custom'); setRange([event.target.value, range[1]]) }} /><Field label="End date" type="date" value={range[1]} onChange={(event) => { setPreset('custom'); setRange([range[0], event.target.value]) }} /></div>
          </Panel>
          <Panel title="Platform-wide totals">
            {globalReport.isLoading ? <QueryState loading /> : globalReport.error ? <p role="alert" className="text-er">{globalReport.error.message}</p> : globalReport.data && <>
              <Kpis items={[
                ['Businesses', String(globalReport.data.business_count)], ['Active', String(globalReport.data.active_business_count)],
                ['Suspended', String(globalReport.data.suspended_business_count)], ['Users', String(globalReport.data.user_count)],
                ['Stores', String(globalReport.data.store_count)], ['Products', String(globalReport.data.product_count)],
                ['Transactions', String(globalReport.data.transaction_count)],
              ]} />
              {reportTotals.length ? <Table head={['Currency', 'Net sales', 'Expenses', 'Gross profit', 'Customer debts', 'Supplier liabilities', 'Transactions']}>
                {reportTotals.map((row) => <tr key={row.currency}><td className="td">{row.currency}</td><td className="td">{money(row.sales_revenue, row.currency)}</td><td className="td">{money(row.expenses, row.currency)}</td><td className="td">{money(row.gross_profit, row.currency)}</td><td className="td">{money(row.outstanding_debt, row.currency)}</td><td className="td">{money(row.supplier_liabilities, row.currency)}</td><td className="td">{row.transaction_count}</td></tr>)}
              </Table> : <p className="text-mu">No transactions have been recorded in this date range.</p>}
            </>}
          </Panel>
          <Panel title="Business report">
            <SelectField label="Business" value={selectedBusinessId} onChange={(event) => setSelectedBusinessId(event.target.value)}>
              {(businesses.data ?? []).map((business) => <option key={business.id} value={business.id}>{business.name} · {business.currency}</option>)}
            </SelectField>
            {businessReport.isLoading ? <QueryState loading /> : businessReport.error ? <p role="alert" className="text-er">{businessReport.error.message}</p> : businessReport.data && selectedBusiness && <>
              <div className="flex flex-wrap gap-2 mb-3"><button className="btn btn-ghost" onClick={() => void api.platformAdmin.exportBusinessReport(selectedBusinessId, range[0], range[1], 'csv').catch((error: Error) => setActionError(error.message))}>Export CSV</button><button className="btn btn-ghost" onClick={() => void api.platformAdmin.exportBusinessReport(selectedBusinessId, range[0], range[1], 'pdf').catch((error: Error) => setActionError(error.message))}>Export PDF</button></div>
              <Kpis items={[
                ['Net sales', money(businessReport.data.sales.net_sales, selectedBusiness.currency)],
                ['Transactions', String(businessReport.data.sales.total_transactions)],
                ['Gross profit', money(businessReport.data.profit.gross_profit, selectedBusiness.currency)],
                ['Expenses', money(businessReport.data.expenses, selectedBusiness.currency)],
                ['Customer debts', money(businessReport.data.debtors.total_outstanding, selectedBusiness.currency)],
                ['Supplier liabilities', money(businessReport.data.suppliers.total_payables, selectedBusiness.currency)],
                ['Inventory value', money(businessReport.data.inventory.total_stock_value, selectedBusiness.currency)],
              ]} />
              <h4 className="font-semibold mt-3 mb-2">Store performance</h4>
              {businessReport.data.store_performance.length ? <Table head={['Store', 'Sales', 'Expenses', 'Net cash', 'Transactions']}>
                {businessReport.data.store_performance.map((store) => <tr key={store.store_id}><td className="td">{store.store_name}</td><td className="td">{money(store.sales_total, selectedBusiness.currency)}</td><td className="td">{money(store.expense_total, selectedBusiness.currency)}</td><td className="td">{money(store.net_cash, selectedBusiness.currency)}</td><td className="td">{store.transaction_count}</td></tr>)}
              </Table> : <p className="text-mu">No store activity in this date range.</p>}
              <h4 className="font-semibold mt-3 mb-2">Stock alerts and product performance</h4>
              <Table head={['Product', 'Low stock', 'Best selling', 'Slow moving']}>
                {Array.from({ length: Math.max(businessReport.data.inventory.low_stock_items.length, businessReport.data.inventory.best_selling_products.length, businessReport.data.inventory.slow_moving_products.length) }, (_, i) => <tr key={i}><td className="td">{businessReport.data.inventory.low_stock_items[i]?.product_name ?? businessReport.data.inventory.best_selling_products[i]?.product_name ?? businessReport.data.inventory.slow_moving_products[i]?.product_name ?? '—'}</td><td className="td">{businessReport.data.inventory.low_stock_items[i]?.quantity ?? '—'}</td><td className="td">{businessReport.data.inventory.best_selling_products[i]?.quantity_sold ?? '—'}</td><td className="td">{businessReport.data.inventory.slow_moving_products[i]?.quantity_sold ?? '—'}</td></tr>)}
              </Table>
              <h4 className="font-semibold mt-3 mb-2">Expense categories</h4>
              {businessReport.data.expense_categories.length ? <Table head={['Category', 'Amount']}>
                {businessReport.data.expense_categories.map((entry) => <tr key={entry.category}><td className="td">{entry.category}</td><td className="td">{money(entry.amount, selectedBusiness.currency)}</td></tr>)}
              </Table> : <p className="text-mu">No expenses in this date range.</p>}
              <h4 className="font-semibold mt-3 mb-2">Customer balances</h4>
              {businessReport.data.debtors.customers.length ? <Table head={['Customer', 'Outstanding']}>
                {businessReport.data.debtors.customers.map((customer) => <tr key={customer.customer_id ?? customer.name}><td className="td">{customer.name}</td><td className="td">{money(customer.outstanding_balance, selectedBusiness.currency)}</td></tr>)}
              </Table> : <p className="text-mu">No customer balance records.</p>}
              <h4 className="font-semibold mt-3 mb-2">Supplier balances</h4>
              {businessReport.data.suppliers.suppliers.length ? <Table head={['Supplier', 'Payable']}>
                {businessReport.data.suppliers.suppliers.map((supplier) => <tr key={supplier.supplier_id ?? supplier.name}><td className="td">{supplier.name}</td><td className="td">{money(supplier.payable_balance, selectedBusiness.currency)}</td></tr>)}
              </Table> : <p className="text-mu">No supplier balance records.</p>}
              <h4 className="font-semibold mt-3 mb-2">Stock movement history</h4>
              {businessReport.data.stock_movements.length ? <Table head={['Date', 'Store', 'Movement', 'Quantity', 'Unit cost', 'Note']}>
                {businessReport.data.stock_movements.slice(0, 100).map((movement) => <tr key={movement.id}><td className="td whitespace-nowrap">{new Date(movement.created_at).toLocaleString()}</td><td className="td">{movement.store_name ?? movement.store_id}</td><td className="td">{movement.movement_type}</td><td className="td">{movement.quantity_delta}</td><td className="td">{money(movement.unit_cost, selectedBusiness.currency)}</td><td className="td">{movement.note ?? '—'}</td></tr>)}
              </Table> : <p className="text-mu">No stock movements in this date range.</p>}
              <h4 className="font-semibold mt-3 mb-2">Supplier payment history</h4>
              {businessReport.data.supplier_payments.length ? <Table head={['Date', 'Supplier', 'Amount', 'Method', 'Reference', 'Status']}>
                {businessReport.data.supplier_payments.slice(0, 100).map((payment) => <tr key={payment.id}><td className="td whitespace-nowrap">{new Date(payment.created_at).toLocaleString()}</td><td className="td">{payment.supplier_name}</td><td className="td">{money(payment.amount, selectedBusiness.currency)}</td><td className="td">{payment.method}</td><td className="td">{payment.reference ?? '—'}</td><td className="td">{payment.status}</td></tr>)}
              </Table> : <p className="text-mu">No supplier payments in this date range.</p>}
              <h4 className="font-semibold mt-3 mb-2">Cashbook entries</h4>
              <Kpis items={[
                ['Cashbook in', money(businessReport.data.cashbook_balance.total_in, selectedBusiness.currency)],
                ['Cashbook out', money(businessReport.data.cashbook_balance.total_out, selectedBusiness.currency)],
                ['Net cashbook balance', money(businessReport.data.cashbook_balance.net_balance, selectedBusiness.currency)],
              ]} />
              {businessReport.data.cashbook.length ? <Table head={['Date', 'Type', 'Category', 'Direction', 'Amount', 'Note']}>
                {businessReport.data.cashbook.slice(0, 100).map((entry) => <tr key={entry.id}><td className="td whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td><td className="td">{entry.entry_type}</td><td className="td">{entry.category}</td><td className="td">{entry.direction}</td><td className="td">{money(entry.amount, selectedBusiness.currency)}</td><td className="td">{entry.note ?? '—'}</td></tr>)}
              </Table> : <p className="text-mu">No cashbook entries in this date range.</p>}
              <h4 className="font-semibold mt-3 mb-2">Transaction history (latest 100)</h4>
              {businessReport.data.transactions.length ? <Table head={['Date', 'Sale', 'Customer', 'Status', 'Total', 'Paid', 'Due']}>
                {businessReport.data.transactions.map((sale) => <tr key={sale.id}><td className="td whitespace-nowrap">{new Date(sale.created_at).toLocaleString()}</td><td className="td">{sale.sale_number}</td><td className="td">{sale.customer_name ?? 'Walk-in'}</td><td className="td">{sale.status}</td><td className="td">{money(sale.total_amount, selectedBusiness.currency)}</td><td className="td">{money(sale.paid_amount, selectedBusiness.currency)}</td><td className="td">{money(sale.balance_due, selectedBusiness.currency)}</td></tr>)}
              </Table> : <p className="text-mu">No transactions in this date range.</p>}
            </>}
          </Panel>
        </>
      )}

      {section === 'audit' && <Panel title="Platform audit log">
        {audit.isLoading ? <QueryState loading /> : audit.error ? <p role="alert" className="text-er">{audit.error.message}</p> : audit.data?.length ? <Table head={['Date', 'Event', 'Business', 'Actor', 'Details']}>
          {audit.data.map((entry) => <tr key={entry.id}><td className="td whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td><td className="td">{entry.event_type}</td><td className="td">{businesses.data?.find((item) => item.id === entry.business_id)?.name ?? entry.business_id ?? 'Platform'}</td><td className="td">{users.data?.find((user) => user.id === entry.user_id)?.email ?? entry.user_id ?? 'System'}</td><td className="td max-w-[360px] break-words">{JSON.stringify(entry.details)}</td></tr>)}
        </Table> : <p className="text-mu">No platform audit events are recorded.</p>}
      </Panel>}

      {section === 'health' && <Panel title="System health">
        {health.isLoading ? <QueryState loading /> : health.error ? <p role="alert" className="text-er">{health.error.message}</p> : <Kpis items={[["API", health.data?.status ?? 'Unknown'], ['Database', (health.data as { database?: string } | undefined)?.database ?? 'Unknown'], ['Service', health.data?.service ?? 'Unknown']]} />}
      </Panel>}
      {section === 'settings' && <Panel title="Platform settings">
        {plans.isLoading ? <QueryState loading /> : plans.error ? <p role="alert" className="text-er">{plans.error.message}</p> : <>
          <p className="text-mu mb-3">Plan pricing and currencies are managed per plan. Existing business and subscription currencies remain unchanged; financial reports keep totals grouped by currency.</p>
          <Table head={['Currency', 'Plans', 'Active plans']}>
            {[...new Set((plans.data ?? []).map((plan) => plan.currency))].sort().map((currency) => {
              const currencyPlans = (plans.data ?? []).filter((plan) => plan.currency === currency)
              return <tr key={currency}><td className="td">{currency}</td><td className="td">{currencyPlans.length}</td><td className="td">{currencyPlans.filter((plan) => plan.is_active && !plan.archived_at).length}</td></tr>
            })}
          </Table>
          {!plans.data?.length && <p className="text-mu py-3">No plans are configured.</p>}
          <button className="btn btn-ghost mt-3" onClick={() => setSection('plans')}>Manage subscription plans</button>
        </>}
      </Panel>}
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-mu">{label}</dt><dd className="font-semibold">{value}</dd></div>
}

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Panel title="Administrative reason"><Field label="Reason (minimum 5 characters)" value={value} onChange={(event) => onChange(event.target.value)} /></Panel>
}

function BusinessEditor({ business, reason, disabled, onSave }: {
  business: { id: string; name: string; business_type: string; currency: string }
  reason: string
  disabled: boolean
  onSave: (input: { name: string; business_type: string; currency: string; reason: string }) => void
}) {
  const [name, setName] = useState(business.name)
  const [type, setType] = useState(business.business_type)
  const [currency, setCurrency] = useState(business.currency)
  return <div className="grid sm:grid-cols-2 gap-x-3 border border-bd rounded-xl p-4 mb-4">
    <Field label="Business name" value={name} onChange={(event) => setName(event.target.value)} />
    <Field label="Business type" value={type} onChange={(event) => setType(event.target.value)} />
    <SelectField label="Business currency" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="TZS">TZS</option><option value="KES">KES</option><option value="USD">USD</option></SelectField>
    <button className="btn mb-4 self-end" disabled={disabled || !name.trim() || !type.trim()} onClick={() => onSave({ name: name.trim(), business_type: type.trim(), currency, reason: reason.trim() })}>Save business</button>
  </div>
}

function AssignPlan({ businessId, plans, planId, onPlan, duration, onDuration, reason, disabled, onAssign, onGrantTrial }: {
  businessId: string; plans: AdminPlan[]; planId: string; onPlan: (id: string) => void; duration: string
  onDuration: (value: string) => void; reason: string; disabled: boolean; onAssign: () => void; onGrantTrial: () => void
}) {
  return <div className="border-t border-bd pt-3 mt-3">
    <h4 className="font-semibold mb-2">Assign or change subscription</h4>
    <div className="grid sm:grid-cols-3 gap-x-3 items-end">
      <SelectField label="Plan" value={planId} onChange={(event) => onPlan(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {money(plan.price, plan.currency)}</option>)}</SelectField>
      <SelectField label="Custom duration (optional)" value={duration} onChange={(event) => onDuration(event.target.value)}><option value="">Plan duration</option>{[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}</SelectField>
      <div className="flex gap-2 mb-4"><button className="btn" disabled={disabled || !reason.trim() || !planId} onClick={onAssign}>Grant complimentary access</button>{plans.find((plan) => plan.id === planId)?.trial_days ? <button className="btn btn-ghost" disabled={disabled || !reason.trim() || !planId} onClick={onGrantTrial}>Grant trial</button> : null}</div>
    </div>
    <small className="text-mu">Assignments and free grants are recorded in the platform audit log.</small>
  </div>
}

type PlanDraft = { id?: string; slug: string; name: string; description: string; price: string; currency: string; durationDays: string; trialDays: string; features: string; isActive: boolean }
function PlanEditor({ initial, pending, onCancel, onSave }: { initial: AdminPlan | 'new'; pending: boolean; onCancel: () => void; onSave: (draft: PlanDraft) => void }) {
  const [draft, setDraft] = useState<PlanDraft>(() => initial === 'new' ? {
    slug: '', name: '', description: '', price: '0', currency: 'TZS', durationDays: '30', trialDays: '0', features: JSON.stringify({ max_users: 1, max_employees: 1, max_stores: 1, max_products: 100, ...Object.fromEntries(planFeatureOptions.map(([key]) => [key, false])) }, null, 2), isActive: true,
  } : {
    id: initial.id, slug: initial.slug, name: initial.name, description: initial.description ?? '', price: initial.price,
    currency: initial.currency, durationDays: String(initial.duration_days), trialDays: String(initial.trial_days),
    features: JSON.stringify(initial.features, null, 2), isActive: initial.is_active,
  })
  const [error, setError] = useState('')
  const applyProposal = (proposal: typeof planProposals[number]) => {
    const features: Record<string, boolean | number> = {
      ...Object.fromEntries(planFeatureOptions.map(([key]) => [key, proposal.features.includes(key)])),
      ...proposal.limits,
    }
    setDraft((current) => ({ ...current, slug: proposal.slug, name: proposal.name, price: proposal.price, currency: 'TZS', durationDays: '30', trialDays: '0', features: JSON.stringify(features, null, 2), isActive: true }))
    setError('Editable proposal loaded. Nothing is saved until you select Save plan.')
  }
  const set = (key: keyof PlanDraft, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const readFeatures = () => parseFeatureJson(draft.features)
  const toggleFeature = (key: string, enabled: boolean) => {
    try {
      const features = readFeatures()
      features[key] = enabled
      set('features', JSON.stringify(features, null, 2))
      setError('')
    } catch (reason) { setError((reason as Error).message) }
  }
  const setLimit = (key: string, value: string) => {
    try {
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Limits must be zero or a positive whole number.')
      const features = readFeatures()
      features[key] = parsed
      set('features', JSON.stringify(features, null, 2))
      setError('')
    } catch (reason) { setError((reason as Error).message) }
  }
  const displayFeatures = (() => { try { return parseFeatureJson(draft.features) } catch { return {} } })()
  const canonicalKeys = new Set([...planFeatureOptions.map(([key]) => key), ...planLimitOptions.map(([key]) => key), ...Object.values(legacyLimitAliases)])
  const missingFeatures = planFeatureOptions.filter(([key]) => !Object.prototype.hasOwnProperty.call(displayFeatures, key))
  const missingLimits = planLimitOptions.filter(([key]) => !Object.prototype.hasOwnProperty.call(displayFeatures, key) && !Object.prototype.hasOwnProperty.call(displayFeatures, legacyLimitAliases[key]))
  const unmappedFeatures = Object.entries(displayFeatures).filter(([key]) => !canonicalKeys.has(key))
  const submit = () => {
    try { parseFeatureJson(draft.features); setError(''); onSave(draft) }
    catch (reason) { setError((reason as Error).message) }
  }
  return <Panel title={initial === 'new' ? 'Create subscription plan' : `Edit ${initial.name}`}>
    {initial === 'new' && <div className="mb-3 rounded border border-bd p-3"><p className="text-sm text-mu mb-2">Load an editable TZS proposal. These buttons do not create or alter any stored plan.</p><div className="flex flex-wrap gap-2">{planProposals.map((proposal) => <button key={proposal.slug} type="button" className="btn btn-ghost" onClick={() => applyProposal(proposal)}>{proposal.name} · TZS {Number(proposal.price).toLocaleString()}/month</button>)}</div></div>}
    <div className="grid sm:grid-cols-2 gap-x-3">
      <Field label="Plan slug" value={draft.slug} disabled={!!draft.id} onChange={(event) => set('slug', event.target.value)} />
      <Field label="Plan name" value={draft.name} onChange={(event) => set('name', event.target.value)} />
      <label className="block mb-4 sm:col-span-2"><span className="block text-sm font-semibold mb-1">Description</span><textarea className="inp min-h-20" maxLength={500} value={draft.description} onChange={(event) => set('description', event.target.value)} /></label>
      <Field label="Price" type="number" min="0" step="0.01" value={draft.price} onChange={(event) => set('price', event.target.value)} />
      <SelectField label="Currency" value={draft.currency} onChange={(event) => set('currency', event.target.value)}><option value="TZS">TZS — Tanzanian Shilling</option><option value="KES">KES — Kenyan Shilling</option><option value="USD">USD — US Dollar</option></SelectField>
      <SelectField label="Billing duration" value={['7', '30', '90', '180', '365'].includes(draft.durationDays) ? draft.durationDays : 'custom'} onChange={(event) => set('durationDays', event.target.value === 'custom' ? '366' : event.target.value)}>
        {[7, 30, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}<option value="custom">Custom</option>
      </SelectField>
      {!['7', '30', '90', '180', '365'].includes(draft.durationDays) && <Field label="Custom duration (days)" type="number" min="1" max="3660" value={draft.durationDays} onChange={(event) => set('durationDays', event.target.value)} />}
      <Field label="Free trial (days)" type="number" min="0" max="366" value={draft.trialDays} onChange={(event) => set('trialDays', event.target.value)} />
      <label className="flex items-center gap-2 mb-4"><input type="checkbox" checked={draft.isActive} onChange={(event) => set('isActive', event.target.checked)} />Plan is active</label>
      <div className="sm:col-span-2 mb-4">
        <h4 className="font-semibold mb-2">Feature entitlements</h4>
        <div className="grid sm:grid-cols-3 gap-2">{planFeatureOptions.map(([key, label]) => <label className="flex gap-2 items-center" key={key}><input type="checkbox" checked={displayFeatures[key] === true} onChange={(event) => toggleFeature(key, event.target.checked)} />{label}</label>)}</div>
        <div className="grid sm:grid-cols-4 gap-x-3 mt-3">{[['max_users', 'Maximum users'], ['max_employees', 'Maximum employees'], ['max_stores', 'Maximum stores'], ['max_products', 'Maximum products']].map(([key, label]) => <Field key={key} label={label} type="number" min="0" step="1" value={String(displayFeatures[key] ?? 0)} onChange={(event) => setLimit(key, event.target.value)} />)}</div>
        <aside aria-label="Plan access preview" className="rounded border p-3 mt-3"><h5 className="font-semibold">Permission preview</h5><p className="text-sm text-mu">Enabled features: {planFeatureOptions.filter(([key]) => displayFeatures[key] === true || displayFeatures[key] === 1 || String(displayFeatures[key]).toLowerCase() === 'true').map(([, label]) => label).join(', ') || 'None'}</p><p className="text-sm text-mu">Limits: users {displayFeatures.max_users ?? 'not set'}, employees {displayFeatures.max_employees ?? displayFeatures.employees ?? 'not set'}, stores {displayFeatures.max_stores ?? displayFeatures.stores ?? 'not set'}, products {displayFeatures.max_products ?? displayFeatures.products ?? 'not set'}.</p>{missingFeatures.length > 0 && <p className="text-sm text-er">Features not explicitly configured (treated as excluded): {missingFeatures.map(([, label]) => label).join(', ')}.</p>}{missingLimits.length > 0 && <p className="text-sm text-er">Usage limits not configured (new resource creation will be denied): {missingLimits.map(([, label]) => label).join(', ')}.</p>}{unmappedFeatures.length > 0 && <p className="text-sm text-er">Unmapped legacy or custom values (do not grant a listed feature automatically): {unmappedFeatures.map(([key, value]) => `${key}=${String(value)}`).join(', ')}.</p>}<p className="text-sm text-mu">Saving this plan marks its entitlements as explicitly reviewed. Existing subscriptions remain in legacy access mode until a Super Admin applies the reviewed entitlements to each subscription.</p></aside>
        <label className="block mt-2"><span className="block text-sm font-semibold mb-1">Advanced entitlement data (JSON)</span><textarea className="inp min-h-28 font-mono text-sm" value={draft.features} onChange={(event) => set('features', event.target.value)} /><small className="text-mu">Features are enforced by backend route checks. A zero limit disables creating that resource.</small></label>
      </div>
    </div>
    {error && <p role="alert" className="text-er mb-3">{error}</p>}
    <button className="btn mr-2" disabled={pending || !draft.slug.trim() || !draft.name.trim() || !draft.price || !draft.durationDays} onClick={submit}>{pending ? 'Saving…' : 'Save plan'}</button><button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
  </Panel>
}
