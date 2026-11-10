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
import { getSaleDetail, listRecentSales, type SaleDetail, type SaleHistoryEntry } from '@/src/repositories/sales'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { hasOnlineSession } from '@/src/services/api'
import { refundSaleOnline } from '@/src/services/salesRefund'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

export default function SalesScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [sales, setSales] = useState<SaleHistoryEntry[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [search, setSearch] = useState('')
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
      setSales(current ? await listRecentSales(database, current, search) : [])
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

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('sales.title')} /><Card><Text style={styles.muted}>{t('sales.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('sales.title')} subtitle={t('sales.subtitle', { store: workspace.storeName })} />
      <Field label={t('sales.search')} value={search} onChangeText={setSearch} autoCapitalize="characters" />
      {sales.length === 0 ? <Card><Text style={styles.muted}>{t('sales.empty')}</Text></Card> : sales.map((sale) => (
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
              <Text style={styles.muted}>{t(`sales.sync.${sale.syncState}`)}</Text>
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
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

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
