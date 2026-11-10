import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { cacheDirectory, deleteAsync, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs } from '@/src/domain/money'
import { buildInvoiceHtml } from '@/src/domain/invoiceHtml'
import {
  getSaleDetail,
  listRecentSales,
  listSalePayments,
  type SaleDetail,
  type SaleHistoryEntry,
  type SalePaymentHistoryEntry,
} from '@/src/repositories/sales'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { hasOnlineSession } from '@/src/services/api'
import { refundSaleOnline } from '@/src/services/salesRefund'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

type SalesTab = 'sales' | 'payments'
type SaleFilter = 'all' | 'paid' | 'partial' | 'unpaid' | 'refunded'
type PaymentFilter = 'all' | 'confirmed' | 'pending' | 'failed' | 'credit'
type SalesPeriod = 'all' | 7 | 30 | 90

export default function SalesScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [sales, setSales] = useState<SaleHistoryEntry[]>([])
  const [payments, setPayments] = useState<SalePaymentHistoryEntry[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<SalesTab>('sales')
  const [saleFilter, setSaleFilter] = useState<SaleFilter>('all')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [period, setPeriod] = useState<SalesPeriod>(30)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [refunding, setRefunding] = useState(false)
  const [onlineWorkspace, setOnlineWorkspace] = useState(false)
  const [refundReason, setRefundReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      const [context, hasSession] = await Promise.all([
        database.getFirstAsync<{ setting_value: string }>(
          "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
        ),
        hasOnlineSession(),
      ])
      setWorkspace(current)
      setOnlineWorkspace(context?.setting_value === 'online' && hasSession)
      setSelectedSale(null)
      setRefundReason('')
      if (current) {
        const [saleRows, paymentRows] = await Promise.all([
          listRecentSales(database, current, search),
          listSalePayments(database, current, search),
        ])
        setSales(saleRows)
        setPayments(paymentRows)
      } else {
        setSales([])
        setPayments([])
      }
    } finally {
      setLoading(false)
    }
  }, [database, search])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'sales.loadError')))
  }, [load, localizeError]))

  const showSale = async (sale: SaleHistoryEntry) => {
    if (!workspace) return
    setError(null)
    try {
      const detail = await getSaleDetail(database, workspace, sale.id)
      if (!detail) throw new Error(t('sales.missing'))
      setSelectedSale((current) => current?.id === detail.id ? null : detail)
      setRefundReason(detail.refundStatus === 'pending' ? detail.refundReason ?? '' : '')
    } catch (reason) {
      setError(localizeError(reason, 'sales.loadError'))
    }
  }

  const confirmRefund = (sale: SaleDetail) => {
    const reason = refundReason.trim()
    if (reason.length < 2) {
      setError(t('sales.refundReasonRequired'))
      return
    }
    Alert.alert(
      t('sales.refundConfirmTitle'),
      t('sales.refundConfirmMessage', { number: sale.saleNumber }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sales.refundConfirmAction'),
          style: 'destructive',
          onPress: () => void performRefund(sale, reason),
        },
      ],
    )
  }

  const performRefund = async (sale: SaleDetail, reason: string) => {
    if (!workspace) return
    setRefunding(true)
    setError(null)
    try {
      await refundSaleOnline(database, workspace, sale, reason, Crypto.randomUUID)
      await load()
      const refreshed = await getSaleDetail(database, workspace, sale.id)
      setSelectedSale(refreshed)
    } catch (reason) {
      setError(localizeError(reason, 'sales.refundError'))
      try {
        const refreshed = await getSaleDetail(database, workspace, sale.id)
        if (refreshed && (refreshed.refundMinor || refreshed.refundStatus === 'pending')) {
          setSelectedSale(refreshed)
          setRefundReason(refreshed.refundReason ?? '')
        }
      } catch (refreshError) {
        setError(`${localizeError(reason, 'sales.refundError')} ${localizeError(refreshError, 'sales.loadError')}`)
      }
    } finally {
      setRefunding(false)
    }
  }

  const shareReceipt = async (sale: SaleDetail) => {
    if (!workspace) return
    let fileUri: string | null = null
    setSharing(true)
    setError(null)
    try {
      if (!cacheDirectory) throw new Error(t('sales.exportUnavailable'))
      fileUri = `${cacheDirectory}receipt-${Crypto.randomUUID()}.txt`
      const date = new Intl.DateTimeFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(sale.createdAt))
      const itemLines = sale.items.map((item) =>
        `${item.quantity} x ${item.productName} ${item.variantName} @ ${formatTzs(item.unitPriceMinor, language)} = ${formatTzs(item.lineTotalMinor, language)}`,
      )
      const receipt = [
        'ShopFlow',
        workspace.businessName,
        workspace.storeName,
        t('sales.receipt'),
        `${t('sales.number')}: ${sale.saleNumber}`,
        `${t('sales.date')}: ${date}`,
        ...(sale.customerName ? [`${t('sales.customer')}: ${sale.customerName}`] : []),
        '',
        ...itemLines,
        '',
        `${t('sales.total')}: ${formatTzs(sale.totalMinor, language)}`,
        `${t('sales.paid')}: ${formatTzs(sale.paidMinor, language)}`,
        `${t('sales.balanceDue')}: ${formatTzs(sale.balanceDueMinor, language)}`,
        ...(sale.refundMinor > 0
          ? [`${t('sales.refundAmount')}: ${formatTzs(sale.refundMinor, language)}`]
          : []),
        `${t('sales.cashTendered')}: ${formatTzs(sale.cashTenderedMinor, language)}`,
        `${t('sales.change')}: ${formatTzs(sale.changeMinor, language)}`,
      ].join('\n')
      await writeAsStringAsync(fileUri, receipt)
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/plain',
        dialogTitle: t('sales.shareTitle', { number: sale.saleNumber }),
      })
    } catch (reason) {
      setError(localizeError(reason, 'sales.exportError'))
    } finally {
      if (fileUri) {
        try {
          await deleteAsync(fileUri, { idempotent: true })
        } catch (reason) {
          setError(localizeError(reason, 'sales.exportError'))
        }
      }
      setSharing(false)
    }
  }

  const invoiceHtml = (sale: SaleDetail) => {
    const date = formatDate(sale.createdAt, language)
    return buildInvoiceHtml({
      businessName: workspace?.businessName ?? '',
      storeName: workspace?.storeName ?? '',
      invoiceLabel: t('sales.invoice'),
      saleNumberLabel: t('sales.number'),
      dateLabel: t('sales.date'),
      customerLabel: t('sales.customer'),
      walkInLabel: t('sales.walkIn'),
      itemLabel: t('sales.item'),
      quantityLabel: t('sales.quantity'),
      unitPriceLabel: t('sales.unitPrice'),
      totalLabel: t('sales.total'),
      paidLabel: t('sales.paid'),
      balanceDueLabel: t('sales.balanceDue'),
      cashTenderedLabel: t('sales.cashTendered'),
      changeLabel: t('sales.change'),
      refundLabel: t('sales.refundAmount'),
      saleNumber: sale.saleNumber,
      date,
      customerName: sale.customerName,
      total: formatTzs(sale.totalMinor, language),
      paid: formatTzs(sale.paidMinor, language),
      balanceDue: formatTzs(sale.balanceDueMinor, language),
      cashTendered: formatTzs(sale.cashTenderedMinor, language),
      change: formatTzs(sale.changeMinor, language),
      refund: sale.refundMinor > 0 ? formatTzs(sale.refundMinor, language) : null,
      items: sale.items.map((item) => ({
        quantity: String(item.quantity),
        name: `${item.productName} ${item.variantName}`,
        unitPrice: formatTzs(item.unitPriceMinor, language),
        lineTotal: formatTzs(item.lineTotalMinor, language),
      })),
    })
  }

  const shareInvoicePdf = async (sale: SaleDetail) => {
    let fileUri: string | null = null
    setSharing(true)
    setError(null)
    try {
      const file = await Print.printToFileAsync({ html: invoiceHtml(sale) })
      fileUri = file.uri
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('sales.shareInvoiceTitle', { number: sale.saleNumber }),
        UTI: 'com.adobe.pdf',
      })
    } catch (reason) {
      setError(localizeError(reason, 'sales.invoiceError'))
    } finally {
      if (fileUri) {
        try {
          await deleteAsync(fileUri, { idempotent: true })
        } catch (reason) {
          setError(localizeError(reason, 'sales.invoiceError'))
        }
      }
      setSharing(false)
    }
  }

  const printInvoice = async (sale: SaleDetail) => {
    setPrinting(true)
    setError(null)
    try {
      await Print.printAsync({ html: invoiceHtml(sale) })
    } catch (reason) {
      setError(localizeError(reason, 'sales.invoiceError'))
    } finally {
      setPrinting(false)
    }
  }

  const visibleSales = sales.filter((sale) => (
    (saleFilter === 'all' || saleStatus(sale) === saleFilter)
    && isWithinPeriod(sale.createdAt, period)
  ))
  const visiblePayments = payments.filter((payment) => (
    (paymentFilter === 'all' || payment.status === paymentFilter)
    && isWithinPeriod(payment.createdAt, period)
  ))
  const salesTotals = visibleSales.reduce((totals, sale) => ({
    total: totals.total + sale.totalMinor,
    paid: totals.paid + sale.paidMinor,
    due: totals.due + sale.balanceDueMinor,
    refunds: totals.refunds + sale.refundMinor,
  }), { total: 0, paid: 0, due: 0, refunds: 0 })
  const paymentsTotal = visiblePayments.reduce(
    (total, payment) => total + (payment.method === 'refund' ? -payment.amountMinor : payment.amountMinor),
    0,
  )

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('sales.title')} /><Card><Text style={styles.muted}>{t('sales.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('sales.title')} subtitle={t('sales.subtitle', { store: workspace.storeName })} />
      <View style={styles.tabRow} accessibilityRole="tablist">
        <TabButton
          label={t('sales.tabSales')}
          selected={tab === 'sales'}
          onPress={() => setTab('sales')}
          colors={colors}
        />
        <TabButton
          label={t('sales.tabPayments')}
          selected={tab === 'payments'}
          onPress={() => setTab('payments')}
          colors={colors}
        />
      </View>
      <Field label={t('sales.search')} value={search} onChangeText={setSearch} autoCapitalize="characters" />
      <FilterRow<SalesPeriod>
        value={period}
        values={['all', 7, 30, 90] as const}
        label={(value) => value === 'all' ? t('sales.period.all') : t('sales.period.days', { days: value })}
        onChange={setPeriod}
        colors={colors}
      />
      {tab === 'sales' ? (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label={t('sales.total')} value={formatTzs(salesTotals.total, language)} colors={colors} />
            <MetricCard label={t('sales.paid')} value={formatTzs(salesTotals.paid, language)} colors={colors} />
            <MetricCard label={t('sales.balanceDue')} value={formatTzs(salesTotals.due, language)} colors={colors} />
            {salesTotals.refunds > 0
              ? <MetricCard label={t('sales.refundAmount')} value={formatTzs(salesTotals.refunds, language)} colors={colors} />
              : null}
          </View>
          <FilterRow
            value={saleFilter}
            values={['all', 'paid', 'partial', 'unpaid', 'refunded']}
            label={(value) => t(`sales.filter.${value}`)}
            onChange={setSaleFilter}
            colors={colors}
          />
        </>
      ) : (
        <>
          <Card>
            <View style={styles.paymentSummary}>
              <View>
                <Text style={styles.muted}>{t('sales.paymentCount')}</Text>
                <Text style={styles.summaryValue}>{visiblePayments.length}</Text>
              </View>
              <View style={styles.paymentTotal}>
                <Text style={styles.muted}>{t('sales.paymentNet')}</Text>
                <Text style={styles.summaryValue}>{formatTzs(paymentsTotal, language)}</Text>
              </View>
            </View>
          </Card>
          <FilterRow
            value={paymentFilter}
            values={['all', 'confirmed', 'pending', 'failed', 'credit']}
            label={(value) => t(`sales.paymentFilter.${value}`)}
            onChange={setPaymentFilter}
            colors={colors}
          />
        </>
      )}
      {tab === 'sales' && visibleSales.length === 0
        ? <Card><Text style={styles.muted}>{t('sales.empty')}</Text></Card>
        : null}
      {tab === 'sales' ? visibleSales.map((sale) => (
        <Card key={sale.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: selectedSale?.id === sale.id }}
            onPress={() => void showSale(sale)}
            style={styles.saleSummary}
          >
            <View style={styles.saleInfo}>
              <Text style={styles.saleNumber}>{sale.saleNumber}</Text>
              <Text style={styles.muted}>
                {formatDate(sale.createdAt, language)} · {sale.customerName ?? t('sales.walkIn')}
              </Text>
              <View style={styles.chipRow}>
                <StatusChip status={saleStatus(sale)} colors={colors} label={t(`sales.filter.${saleStatus(sale)}`)} />
                <StatusChip
                  status={sale.syncState === 'synced' ? 'confirmed' : 'pending'}
                  colors={colors}
                  label={t(`sales.sync.${sale.syncState}`)}
                />
              </View>
            </View>
            <Text style={styles.total}>{formatTzs(sale.totalMinor, language)}</Text>
          </Pressable>
          {selectedSale?.id === sale.id ? (
            <View style={styles.detail}>
              {selectedSale.items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName}>
                    {item.productName} {item.variantName} × {item.quantity}
                  </Text>
                  <Text style={styles.itemAmount}>{formatTzs(item.lineTotalMinor, language)}</Text>
                </View>
              ))}
              <SummaryLine label={t('sales.paid')} value={formatTzs(selectedSale.paidMinor, language)} colors={colors} />
              <SummaryLine label={t('sales.balanceDue')} value={formatTzs(selectedSale.balanceDueMinor, language)} colors={colors} />
              {selectedSale.refundMinor > 0 ? (
                <SummaryLine
                  label={selectedSale.refundStatus === 'refunded' ? t('sales.refunded') : t('sales.refundAmount')}
                  value={formatTzs(selectedSale.refundMinor, language)}
                  colors={colors}
                />
              ) : null}
              {selectedSale.refundStatus === 'pending' ? (
                <Text style={styles.muted}>{t('sales.refundPending')}</Text>
              ) : null}
              {onlineWorkspace
                && selectedSale.syncState === 'synced'
                && selectedSale.refundMinor === 0
                && (selectedSale.refundStatus === null || selectedSale.refundStatus === 'pending')
                && selectedSale.paidMinor === selectedSale.totalMinor
                && selectedSale.balanceDueMinor === 0 ? (
                  <>
                    <Field
                      label={t('sales.refundReason')}
                      value={refundReason}
                      onChangeText={setRefundReason}
                      maxLength={220}
                      editable={selectedSale.refundStatus !== 'pending'}
                    />
                    <Text style={styles.muted}>{t('sales.refundOnlineOnly')}</Text>
                    <Button
                      label={refunding
                        ? t('sales.refunding')
                        : selectedSale.refundStatus === 'pending'
                          ? t('sales.retryRefund')
                          : t('sales.refundSale')}
                      onPress={() => confirmRefund(selectedSale)}
                      disabled={refunding}
                      secondary
                    />
                  </>
                ) : null}
              <Button
                label={sharing ? t('sales.sharing') : t('sales.shareReceipt')}
                onPress={() => void shareReceipt(selectedSale)}
                disabled={sharing || printing}
                secondary
              />
              <Button
                label={sharing ? t('sales.invoicePreparing') : t('sales.shareInvoice')}
                onPress={() => void shareInvoicePdf(selectedSale)}
                disabled={sharing || printing}
              />
              <Button
                label={printing ? t('sales.printingInvoice') : t('sales.printInvoice')}
                onPress={() => void printInvoice(selectedSale)}
                disabled={sharing || printing}
                secondary
              />
            </View>
          ) : null}
        </Card>
      )) : null}
      {tab === 'payments' && visiblePayments.length === 0
        ? <Card><Text style={styles.muted}>{t('sales.paymentsEmpty')}</Text></Card>
        : null}
      {tab === 'payments' ? visiblePayments.map((payment) => (
        <Card key={payment.id}>
          <View style={styles.paymentRow}>
            <View style={styles.saleInfo}>
              <Text style={styles.saleNumber}>{payment.saleNumber}</Text>
              <Text style={styles.muted}>
                {formatDate(payment.createdAt, language)} · {payment.customerName ?? t('sales.walkIn')}
              </Text>
              <Text style={styles.muted}>{t(`sales.method.${payment.method}`)}</Text>
            </View>
            <View style={styles.paymentAmount}>
              <Text style={[
                styles.total,
                payment.method === 'refund' && { color: colors.danger },
              ]}>
                {payment.method === 'refund' ? '−' : ''}{formatTzs(payment.amountMinor, language)}
              </Text>
              <StatusChip
                status={payment.status}
                colors={colors}
                label={t(`sales.paymentStatus.${payment.status}`)}
              />
            </View>
          </View>
          <Text style={styles.reference}>
            {t('sales.paymentReference')}: {payment.reference ?? '—'}
          </Text>
        </Card>
      )) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

function saleStatus(sale: SaleHistoryEntry): SaleFilter {
  if (sale.refundMinor > 0) return 'refunded'
  if (sale.balanceDueMinor <= 0) return 'paid'
  if (sale.paidMinor > 0) return 'partial'
  return 'unpaid'
}

function isWithinPeriod(value: string, period: SalesPeriod): boolean {
  if (period === 'all') return true
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= Date.now() - period * 24 * 60 * 60 * 1000
}

function TabButton({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string
  selected: boolean
  onPress: () => void
  colors: ThemeColors
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        stylesTabs.tab,
        { borderColor: selected ? colors.accent : colors.border },
        selected && { backgroundColor: colors.accentSurface },
      ]}
    >
      <Text style={[stylesTabs.text, { color: selected ? colors.accentText : colors.muted }]}>{label}</Text>
    </Pressable>
  )
}

