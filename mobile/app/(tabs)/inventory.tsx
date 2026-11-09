import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { listProducts, type LocalProduct } from '@/src/repositories/catalog'
import { adjustStock, listRecentMovements, type StockMovement } from '@/src/repositories/inventory'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { formatDateTime, formatNumber } from '@/src/i18n/format'

export default function InventoryScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [selectedProduct, setSelectedProduct] = useState<LocalProduct | null>(null)
  const [quantityDelta, setQuantityDelta] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const current: Workspace | null = await getActiveWorkspace(database)
      setWorkspace(current)
      if (!current) {
        setProducts([])
        setMovements([])
        return
      }
      const [currentProducts, currentMovements] = await Promise.all([
        listProducts(database, current),
        listRecentMovements(database, current),
      ])
      setProducts(currentProducts)
      setMovements(currentMovements)
      setError(null)
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => {
      setError(localizeError(reason, 'inventory.loadError'))
    })
  }, [load, localizeError]))

  const saveAdjustment = async () => {
    if (!workspace || !selectedProduct) {
      setError(t('inventory.selectProductError'))
      return
    }
    const normalized = quantityDelta.trim()
    if (!/^-?\d+$/.test(normalized)) {
      setError(t('inventory.wholeQuantityError'))
      return
    }
    const delta = Number(normalized)
    if (!Number.isSafeInteger(delta) || delta === 0) {
      setError(t('inventory.invalidQuantityError'))
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await adjustStock(database, workspace, {
        variantId: selectedProduct.variantId,
        quantityDelta: delta,
        reason,
      }, () => Crypto.randomUUID())
      setQuantityDelta('')
      setReason('')
      setSelectedProduct(null)
      setMessage(t(delta > 0 ? 'inventory.changeAdded' : 'inventory.changeReduced'))
      await load()
    } catch (reasonValue) {
      setError(localizeError(reasonValue, 'inventory.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const trackedProducts = products.filter((product) => product.trackStock)
  const outOfStock = trackedProducts.filter((product) => product.quantity === 0)
  const lowStock = trackedProducts.filter(
    (product) => product.quantity > 0 && product.quantity <= product.lowStockThreshold,
  )

  const movementLabel = (movement: StockMovement['movementType']) => {
    const known = ['opening', 'sale', 'purchase', 'adjustment', 'return'] as const
    return known.includes(movement as typeof known[number])
      ? t(`inventory.movement.${movement as typeof known[number]}`)
      : movement
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>

  return (
    <Screen>
      <PageTitle title={t('inventory.title')} subtitle={t('inventory.subtitle', { store: workspace ? ` · ${workspace.storeName}` : '' })} />
      {error ? <Card><Text style={styles.error}>{error}</Text></Card> : null}
      {message ? <Card><Text style={styles.success}>{message}</Text></Card> : null}
      <Card>
        <Text style={styles.sectionTitle}>{t('inventory.alerts')}</Text>
        <Text style={styles.alert}>{t('inventory.outOfStock', { count: formatNumber(outOfStock.length, language) })}</Text>
        <Text style={styles.alert}>{t('inventory.lowStock', { count: formatNumber(lowStock.length, language) })}</Text>
        <Text style={styles.muted}>{t('inventory.trackedCount', { count: formatNumber(trackedProducts.length, language) })}</Text>
      </Card>
      <Card>
        <Text style={styles.sectionTitle}>{t('inventory.recordChange')}</Text>
        <Text style={styles.muted}>{t('inventory.instructions')}</Text>
        {trackedProducts.length === 0 ? (
          <Text style={styles.muted}>{t('inventory.noTracked')}</Text>
        ) : trackedProducts.map((product) => (
          <Pressable key={product.variantId} onPress={() => setSelectedProduct(product)}
            accessibilityRole="button" accessibilityState={{ selected: selectedProduct?.variantId === product.variantId }}>
            <View style={[styles.selector, selectedProduct?.variantId === product.variantId && styles.selectedSelector]}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.muted}>{product.sku} · {formatNumber(product.quantity, language)} {product.unitCode}</Text>
            </View>
          </Pressable>
        ))}
        {selectedProduct ? (
          <>
            <Text style={styles.selectedTitle}>{t('inventory.selected', { name: selectedProduct.name })}</Text>
            <Field label={t('inventory.quantityChange')} value={quantityDelta} onChangeText={setQuantityDelta} keyboardType="numbers-and-punctuation" />
            <Field label={t('inventory.reason')} value={reason} onChangeText={setReason} autoCapitalize="sentences" />
            <Button label={saving ? t('inventory.saving') : t('inventory.saveChange')} onPress={() => void saveAdjustment()} disabled={saving} />
            <Button label={t('inventory.cancelSelection')} secondary onPress={() => setSelectedProduct(null)} />
          </>
        ) : null}
      </Card>
      <Text style={styles.sectionTitle}>{t('inventory.currentStock')}</Text>
      {products.length === 0 ? (
        <Card><Text style={styles.muted}>{t('inventory.noProducts')}</Text></Card>
      ) : products.map((product) => (
        <Card key={product.variantId} style={styles.rowCard}>
          <View style={styles.row}>
            <View style={styles.product}>
              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.muted}>{product.sku}</Text>
            </View>
            {!product.trackStock ? (
              <Text style={styles.muted}>{t('inventory.notTracked')}</Text>
            ) : (
              <Text style={[
                styles.quantity,
                product.quantity === 0 && styles.low,
                product.quantity > 0 && product.quantity <= product.lowStockThreshold && styles.low,
              ]}>
                {formatNumber(product.quantity, language)} {product.unitCode}
              </Text>
            )}
          </View>
        </Card>
      ))}
      <Text style={styles.sectionTitle}>{t('inventory.movements')}</Text>
      {movements.length === 0 ? (
        <Card><Text style={styles.muted}>{t('inventory.noMovements')}</Text></Card>
      ) : movements.map((movement) => (
        <Card key={movement.id} style={styles.movementCard}>
          <View style={styles.row}>
            <View style={styles.product}>
              <Text style={styles.name}>{movement.productName}</Text>
              <Text style={styles.muted}>
                {movementLabel(movement.movementType)} · {formatDateTime(movement.createdAt, language)}
              </Text>
              {movement.reason ? <Text style={styles.muted}>{movement.reason}</Text> : null}
            </View>
            <Text style={[styles.quantity, movement.quantityDelta < 0 && styles.low]}>
              {movement.quantityDelta > 0 ? '+' : ''}{formatNumber(movement.quantityDelta, language)}
            </Text>
          </View>
        </Card>
      ))}
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    rowCard: { paddingVertical: 13 },
    movementCard: { paddingVertical: 13 },
    row: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    product: { flex: 1, gap: 4 },
    name: { color: colors.text, fontSize: 15, fontWeight: '600' },
    quantity: { color: colors.text, fontSize: 15, fontWeight: '700' },
    low: { color: colors.danger },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    alert: { color: colors.danger, fontSize: 14, fontWeight: '600' },
    selectedTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
    selector: { borderColor: colors.border, borderRadius: 10, borderWidth: 1, gap: 3, marginTop: 6, padding: 11 },
    selectedSelector: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    error: { color: colors.danger },
    success: { color: colors.success },
  })
}
