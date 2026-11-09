import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs } from '@/src/domain/money'
import { getLocalReport, type LocalReport } from '@/src/repositories/cashbook'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

const periods = [7, 30, 90] as const

export default function ReportsScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [report, setReport] = useState<LocalReport | null>(null)
  const [days, setDays] = useState<typeof periods[number]>(30)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (period: typeof periods[number]) => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      setReport(current ? await getLocalReport(database, current, period) : null)
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load(days).catch((reason: unknown) => setError(localizeError(reason, 'reports.loadError')))
  }, [days, load, localizeError]))

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('reports.title')} /><Card><Text style={styles.muted}>{t('reports.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('reports.title')} subtitle={t('reports.subtitle', { store: workspace.storeName })} />
      <View style={styles.periodRow}>
        {periods.map((period) => (
          <Pressable
            key={period}
            accessibilityRole="button"
            accessibilityState={{ selected: days === period }}
            onPress={() => setDays(period)}
            style={[styles.periodButton, days === period && styles.selectedPeriod]}
          >
            <Text style={styles.periodText}>{t('reports.period', { days: period })}</Text>
          </Pressable>
        ))}
      </View>
      {report ? (
        <>
          <Card>
            <Text style={styles.sectionTitle}>{t('reports.sales')}</Text>
            <Metric label={t('reports.grossSales')} value={formatTzs(report.salesTotalMinor, language)} colors={colors} />
            <Metric label={t('reports.transactions')} value={String(report.salesCount)} colors={colors} />
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>{t('reports.cashflow')}</Text>
            <Metric label={t('reports.income')} value={formatTzs(report.incomeMinor, language)} colors={colors} />
            <Metric label={t('reports.expenses')} value={formatTzs(report.expenseMinor, language)} colors={colors} />
            <Metric
              label={t('reports.netCash')}
              value={`${report.netCashMinor < 0 ? '−' : ''}${formatTzs(Math.abs(report.netCashMinor), language)}`}
              colors={colors}
              emphasis
            />
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>{t('reports.outstanding')}</Text>
            <Metric label={t('reports.customerDebt')} value={formatTzs(report.customerDebtMinor, language)} colors={colors} />
            <Metric label={t('reports.supplierPayable')} value={formatTzs(report.supplierPayableMinor, language)} colors={colors} />
          </Card>
          <Card>
            <Text style={styles.sectionTitle}>{t('reports.topProducts')}</Text>
            {report.topProducts.length === 0 ? <Text style={styles.muted}>{t('reports.noSales')}</Text> : report.topProducts.map((item, index) => (
              <View key={`${item.name}-${index}`} style={styles.productRow}>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{index + 1}. {item.name}</Text>
                  <Text style={styles.muted}>{t('reports.unitsSold', { count: item.quantity })}</Text>
                </View>
                <Text style={styles.value}>{formatTzs(item.totalMinor, language)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

function Metric({
  label,
  value,
  colors,
  emphasis = false,
}: {
  label: string
  value: string
  colors: ThemeColors
  emphasis?: boolean
}) {
  return (
    <View style={stylesMetric.row}>
      <Text style={[stylesMetric.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[stylesMetric.value, { color: colors.text }, emphasis && stylesMetric.emphasis]}>{value}</Text>
    </View>
  )
}

const stylesMetric = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  label: { flex: 1, fontSize: 14 },
  value: { fontSize: 15, fontWeight: '600' },
  emphasis: { fontSize: 18, fontWeight: '800' },
})

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    periodRow: { flexDirection: 'row', gap: 8 },
    periodButton: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
    selectedPeriod: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    periodText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    productRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', paddingVertical: 10 },
    productInfo: { flex: 1, gap: 3 },
    productName: { color: colors.text, fontSize: 14, fontWeight: '600' },
    value: { color: colors.text, fontSize: 13, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, fontSize: 14 },
  })
}