function FilterRow<Value extends string | number>({
  value,
  values,
  label,
  onChange,
  colors,
}: {
  value: Value
  values: readonly Value[]
  label: (value: Value) => string
  onChange: (value: Value) => void
  colors: ThemeColors
}) {
  return (
    <View style={stylesFilters.row}>
      {values.map((option) => {
        const selected = value === option
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[
              stylesFilters.filter,
              { borderColor: selected ? colors.accent : colors.border },
              selected && { backgroundColor: colors.accentSurface },
            ]}
          >
            <Text style={[stylesFilters.text, { color: selected ? colors.accentText : colors.text }]}>
              {label(option)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function MetricCard({ label, value, colors }: { label: string; value: string; colors: ThemeColors }) {
  return (
    <View style={[stylesMetricCard.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[stylesMetricCard.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[stylesMetricCard.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

function StatusChip({
  status,
  colors,
  label,
}: {
  status: string
  colors: ThemeColors
  label: string
}) {
  const color = status === 'paid' || status === 'confirmed'
    ? colors.success
    : status === 'unpaid' || status === 'failed' || status === 'refunded'
      ? colors.danger
      : colors.accentText
  return (
    <View style={[stylesChip.chip, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <View style={[stylesChip.dot, { backgroundColor: color }]} />
      <Text style={[stylesChip.label, { color }]}>{label}</Text>
    </View>
  )
}

const stylesTabs = StyleSheet.create({
  tab: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flex: 1, paddingVertical: 11 },
  text: { fontSize: 14, fontWeight: '700' },
})

const stylesFilters = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filter: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  text: { fontSize: 12, fontWeight: '600' },
})

const stylesMetricCard = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, flexBasis: '47%', flexGrow: 1, gap: 4, padding: 12 },
  label: { fontSize: 12 },
  value: { fontSize: 15, fontWeight: '800' },
})

const stylesChip = StyleSheet.create({
  chip: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 4 },
  dot: { borderRadius: 4, height: 7, width: 7 },
  label: { fontSize: 11, fontWeight: '700' },
})

function formatDate(value: string, language: 'en' | 'sw'): string {
  return new Intl.DateTimeFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function SummaryLine({ label, value, colors }: { label: string; value: string; colors: ThemeColors }) {
  return (
    <View style={stylesSummary.row}>
      <Text style={[stylesSummary.label, { color: colors.muted }]}>{label}</Text>
      <Text style={[stylesSummary.value, { color: colors.text }]}>{value}</Text>
    </View>
  )
}

const stylesSummary = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  label: { fontSize: 14 },
  value: { fontSize: 14, fontWeight: '600' },
})

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    tabRow: { flexDirection: 'row', gap: 8 },
    metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chipRow: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    paymentSummary: { flexDirection: 'row', justifyContent: 'space-between' },
    paymentTotal: { alignItems: 'flex-end' },
    summaryValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
    paymentRow: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    paymentAmount: { alignItems: 'flex-end', gap: 6 },
    reference: { borderTopColor: colors.border, borderTopWidth: 1, color: colors.muted, fontSize: 12, marginTop: 10, paddingTop: 8 },
    saleSummary: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    saleInfo: { flex: 1, gap: 4 },
    saleNumber: { color: colors.text, fontSize: 16, fontWeight: '700' },
    total: { color: colors.text, fontSize: 15, fontWeight: '700' },
    detail: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingTop: 12 },
    itemRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    itemName: { color: colors.text, flex: 1, fontSize: 14 },
    itemAmount: { color: colors.text, fontSize: 14, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger, fontSize: 14 },
  })
}
