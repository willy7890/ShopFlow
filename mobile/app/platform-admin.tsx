import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, LanguageSelector, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { isPlatformAdmin } from '@/src/domain/platformAdmin'
import { formatNumber } from '@/src/i18n/format'
import { fetchCurrentUser, logoutOnline } from '@/src/services/api'
import {
  fetchPlatformAdminData,
  type PlatformAdminData,
  type PlatformBusiness,
} from '@/src/services/platformAdmin'
import { restoreLocalWorkspace } from '@/src/repositories/workspace'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

type Section = 'overview' | 'businesses' | 'users' | 'subscriptions' | 'audit'

const sections: Section[] = ['overview', 'businesses', 'users', 'subscriptions', 'audit']

export default function PlatformAdminScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const router = useRouter()
  const [data, setData] = useState<PlatformAdminData | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [section, setSection] = useState<Section>('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const currentUser = await fetchCurrentUser(database)
      if (!isPlatformAdmin(currentUser)) {
        setAuthorized(false)
        setData(null)
        return
      }
      setAuthorized(true)
      setData(await fetchPlatformAdminData(database))
    } catch (reason) {
      setData(null)
      if (reason instanceof Error && 'status' in reason && reason.status === 403) {
        setAuthorized(false)
      }
      setError(localizeError(reason, 'platformAdmin.loadError'))
    } finally {
      setLoading(false)
    }
  }, [database, localizeError])

  useFocusEffect(useCallback(() => {
    void load()
  }, [load]))

  const signOut = async () => {
    setSigningOut(true)
    setError(null)
    try {
      await logoutOnline(database)
      await restoreLocalWorkspace(database)
      router.replace('/login')
    } catch (reason) {
      setError(localizeError(reason, 'businesses.signOutError'))
    } finally {
      setSigningOut(false)
    }
  }

  if (loading) {
    return <Screen><LoadingState label={t('platformAdmin.loading')} /></Screen>
  }

  return (
    <Screen>
      <LanguageSelector />
      <PageTitle title={t('platformAdmin.title')} subtitle={t('platformAdmin.subtitle')} />
      {authorized === false ? (
        <Card>
          <Text style={styles.error}>{t('platformAdmin.forbidden')}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={t('platformAdmin.openBusinesses')} secondary onPress={() => router.replace('/businesses')} />
          <Button label={t('businesses.signOut')} onPress={() => void signOut()} disabled={signingOut} />
        </Card>
      ) : error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Text style={styles.muted}>{t('platformAdmin.onlineOnly')}</Text>
          <Button label={t('platformAdmin.retry')} onPress={() => void load()} />
        </Card>
      ) : data ? (
        <>
          <View style={styles.navigation}>
            {sections.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: section === item }}
                onPress={() => setSection(item)}
                style={[styles.navItem, section === item && styles.navSelected]}
              >
                <Text style={[styles.navText, section === item && styles.navSelectedText]}>
                  {t(`platformAdmin.section.${item}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          {section === 'overview' ? <Overview data={data} /> : null}
          {section === 'businesses' ? <Businesses businesses={data.businesses} /> : null}
          {section === 'users' ? <Users users={data.users} /> : null}
          {section === 'subscriptions' ? <Subscriptions data={data} /> : null}
          {section === 'audit' ? <Audit audit={data.audit} language={language} /> : null}
          <Button
            label={t('platformAdmin.openBusinesses')}
            secondary
            onPress={() => router.push('/businesses')}
          />
          <Button
            label={signingOut ? t('platformAdmin.signingOut') : t('businesses.signOut')}
            onPress={() => void signOut()}
            disabled={signingOut}
          />
        </>
      ) : null}
      {error && authorized !== false ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

function Overview({ data }: { data: PlatformAdminData }) {
  const { colors } = useTheme()
  const { language, t } = useI18n()
  const styles = createStyles(colors)
  const analytics = data.analytics
  const metrics = [
    ['businesses', analytics.business_count],
    ['activeBusinesses', analytics.active_business_count],
    ['users', analytics.user_count],
    ['activeSubscriptions', analytics.active_subscription_count],
    ['pendingSubscriptions', analytics.pending_subscription_count],
  ] as const
  return (
    <>
      <PageTitle title={t('platformAdmin.analytics')} />
      <View style={styles.metrics}>
        {metrics.map(([key, value]) => (
          <Card key={key} style={styles.metricCard}>
            <Text style={styles.metricValue}>{formatNumber(value, language)}</Text>
            <Text style={styles.muted}>{t(`platformAdmin.metric.${key}`)}</Text>
          </Card>
        ))}
      </View>
      <Card>
        <Text style={styles.cardTitle}>{t('platformAdmin.revenue')}</Text>
        <Text style={styles.metricValue}>
          {analytics.confirmed_subscription_revenue === null
            ? t('platformAdmin.notReported')
            : `${analytics.currency ?? ''} ${analytics.confirmed_subscription_revenue}`}
        </Text>
        <Text style={styles.muted}>{t('platformAdmin.revenueNote')}</Text>
      </Card>
      <Card>
        <Text style={styles.cardTitle}>{t('platformAdmin.recentActivity')}</Text>
        {data.audit.slice(0, 5).map((event) => (
          <Text key={event.id} style={styles.listText}>
            {event.event_type} · {formatDate(event.created_at, language)}
          </Text>
        ))}
        {data.audit.length === 0 ? <Text style={styles.muted}>{t('platformAdmin.empty')}</Text> : null}
      </Card>
    </>
  )
}

function Businesses({ businesses }: { businesses: PlatformBusiness[] }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  return (
    <>
      <PageTitle title={t('platformAdmin.businesses')} subtitle={t('platformAdmin.businessCount', { count: businesses.length })} />
      {businesses.map((business) => (
        <Card key={business.id}>
          <Text style={styles.cardTitle}>{business.name}</Text>
          <Text style={styles.muted}>{business.business_type} · {business.currency}</Text>
          <Text style={business.is_active ? styles.statusActive : styles.statusInactive}>
            {t(business.is_active ? 'platformAdmin.active' : 'platformAdmin.inactive')}
          </Text>
          <SubscriptionDetails business={business} />
        </Card>
      ))}
      {businesses.length === 0 ? <Card><Text style={styles.muted}>{t('platformAdmin.empty')}</Text></Card> : null}
    </>
  )
}

function Users({ users }: { users: PlatformAdminData['users'] }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  return (
    <>
      <PageTitle title={t('platformAdmin.users')} subtitle={t('platformAdmin.userCount', { count: users.length })} />
      {users.map((user) => (
        <Card key={user.id}>
          <Text style={styles.cardTitle}>{user.full_name}</Text>
          <Text style={styles.muted}>{user.email}</Text>
          <Text style={user.is_active ? styles.statusActive : styles.statusInactive}>
            {t(user.is_active ? 'platformAdmin.active' : 'platformAdmin.inactive')}
          </Text>
          {user.is_super_admin ? <Text style={styles.adminBadge}>{t('platformAdmin.superAdmin')}</Text> : null}
        </Card>
      ))}
      {users.length === 0 ? <Card><Text style={styles.muted}>{t('platformAdmin.empty')}</Text></Card> : null}
    </>
  )
}

function Subscriptions({ data }: { data: PlatformAdminData }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  return (
    <>
      <PageTitle title={t('platformAdmin.subscriptions')} />
      <Card>
        <Text style={styles.cardTitle}>{t('platformAdmin.plans')}</Text>
        {data.plans.map((plan) => (
          <View key={plan.id} style={styles.listItem}>
            <Text style={styles.listText}>{plan.name} · {plan.currency} {plan.price}</Text>
            <Text style={styles.muted}>
              {t('platformAdmin.planDuration', { days: plan.duration_days })} · {t(plan.is_active ? 'platformAdmin.active' : 'platformAdmin.inactive')}
            </Text>
          </View>
        ))}
        {data.plans.length === 0 ? <Text style={styles.muted}>{t('platformAdmin.empty')}</Text> : null}
      </Card>
      {data.businesses.map((business) => (
        <Card key={business.id}>
          <Text style={styles.cardTitle}>{business.name}</Text>
          <SubscriptionDetails business={business} />
        </Card>
      ))}
    </>
  )
}

function SubscriptionDetails({ business }: { business: PlatformBusiness }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  const subscription = business.subscription
  return (
    <Text style={styles.muted}>
      {subscription
        ? `${t('platformAdmin.subscriptionStatus')}: ${subscription.status}${subscription.expires_at ? ` · ${t('platformAdmin.expires')}: ${subscription.expires_at.slice(0, 10)}` : ''}`
        : t('platformAdmin.noSubscription')}
    </Text>
  )
}

function Audit({ audit, language }: { audit: PlatformAdminData['audit']; language: 'en' | 'sw' }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  return (
    <>
      <PageTitle title={t('platformAdmin.audit')} subtitle={t('platformAdmin.auditCount', { count: audit.length })} />
      {audit.map((event) => (
        <Card key={event.id}>
          <Text style={styles.cardTitle}>{event.event_type}</Text>
          <Text style={styles.muted}>{formatDate(event.created_at, language)}</Text>
          {event.business_id ? <Text style={styles.muted}>{t('platformAdmin.businessReference')}: {event.business_id}</Text> : null}
          {Object.keys(event.details).length > 0
            ? <Text style={styles.listText}>{JSON.stringify(event.details)}</Text>
            : null}
        </Card>
      ))}
      {audit.length === 0 ? <Card><Text style={styles.muted}>{t('platformAdmin.empty')}</Text></Card> : null}
    </>
  )
}

function formatDate(value: string, language: 'en' | 'sw'): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ')
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    navigation: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    navItem: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 9,
    },
    navSelected: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    navText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    navSelectedText: { color: colors.accentPressed },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    metricCard: { flexBasis: '47%', flexGrow: 1 },
    metricValue: { color: colors.text, fontSize: 22, fontWeight: '700' },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
    statusActive: { color: colors.accentPressed, fontWeight: '700' },
    statusInactive: { color: colors.danger, fontWeight: '700' },
    adminBadge: { color: colors.accentPressed, fontSize: 12, fontWeight: '700' },
    listItem: { borderTopColor: colors.border, borderTopWidth: 1, gap: 3, paddingTop: 10 },
    listText: { color: colors.text, fontSize: 13, lineHeight: 19 },
  })
}
