import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs } from '@/src/domain/money'
import { formatNumber } from '@/src/i18n/format'
import { getSalesSummary, type SalesSummary } from '@/src/repositories/sales'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
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
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      setSummary(current ? await getSalesSummary(database, current) : null)
      setError(null)
    } catch (reason) {
      setError(localizeError(reason, 'dashboard.loadError'))
    }
  }, [database, localizeError])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  if (error) {
    return (
      <Screen>
        <PageTitle title="ShopFlow" />
        <Card><Text style={styles.error}>{error}</Text></Card>
      </Screen>
    )
  }
  if (!workspace || !summary) return <Screen><LoadingState label={t('dashboard.loading')} /></Screen>

  return (
    <Screen>
      <View style={styles.heading}>
        <View>
          <Text style={styles.greeting}>{t('dashboard.greeting', { name: workspace.userName })}</Text>
          <Text style={styles.business}>{workspace.businessName}</Text>
          <Text style={styles.store}>{t('dashboard.storeOffline', { store: workspace.storeName })}</Text>
        </View>
        <View style={styles.brandMark}><Text style={styles.brandText}>S</Text></View>
      </View>

      <Card style={styles.totalCard}>
        <Text style={styles.totalLabel}>{t('dashboard.salesToday')}</Text>
        <Text style={styles.totalValue}>{formatTzs(summary.todayTotalMinor, language)}</Text>
        <Text style={styles.totalCaption}>
          {summary.todayCount === 1
            ? t('dashboard.localSaleOne')
            : t('dashboard.localSalesMany', { count: formatNumber(summary.todayCount, language) })}
        </Text>
      </Card>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/pos')}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionSymbol}>+</Text>
          <Text style={styles.actionTitle}>{t('dashboard.newSale')}</Text>
          <Text style={styles.actionCaption}>{t('dashboard.cashPos')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/products')}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={styles.actionSymbol}>▦</Text>
          <Text style={styles.actionTitle}>{t('dashboard.addProduct')}</Text>
          <Text style={styles.actionCaption}>{t('dashboard.catalogStock')}</Text>
        </Pressable>
      </View>

      <Card>
        <Text style={styles.cardTitle}>{t('dashboard.offlineStatus')}</Text>
        <Text style={styles.body}>
          {summary.pendingSyncCount === 0
            ? t('dashboard.offlineMessageNone')
            : summary.pendingSyncCount === 1
              ? t('dashboard.offlineMessageOne')
              : t('dashboard.offlineMessageMany', { count: formatNumber(summary.pendingSyncCount, language) })}
        </Text>
        <Text style={styles.pendingNote}>{t('dashboard.noNetworkSync')}</Text>
      </Card>
      <Button label={t('dashboard.viewStock')} secondary onPress={() => router.push('/inventory')} />
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
    cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    body: { color: colors.text, fontSize: 14, lineHeight: 21 },
    pendingNote: { color: colors.muted, fontSize: 12 },
    error: { color: colors.danger, fontSize: 14 },
  })
}
