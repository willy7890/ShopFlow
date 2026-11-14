import { useCallback, useState } from 'react'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import {
  fetchBusinessAccess,
  fetchCurrentUser,
  fetchSubscriptionHistory,
  fetchSubscriptionPaymentInstructions,
  fetchSubscriptionPayments,
  fetchSubscriptionPlans,
  logoutOnline,
  requestSubscriptionPlan,
  submitSubscriptionPayment,
  type BusinessAccess,
  type CurrentSubscription,
  type PaymentInstructions,
  type SubscriptionPaymentRecord,
  type SubscriptionPlan,
} from '@/src/services/api'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

const money = (amount: string, currency: string) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount)) }
  catch { return `${currency} ${amount}` }
}

export default function SubscriptionScreen() {
  const { colors } = useTheme()
  const { t, language } = useI18n()
  const database = useSQLiteContext()
  const router = useRouter()
  const { businessId } = useLocalSearchParams<{ businessId?: string }>()
  const styles = createStyles(colors)
  const [businesses, setBusinesses] = useState<BusinessAccess[]>([])
  const [selectedBusinessId, setSelectedBusinessId] = useState(businessId ?? '')
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [history, setHistory] = useState<CurrentSubscription[]>([])
  const [current, setCurrent] = useState<CurrentSubscription | null>(null)
  const [instructions, setInstructions] = useState<PaymentInstructions | null>(null)
  const [payments, setPayments] = useState<SubscriptionPaymentRecord[]>([])
  const [selectedMethod, setSelectedMethod] = useState<PaymentInstructions['methods'][number]['method'] | ''>('')
  const [reference, setReference] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [access, availablePlans] = await Promise.all([
        fetchBusinessAccess(database),
        fetchSubscriptionPlans(database),
      ])
      setBusinesses(access)
      setPlans(availablePlans.filter((plan) => plan.is_active && plan.entitlement_schema_version >= 1))
      const initialBusinessId = selectedBusinessId || access[0]?.business_id || ''
      if (initialBusinessId && access.some((business) => business.business_id === initialBusinessId)) {
        setSelectedBusinessId(initialBusinessId)
        await loadBusiness(initialBusinessId, access)
      } else {
        setCurrent(null); setHistory([]); setInstructions(null); setPayments([])
      }
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setLoading(false)
    }
  }, [database, selectedBusinessId])

  const loadBusiness = async (id: string, access = businesses) => {
    const [subs, paymentInstructions, paymentRows] = await Promise.all([
      fetchSubscriptionHistory(database, id),
      fetchSubscriptionPaymentInstructions(database, id),
      fetchSubscriptionPayments(database, id),
    ])
    setHistory(subs)
    setCurrent(subs[0] ?? null)
    setInstructions(paymentInstructions)
    setPayments(paymentRows)
    setSelectedMethod((previous) => paymentInstructions.methods.some((method) => method.method === previous)
      ? previous
      : paymentInstructions.methods[0]?.method ?? '')
    if (access.length && !access.some((business) => business.business_id === id)) throw new Error(t('subscription.businessUnavailable'))
  }

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const chooseBusiness = async (business: BusinessAccess) => {
    setSelectedBusinessId(business.business_id)
    setSaving(true); setError(null); setNotice(null)
    try { await loadBusiness(business.business_id, businesses) }
    catch (reason) { setError((reason as Error).message) }
    finally { setSaving(false) }
  }

  const choosePlan = async (plan: SubscriptionPlan) => {
    if (!selectedBusinessId) return
    setSaving(true); setError(null); setNotice(null)
    try {
      const result = await requestSubscriptionPlan(database, selectedBusinessId, plan.id)
      setCurrent(result)
      await loadBusiness(selectedBusinessId)
      setNotice(result.status === 'pending' ? t('subscription.requestPending') : t('subscription.planActivated'))
    } catch (reason) { setError((reason as Error).message) }
    finally { setSaving(false) }
  }

  const sendPayment = async () => {
    if (!selectedBusinessId || !selectedMethod || reference.trim().length < 3) return
    setSaving(true); setError(null); setNotice(null)
    try {
      await submitSubscriptionPayment(database, selectedBusinessId, {
        payment_method: selectedMethod,
        transaction_reference: reference.trim(),
        paid_at: new Date().toISOString(),
      })
      setReference('')
      await loadBusiness(selectedBusinessId)
      setNotice(t('subscription.paymentPendingReview'))
    } catch (reason) { setError((reason as Error).message) }
    finally { setSaving(false) }
  }

  const selectedBusiness = businesses.find((business) => business.business_id === selectedBusinessId)
  const matchingPlans = plans.filter((plan) => plan.currency === selectedBusiness?.currency)
  const currentPlan = plans.find((plan) => plan.id === current?.plan_id)
  const latestPayment = payments[0]
  const usable = history.some((subscription) => ['active', 'trial'].includes(subscription.status)
    && (!subscription.expires_at || Date.parse(subscription.expires_at) > Date.now()))
  const canRequestPayment = Boolean(current && ['pending', 'active', 'trial'].includes(current.status) && current.renewal_price !== '0.00')

  if (loading) return <Screen><LoadingState label={t('subscription.loading')} /></Screen>

  return (
    <Screen>
      <PageTitle title={t('subscription.title')} subtitle={t('subscription.subtitle')} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}

      {businesses.length > 1 ? <Card>
        <Text style={styles.sectionTitle}>{t('subscription.chooseBusiness')}</Text>
        {businesses.map((business) => <Button key={business.business_id} label={`${business.business_name} · ${business.currency}`} secondary onPress={() => void chooseBusiness(business)} disabled={saving} />)}
      </Card> : null}

      {selectedBusiness ? <>
        <Card>
          <Text style={styles.sectionTitle}>{t('subscription.currentPlan')}</Text>
          <Text style={styles.body}>{currentPlan?.name ?? t('subscription.noPlan')}</Text>
          {current ? <Text style={styles.muted}>{t('subscription.status')}: {current.status} · {money(current.renewal_price, current.currency)} · {t('subscription.expires')}: {current.expires_at ? new Date(current.expires_at).toLocaleDateString(language) : '—'}</Text> : <Text style={styles.muted}>{t('subscription.noActivePlan')}</Text>}
          {latestPayment ? <Text style={styles.muted}>{t('subscription.paymentStatus')}: {latestPayment.status}</Text> : null}
          {usable ? <Button label={t('subscription.continue')} onPress={() => router.replace('/businesses')} disabled={saving} /> : null}
        </Card>

        <Text style={styles.sectionTitle}>{t('subscription.availablePlans')}</Text>
        {!matchingPlans.length ? <Card><Text style={styles.muted}>{t('subscription.noPlans', { currency: selectedBusiness.currency })}</Text></Card> : null}
        {matchingPlans.map((plan) => {
          const features = Object.entries(plan.features).filter(([key, value]) => !key.startsWith('max_') && value === true)
          const limits = Object.entries(plan.features).filter(([key]) => key.startsWith('max_'))
          const samePending = plan.id === current?.plan_id && current.status === 'pending'
          return <Card key={plan.id}>
            <View style={styles.row}><Text style={styles.planTitle}>{plan.name}</Text><Text style={styles.price}>{money(plan.price, plan.currency)}</Text></View>
            <Text style={styles.muted}>{t('subscription.everyDays', { days: plan.duration_days })}{plan.trial_days ? ` · ${t('subscription.trialDays', { days: plan.trial_days })}` : ''}</Text>
            {plan.description ? <Text style={styles.body}>{plan.description}</Text> : null}
            {features.map(([feature]) => <Text key={feature} style={styles.body}>✓ {feature.replace(/_/g, ' ')}</Text>)}
            {limits.map(([key, value]) => <Text key={key} style={styles.muted}>{key.replace('max_', '')}: {value}</Text>)}
            <Button label={samePending ? t('subscription.requestPending') : t('subscription.selectPlan')} onPress={() => void choosePlan(plan)} disabled={saving || samePending || (usable && plan.id === current?.plan_id)} />
          </Card>
        })}

        {canRequestPayment ? <Card>
          <Text style={styles.sectionTitle}>{t('subscription.payment')}</Text>
          <Text style={styles.body}>{currentPlan?.name ?? t('subscription.noPlan')} · {money(current?.renewal_price ?? '0', current?.currency ?? selectedBusiness.currency)}{currentPlan ? ` · ${t('subscription.everyDays', { days: currentPlan.duration_days })}` : ''}</Text>
          {!instructions?.configured ? <Text style={styles.error}>{t('subscription.paymentUnavailable')}</Text> : <>
            {instructions.methods.map((method) => <Pressable key={method.id} accessibilityRole="radio" accessibilityState={{ checked: selectedMethod === method.method }} style={[styles.method, selectedMethod === method.method && styles.methodSelected]} onPress={() => setSelectedMethod(method.method)}>
              <Text style={styles.planTitle}>{method.display_name}</Text>
              <Text style={styles.body}>{t('subscription.recipient')}: {method.recipient_name}</Text>
              <Text selectable style={styles.body}>{method.recipient_details}</Text>
              <Text style={styles.muted}>{method.reference_instructions}</Text>
              {method.evidence_supported ? <Text style={styles.muted}>{t('subscription.evidenceUploadUnavailable')}</Text> : null}
            </Pressable>)}
            {selectedMethod ? <>
              <Field label={t('subscription.transactionReference')} value={reference} onChangeText={setReference} autoCapitalize="characters" maxLength={160} />
              <Button label={t('subscription.submitPayment')} onPress={() => void sendPayment()} disabled={saving || reference.trim().length < 3} />
              <Text style={styles.muted}>{t('subscription.manualVerification')}</Text>
            </> : null}
          </>}
          {payments.map((payment) => <Text key={payment.id} style={styles.muted}>{money(payment.amount, payment.currency)} · {payment.payment_method} · {payment.transaction_reference ?? '—'} · {payment.status}</Text>)}
        </Card> : null}
      </> : !error ? <Card><Text style={styles.muted}>{t('subscription.noBusiness')}</Text></Card> : null}
      <Button label={t('subscription.signOut')} secondary onPress={() => { void logoutOnline(database).then(() => router.replace('/login')).catch((reason) => setError((reason as Error).message)) }} disabled={saving} />
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    error: { color: colors.danger, marginBottom: 12 }, notice: { color: colors.accentPressed, fontWeight: '600', marginBottom: 12 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 10 },
    planTitle: { color: colors.text, fontSize: 16, fontWeight: '700' }, price: { color: colors.text, fontSize: 17, fontWeight: '800' },
    body: { color: colors.text, marginTop: 5 }, muted: { color: colors.muted, marginTop: 5 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    method: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginVertical: 5 }, methodSelected: { borderColor: colors.accent, borderWidth: 2 },
  })
}
