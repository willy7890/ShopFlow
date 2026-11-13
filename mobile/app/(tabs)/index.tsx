import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs } from '@/src/domain/money'
import { dashboardMetrics, type BackendRecentSale, type DashboardMetrics } from '@/src/domain/dashboard'
import { formatNumber } from '@/src/i18n/format'
import { getSalesSummary, type SalesSummary } from '@/src/repositories/sales'
import { getActiveWorkspace, type Permission, type Workspace } from '@/src/repositories/workspace'
import { ApiError, hasOnlineSession } from '@/src/services/api'
import { fetchMobileDashboard, fetchRecentSales } from '@/src/services/dashboard'
import { syncWorkspaceOutbox, type SyncSummary } from '@/src/services/sync'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'

export default function DashboardScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const router = useRouter()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [summary, setSummary] = useState<SalesSummary | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [canViewDashboard, setCanViewDashboard] = useState(false)
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recentSales, setRecentSales] = useState<BackendRecentSale[]>([])
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [onlineContext, setOnlineContext] = useState(false)

  const load = useCallback(async () => {
    try {
      const current = await getActiveWorkspace(database)
      const context = await database.getFirstAsync<{ setting_value: string }>(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
      )
      setWorkspace(current)
      setOnlineContext(context?.setting_value === 'online')
      const currentPermissions = current?.role === 'owner'
        ? []
        : current
          ? (await database.getAllAsync<{ permission: Permission }>(
            `SELECT permission FROM user_store_permissions
             WHERE business_id = ? AND store_id = ? AND user_id = ?`,
            current.businessId,
            current.storeId,
            current.userId,
          )).map(({ permission }) => permission)
          : []
      const dashboardAllowed = current?.role === 'owner' || currentPermissions.includes('view_dashboard')
      setPermissions(currentPermissions)
      setCanViewDashboard(dashboardAllowed)
      setSummary(current && dashboardAllowed ? await getSalesSummary(database, current) : null)
      if (!dashboardAllowed) {
        setMetrics(null)
        setRecentSales([])
      }
      setError(null)
      return { current, isOnline: context?.setting_value === 'online', dashboardAllowed, currentPermissions }
    } catch (reason) {
      setError(localizeError(reason, 'dashboard.loadError'))
      return { current: null, isOnline: false, dashboardAllowed: false, currentPermissions: [] as Permission[] }
    }
  }, [database, localizeError])

  const loadRemote = useCallback(async (
    current: Workspace,
    currentPermissions: Permission[],
  ) => {
    setRemoteError(null)
    try {
      const report = await fetchMobileDashboard(database, current, localDate())
      setMetrics(dashboardMetrics(report))
      const canViewTransactions = current.role === 'owner' || currentPermissions.includes('sell')
      if (canViewTransactions) {
        try {
          setRecentSales(await fetchRecentSales(database, current))
        } catch (reason) {
          setRecentSales([])
          setRemoteError(localizeError(reason, 'dashboard.recentError'))
        }
      } else {
        setRecentSales([])
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setCanViewDashboard(false)
        setSummary(null)
        setMetrics(null)
        setRecentSales([])
        setRemoteError(t('dashboard.noDashboardPermission'))
      } else {
        setMetrics(null)
        setRecentSales([])
        setRemoteError(localizeError(reason, 'dashboard.remoteError'))
      }
    }
  }, [database, localizeError, t])

  const syncNow = useCallback(async (current: Workspace) => {
    setSyncing(true)
    setSyncMessage(null)
    try {
      const result: SyncSummary = await syncWorkspaceOutbox(database, current)
      const completed = t('sync.completed', {
        synced: result.synced,
        failed: result.failed,
        pending: result.pending,
      })
      setSyncMessage(result.failureMessage
        ? `${completed}\n${t('sync.failureDetails', { message: result.failureMessage })}`
        : completed)
      const loaded = await load()
      if (loaded.current && loaded.isOnline && loaded.dashboardAllowed && await hasOnlineSession()) {
        await loadRemote(loaded.current, loaded.currentPermissions)
      }
    } catch (reason) {
      setSyncMessage(localizeError(reason, 'sync.failed'))
      await load()
    } finally {
      setSyncing(false)
    }
  }, [database, load, loadRemote, localizeError, t])

  useFocusEffect(useCallback(() => {
    let active = true
    void (async () => {
      const loaded = await load()
      if (!active || !loaded.current || !loaded.dashboardAllowed) return
      if (loaded.isOnline && await hasOnlineSession()) {
        await loadRemote(loaded.current, loaded.currentPermissions)
        if (active) await syncNow(loaded.current)
      }
    })()
    return () => { active = false }
  }, [database, load, loadRemote, syncNow]))

  if (error) {
    return (
      <Screen>
        <PageTitle title="ShopFlow" />
        <Card><Text style={styles.error}>{error}</Text></Card>
      </Screen>
    )
  }
  if (!workspace) return <Screen><LoadingState label={t('dashboard.loading')} /></Screen>
  if (!canViewDashboard) {
    return (
      <Screen>
        <PageTitle title="ShopFlow" />
        <Card><Text style={styles.error}>{t('dashboard.noDashboardPermission')}</Text></Card>
      </Screen>
    )
  }

  const canViewSales = workspace.role === 'owner'
    || permissions.includes('sell')
    || permissions.includes('view_reports')
  const canViewTransactions = workspace.role === 'owner' || permissions.includes('sell')
  const canViewInventory = workspace.role === 'owner'
    || permissions.includes('manage_inventory')
    || permissions.includes('view_reports')
  const canViewFinance = workspace.role === 'owner'
    || permissions.includes('manage_finance')
    || permissions.includes('view_reports')
  const canViewCustomers = workspace.role === 'owner'
    || permissions.includes('manage_customers')
    || permissions.includes('view_reports')
  const canViewSuppliers = workspace.role === 'owner'
    || permissions.includes('manage_suppliers')
    || canViewFinance
    || permissions.includes('view_reports')
  const isLive = onlineContext && Boolean(metrics)
  const salesTotal = isLive ? metrics?.salesTotal ?? 0 : summary?.todayTotalMinor ?? 0

  return (
    <Screen>
      <View style={styles.heading}>
        <View>
          <Text style={styles.greeting}>{t('dashboard.greeting', { name: workspace.userName })}</Text>
          <Text style={styles.business}>{workspace.businessName}</Text>
          <Text style={styles.store}>
            {isLive
              ? t('dashboard.connectedData', { store: workspace.storeName })
              : t('dashboard.storeOffline', { store: workspace.storeName })}
          </Text>
        </View>
        <View style={styles.brandMark}><Text style={styles.brandText}>S</Text></View>
      </View>

      {canViewSales ? (
        <Card style={styles.totalCard}>
          <Text style={styles.totalLabel}>{t('dashboard.salesToday')}</Text>
          <Text style={styles.totalValue}>{formatTzs(salesTotal, language)}</Text>
          <Text style={styles.totalCaption}>
            {isLive
              ? metrics?.transactionCount === 1
                ? t('dashboard.onlineSaleOne')
                : t('dashboard.onlineSales', { count: formatNumber(metrics?.transactionCount ?? 0, language) })
              : (summary?.todayCount ?? 0) === 1
                ? t('dashboard.localSaleOne')
                : t('dashboard.localSalesMany', { count: formatNumber(summary?.todayCount ?? 0, language) })}
          </Text>
        </Card>
      ) : null}

      {isLive ? (
        <View style={styles.metricGrid}>
          {canViewSales ? <Metric label={t('dashboard.transactionCount')} value={formatNumber(metrics?.transactionCount ?? 0, language)} colors={colors} /> : null}
          {canViewFinance ? <Metric label={t('dashboard.netProfit')} value={formatTzs(metrics?.netProfit ?? 0, language)} colors={colors} /> : null}
          {canViewInventory ? (
            <>
              <Metric label={t('dashboard.stockQuantity')} value={formatNumber(metrics?.stockQuantity ?? 0, language)} colors={colors} />
              <Metric label={t('dashboard.lowStock')} value={formatNumber(metrics?.lowStockCount ?? 0, language)} colors={colors} />
            </>
          ) : null}
          {canViewCustomers ? (
            <>
              <Metric label={t('dashboard.customerDebt')} value={formatTzs(metrics?.customerDebt ?? 0, language)} colors={colors} />
              <Metric label={t('dashboard.customerCount')} value={formatNumber(metrics?.customerCount ?? 0, language)} colors={colors} />
            </>
          ) : null}
          {canViewSuppliers ? (
            <>
              <Metric label={t('dashboard.supplierPayable')} value={formatTzs(metrics?.supplierPayable ?? 0, language)} colors={colors} />
              <Metric label={t('dashboard.supplierCount')} value={formatNumber(metrics?.supplierCount ?? 0, language)} colors={colors} />
            </>
          ) : null}
          {canViewFinance ? (
            <>
              <Metric label={t('dashboard.expenses')} value={formatTzs(metrics?.expenses ?? 0, language)} colors={colors} />
              <Metric label={t('dashboard.netCash')} value={formatTzs(metrics?.netCash ?? 0, language)} colors={colors} />
            </>
          ) : null}
        </View>
      ) : null}

      {remoteError ? <Text style={styles.error}>{remoteError}</Text> : null}

      {isLive && canViewTransactions ? (
        <Card>
          <Text style={styles.cardTitle}>{t('dashboard.recentSales')}</Text>
          {recentSales.length === 0 ? <Text style={styles.body}>{t('dashboard.noRecentSales')}</Text> : recentSales.map((sale) => (
            <View key={sale.id} style={styles.recentRow}>
              <View style={styles.recentInfo}>
                <Text style={styles.recentName}>{sale.sale_number}</Text>
                <Text style={styles.pendingNote}>
                  {sale.customer_name || t('dashboard.walkIn')} · {new Date(sale.created_at).toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ', { dateStyle: 'medium', timeStyle: 'short' })}
                </Text>
              </View>
              <Text style={styles.recentAmount}>{formatTzs(Math.round(Number(sale.total_amount)), language)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <View style={styles.actionRow}>
        {canViewTransactions ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/pos')}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionSymbol}>+</Text>
          <Text style={styles.actionTitle}>{t('dashboard.newSale')}</Text>
          <Text style={styles.actionCaption}>{t('dashboard.cashPos')}</Text>
        </Pressable>
        ) : null}
        {workspace.role === 'owner' || permissions.includes('manage_products') ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/products')}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionSymbol}>▦</Text>
          <Text style={styles.actionTitle}>{t('dashboard.addProduct')}</Text>
          <Text style={styles.actionCaption}>{t('dashboard.catalogStock')}</Text>
        </Pressable>
        ) : null}
      </View>

      {summary ? <Card>
        <Text style={styles.cardTitle}>{t('dashboard.offlineStatus')}</Text>
        <Text style={styles.body}>
          {summary.pendingSyncCount === 0
            ? t('dashboard.offlineMessageNone')
            : summary.pendingSyncCount === 1
              ? t('dashboard.offlineMessageOne')
              : t('dashboard.offlineMessageMany', { count: formatNumber(summary.pendingSyncCount, language) })}
        </Text>
        <Text style={styles.pendingNote}>{t('dashboard.noNetworkSync')}</Text>
        <Button
          label={syncing ? t('sync.running') : t('sync.now')}
          onPress={() => void syncNow(workspace)}
          disabled={syncing || !onlineContext}
          secondary
        />
        {syncMessage ? <Text style={styles.pendingNote}>{syncMessage}</Text> : null}
      </Card> : null}
      {canViewSales || canViewFinance ? <Button label={t('assistant.open')} secondary onPress={() => router.push('/assistant')} /> : null}
      {canViewInventory ? <Button label={t('dashboard.viewStock')} secondary onPress={() => router.push('/inventory')} /> : null}
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
    greeting: { color: colors.muted, fontSize: 14 },
    business: { color: colors.text, fontSize: 23, fontWeight: '700', marginTop: 3 },
    store: { color: colors.muted, fontSize: 13, marginTop: 4 },
    brandMark: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 17, height: 44, justifyContent: 'center', width: 44 },
    brandText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
    totalCard: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder, paddingVertical: 21 },
    totalLabel: { color: colors.accentText, fontSize: 14, fontWeight: '600' },
    totalValue: { color: colors.text, fontSize: 32, fontWeight: '800' },
    totalCaption: { color: colors.muted, fontSize: 13 },
    actionRow: { flexDirection: 'row', gap: 12 },
    action: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 16, borderWidth: 1, flex: 1, gap: 7, minHeight: 122, padding: 15 },
    actionPressed: { backgroundColor: colors.surfaceMuted },
    actionSymbol: { color: colors.accent, fontSize: 25, fontWeight: '700' },
    actionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    actionCaption: { color: colors.muted, fontSize: 12 },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    recentRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', paddingVertical: 9 },
    recentInfo: { flex: 1, gap: 3 },
    recentName: { color: colors.text, fontSize: 14, fontWeight: '700' },
    recentAmount: { color: colors.text, fontSize: 14, fontWeight: '700' },
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    body: { color: colors.text, fontSize: 14, lineHeight: 21 },
    pendingNote: { color: colors.muted, fontSize: 12 },
    error: { color: colors.danger, fontSize: 14 },
  })
}

function Metric({
  label,
  value,
  colors,
}: {
  label: string
  value: string
  colors: ThemeColors
}) {
  return (
    <View style={[stylesMetric.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[stylesMetric.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[stylesMetric.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

const stylesMetric = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, flexBasis: '47%', flexGrow: 1, gap: 8, minHeight: 82, padding: 13 },
  label: { fontSize: 12, lineHeight: 16 },
  value: { fontSize: 17, fontWeight: '700' },
})

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
