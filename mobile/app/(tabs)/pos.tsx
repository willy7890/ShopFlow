import { useCallback, useMemo, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useAudioPlayer } from 'expo-audio'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { BarcodeScanner } from '@/src/components/BarcodeScanner'
import { formatTzs, multiplyMoney, parseTzsAmount } from '@/src/domain/money'
import { listCustomers, type CustomerAccount } from '@/src/repositories/accounts'
import { createCashSale } from '@/src/repositories/sales'
import { findProductByBarcode, listProducts, type LocalProduct } from '@/src/repositories/catalog'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { formatNumber } from '@/src/i18n/format'

export default function PosScreen() {
  const scanSuccessPlayer = useAudioPlayer(require('../../assets/sounds/scan-success.wav'))
  const scanErrorPlayer = useAudioPlayer(require('../../assets/sounds/scan-error.wav'))
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const router = useRouter()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [customers, setCustomers] = useState<CustomerAccount[]>([])
  const [canSell, setCanSell] = useState(false)
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [cart, setCart] = useState<Record<string, number>>({})
  const [cashTendered, setCashTendered] = useState('')
  const [barcode, setBarcode] = useState('')
  const [unknownBarcode, setUnknownBarcode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerSoundEnabled, setScannerSoundEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      const soundSetting = await database.getFirstAsync<{ setting_value: string }>(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'scanner_sound_enabled'",
      )
      setScannerSoundEnabled(soundSetting?.setting_value !== 'false')
      const allowedToSell = current
        ? current.role === 'owner' || Boolean(await database.getFirstAsync<{ allowed: number }>(
          `SELECT 1 AS allowed FROM user_store_permissions
           WHERE business_id = ? AND store_id = ? AND user_id = ? AND permission = 'sell'`,
          current.businessId,
          current.storeId,
          current.userId,
        ))
        : false
      const [availableProducts, availableCustomers] = current
        ? await Promise.all([
          listProducts(database, current),
          allowedToSell ? listCustomers(database, current) : Promise.resolve([]),
        ])
        : [[], []]
      setCanSell(allowedToSell)
      setProducts(availableProducts)
      setCustomers(availableCustomers)
      setCustomerId((selectedId) => availableCustomers.some((customer) => customer.id === selectedId) ? selectedId : null)
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
  const tenderedMinor = parseTzsAmount(cashTendered)

  const changeQuantity = (product: LocalProduct, increment: number): boolean => {
    const current = cart[product.variantId] ?? 0
    const next = Math.max(0, current + increment)
    if (product.trackStock && next > product.quantity) {
      setError(t('pos.stockShort', { name: product.name, count: formatNumber(product.quantity, language) }))
      return false
    }
    setError(null)
    setReceipt(null)
    setCart((items) => ({ ...items, [product.variantId]: next }))
    const nextTotal = selected.reduce(
      (sum, item) => sum + multiplyMoney(item.sellPriceMinor, item.variantId === product.variantId ? next : cart[item.variantId] ?? 0),
      0,
    ) + (selected.some((item) => item.variantId === product.variantId) ? 0 : multiplyMoney(product.sellPriceMinor, next))
    setCashTendered(String(nextTotal))
    return true
  }

  const addBarcodeToCart = async (value: string): Promise<'added' | 'unknown' | 'error' | 'ignored'> => {
    const scannedBarcode = value.trim()
    setBarcode('')
    if (!scannedBarcode) return 'ignored'
    if (!workspace) {
      setError(t('pos.setupRequired'))
      return 'error'
    }
    setError(null)
    try {
      const product = await findProductByBarcode(database, workspace, scannedBarcode)
      if (!product) {
        setUnknownBarcode(scannedBarcode)
        return 'unknown'
      }
      setUnknownBarcode('')
      return changeQuantity(product, 1) ? 'added' : 'error'
    } catch (reason) {
      setError(localizeError(reason, 'pos.barcodeLookupError'))
      return 'error'
    }
  }

  const playScanFeedback = async (result: 'added' | 'unknown' | 'error' | 'ignored') => {
    if (!scannerSoundEnabled || result === 'ignored') return
    const player = result === 'added' ? scanSuccessPlayer : scanErrorPlayer
    try {
      await player.seekTo(0)
      player.play()
    } catch (reason) {
      setError(localizeError(reason, 'pos.scanSoundError'))
    }
  }

  const handleBarcodeInput = async (value: string) => {
    await playScanFeedback(await addBarcodeToCart(value))
  }

  const toggleScannerSound = async () => {
    const nextEnabled = !scannerSoundEnabled
    try {
      await database.runAsync(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES ('scanner_sound_enabled', ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        String(nextEnabled),
      )
      setScannerSoundEnabled(nextEnabled)
    } catch (reason) {
      setError(localizeError(reason, 'pos.scanSoundSettingsError'))
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
        ...(customerId ? { customerId } : {}),
      }, () => Crypto.randomUUID())
      setReceipt(result.balanceDueMinor > 0
        ? t('pos.creditSaleSaved', {
          number: result.saleNumber,
          total: formatTzs(result.totalMinor, language),
          paid: formatTzs(result.totalMinor - result.balanceDueMinor, language),
          due: formatTzs(result.balanceDueMinor, language),
        })
        : t('pos.saleSaved', {
          number: result.saleNumber,
          total: formatTzs(result.totalMinor, language),
          change: formatTzs(result.changeMinor, language),
        }))
      setCart({})
      setCashTendered('')
      setCustomerId(null)
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
          onSubmitEditing={() => void handleBarcodeInput(barcode)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button label={t('pos.addBarcode')} secondary onPress={() => void handleBarcodeInput(barcode)} disabled={!barcode.trim()} />
        <Button label={t('pos.openScanner')} onPress={() => setScannerOpen(true)} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: scannerSoundEnabled }}
          onPress={() => void toggleScannerSound()}
          style={styles.soundToggle}
        >
          <Text style={styles.soundToggleText}>
            {t(scannerSoundEnabled ? 'pos.scanSoundOn' : 'pos.scanSoundOff')}
          </Text>
        </Pressable>
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
        {canSell ? (
        <>
        <Text style={styles.fieldLabel}>{t('pos.customer')}</Text>
        <View style={styles.customerChoices}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: customerId === null }}
            onPress={() => setCustomerId(null)}
            style={[styles.customerChoice, customerId === null && styles.customerSelected]}
          >
            <Text style={styles.customerChoiceText}>{t('pos.cashSale')}</Text>
          </Pressable>
          {customers.map((customer) => (
            <Pressable
              key={customer.id}
              accessibilityRole="button"
              accessibilityState={{ selected: customerId === customer.id }}
              onPress={() => setCustomerId((current) => current === customer.id ? null : customer.id)}
              style={[styles.customerChoice, customerId === customer.id && styles.customerSelected]}
            >
              <Text style={styles.customerChoiceText}>{customer.name}</Text>
            </Pressable>
          ))}
          {customers.length === 0 ? (
            <Button label={t('accounts.addCustomer')} secondary onPress={() => router.push('/accounts')} />
          ) : null}
        </View>
        </>
        ) : null}
        <Field label={t('pos.cashReceived')} value={cashTendered} onChangeText={setCashTendered} keyboardType="number-pad" />
        {tenderedMinor !== null && tenderedMinor >= totalMinor && totalMinor > 0 ? (
          <Text style={styles.change}>{t('pos.change', { amount: formatTzs(tenderedMinor - totalMinor, language) })}</Text>
        ) : null}
        {customerId && tenderedMinor !== null && tenderedMinor < totalMinor && totalMinor > 0 ? (
          <Text style={styles.due}>{t('pos.creditDue', { amount: formatTzs(totalMinor - tenderedMinor, language) })}</Text>
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
          void handleBarcodeInput(value)
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
    fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
    customerChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    customerChoice: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
    customerSelected: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    customerChoiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    change: { color: colors.success, fontSize: 14, fontWeight: '600' },
    due: { color: colors.danger, fontSize: 14, fontWeight: '600' },
    error: { color: colors.danger, fontSize: 14 },
    success: { color: colors.success, fontSize: 14, fontWeight: '600' },
    empty: { gap: 14 },
    unknownBarcode: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingTop: 12 },
    soundToggle: { alignSelf: 'flex-end', minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
    soundToggleText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  })
}
