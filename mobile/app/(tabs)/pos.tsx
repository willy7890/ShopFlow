import { useCallback, useMemo, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { BarcodeScanner } from '@/src/components/BarcodeScanner'
import { formatTzs, multiplyMoney, parseTzsAmount } from '@/src/domain/money'
import { createCashSale } from '@/src/repositories/sales'
import { findProductByBarcode, listProducts, type LocalProduct } from '@/src/repositories/catalog'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { formatNumber } from '@/src/i18n/format'

export default function PosScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const router = useRouter()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cashTendered, setCashTendered] = useState('')
  const [barcode, setBarcode] = useState('')
  const [unknownBarcode, setUnknownBarcode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
    const current = await getActiveWorkspace(database)
    setWorkspace(current)
    setProducts(current ? await listProducts(database, current) : [])
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => {
      setError(localizeError(reason, 'pos.saleError'))
    })
  }, [load, localizeError]))

  const selected = products.filter((product) => (cart[product.variantId] ?? 0) > 0)
  const totalMinor = useMemo(() => selected.reduce(
    (sum, product) => sum + multiplyMoney(product.sellPriceMinor, cart[product.variantId] ?? 0),
    0,
  ), [cart, selected])

  const changeQuantity = (product: LocalProduct, increment: number) => {
    const current = cart[product.variantId] ?? 0
    const next = Math.max(0, current + increment)
    if (product.trackStock && next > product.quantity) {
      setError(t('pos.stockShort', { name: product.name, count: formatNumber(product.quantity, language) }))
      return
    }
    setError(null)
    setReceipt(null)
    setCart((items) => ({ ...items, [product.variantId]: next }))
    const nextTotal = selected.reduce(
      (sum, item) => sum + multiplyMoney(item.sellPriceMinor, item.variantId === product.variantId ? next : cart[item.variantId] ?? 0),
      0,
    ) + (selected.some((item) => item.variantId === product.variantId) ? 0 : multiplyMoney(product.sellPriceMinor, next))
    setCashTendered(String(nextTotal))
  }

  const addBarcodeToCart = async (value: string) => {
    const scannedBarcode = value.trim()
    setBarcode('')
    if (!scannedBarcode) return
    if (!workspace) {
      setError(t('pos.setupRequired'))
      return
    }
    setError(null)
    try {
      const product = await findProductByBarcode(database, workspace, scannedBarcode)
      if (!product) {
        setUnknownBarcode(scannedBarcode)
        return
      }
      setUnknownBarcode('')
      changeQuantity(product, 1)
    } catch (reason) {
      setError(localizeError(reason, 'pos.barcodeLookupError'))
    }
  }

  const completeSale = async () => {
    if (!workspace) {
      setError(t('pos.setupRequired'))
      return
    }
    const tendered = parseTzsAmount(cashTendered)
    if (tendered === null) {
      setError(t('pos.cashAmountError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await createCashSale(database, workspace, {
        items: selected.map((product) => ({
          variantId: product.variantId,
          quantity: cart[product.variantId] ?? 0,
        })),
        cashTenderedMinor: tendered,
      }, () => Crypto.randomUUID())
      setReceipt(t('pos.saleSaved', {
        number: result.saleNumber,
        total: formatTzs(result.totalMinor, language),
        change: formatTzs(result.changeMinor, language),
      }))
      setCart({})
      setCashTendered('')
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'pos.saleError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>

  return (
    <Screen>
      <PageTitle title={t('pos.title')} subtitle={t('pos.subtitle')} />
      <Card>
        <Text style={styles.sectionTitle}>{t('pos.scanTitle')}</Text>
        <Field
          label={t('products.barcode')}
          value={barcode}
          onChangeText={setBarcode}
          onSubmitEditing={() => void addBarcodeToCart(barcode)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label={t('pos.addBarcode')} secondary onPress={() => void addBarcodeToCart(barcode)} disabled={!barcode.trim()} />
        <Button label={t('pos.openScanner')} onPress={() => setScannerOpen(true)} />
        {unknownBarcode ? (
          <View style={styles.unknownBarcode}>
            <Text style={styles.muted}>{t('pos.unknownBarcode', { barcode: unknownBarcode })}</Text>
            <Button
              label={t('pos.registerBarcodeProduct')}
              secondary
              onPress={() => router.push({ pathname: '/products', params: { barcode: unknownBarcode } })}
            />
            <Button label={t('common.cancel')} secondary onPress={() => setUnknownBarcode('')} />
          </View>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>{t('pos.productsInStock')}</Text>
        {products.filter((product) => !product.trackStock || product.quantity > 0).length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.muted}>{t('pos.noStockedProducts')}</Text>
            <Button label={t('pos.addProducts')} secondary onPress={() => router.push('/products')} />
          </View>
        ) : products.filter((product) => !product.trackStock || product.quantity > 0).map((product) => {
          const count = cart[product.variantId] ?? 0
          return (
            <View key={product.variantId} style={styles.productRow}>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.muted}>
                  {product.trackStock
                    ? t('common.available', { count: formatNumber(product.quantity, language) })
                    : t('pos.stockNotTracked')} · {formatTzs(product.sellPriceMinor, language)}
                </Text>
              </View>
              {count === 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('pos.addProduct', { name: product.name })}
                  onPress={() => changeQuantity(product, 1)}
                  style={styles.addButton}
                >
                  <Text style={styles.addText}>{t('pos.add')}</Text>
                </Pressable>
              ) : (
                <View style={styles.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('pos.removeOne', { name: product.name })} onPress={() => changeQuantity(product, -1)} style={styles.stepButton}>
                    <Text style={styles.stepText}>−</Text>
                  </Pressable>
                  <Text style={styles.count}>{formatNumber(count, language)}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel={t('pos.addOne', { name: product.name })} onPress={() => changeQuantity(product, 1)} style={styles.stepButton}>
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )
        })}
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>{t('pos.cart')}</Text>
        {selected.length === 0 ? <Text style={styles.muted}>{t('pos.noItems')}</Text> : selected.map((product) => (
          <View key={product.variantId} style={styles.cartRow}>
            <Text style={styles.cartName}>{product.name} × {formatNumber(cart[product.variantId], language)}</Text>
            <Text style={styles.cartAmount}>{formatTzs(multiplyMoney(product.sellPriceMinor, cart[product.variantId] ?? 0), language)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t('pos.total')}</Text>
          <Text style={styles.totalAmount}>{formatTzs(totalMinor, language)}</Text>
        </View>
        <Field label={t('pos.cashReceived')} value={cashTendered} onChangeText={setCashTendered} keyboardType="number-pad" />
        {parseTzsAmount(cashTendered) !== null && parseTzsAmount(cashTendered)! >= totalMinor && totalMinor > 0 ? (
          <Text style={styles.change}>{t('pos.change', { amount: formatTzs(parseTzsAmount(cashTendered)! - totalMinor, language) })}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {receipt ? <Text style={styles.success}>{receipt}</Text> : null}
        <Button label={saving ? t('pos.saving') : t('pos.complete')} onPress={() => void completeSale()} disabled={saving || selected.length === 0} />
      </Card>
      <BarcodeScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(value) => {
          setScannerOpen(false)
          void addBarcodeToCart(value)
        }}
      />
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    productRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingVertical: 12 },
    productInfo: { flex: 1, gap: 4 },
    productName: { color: colors.text, fontSize: 15, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13 },
    addButton: { alignItems: 'center', backgroundColor: colors.accentSurface, borderRadius: 10, justifyContent: 'center', minHeight: 42, minWidth: 68 },
    addText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    stepper: { alignItems: 'center', flexDirection: 'row', gap: 11 },
    stepButton: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: 10, height: 40, justifyContent: 'center', width: 40 },
    stepText: { color: colors.text, fontSize: 21, fontWeight: '600' },
    count: { color: colors.text, fontSize: 16, fontWeight: '700', minWidth: 18, textAlign: 'center' },
    cartRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    cartName: { color: colors.text, flex: 1, fontSize: 14 },
    cartAmount: { color: colors.text, fontSize: 14, fontWeight: '600' },
    totalRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12 },
    totalLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
    totalAmount: { color: colors.text, fontSize: 20, fontWeight: '800' },
    change: { color: colors.success, fontSize: 14, fontWeight: '600' },
    error: { color: colors.danger, fontSize: 14 },
    success: { color: colors.success, fontSize: 14, fontWeight: '600' },
    empty: { gap: 14 },
    unknownBarcode: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingTop: 12 },
  })
}
