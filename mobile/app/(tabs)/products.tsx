import { useCallback, useEffect, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs, parseTzsAmount } from '@/src/domain/money'
import {
  createCategory,
  createProduct,
  deleteCategory,
  listCategories,
  listProducts,
  updateProduct,
  type Category,
  type LocalProduct,
} from '@/src/repositories/catalog'
import { listProductAuditEvents, type ProductAuditEvent } from '@/src/repositories/productAudit'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { formatNumber } from '@/src/i18n/format'

function parseWholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value.trim())
  return Number.isSafeInteger(number) ? number : null
}

export default function ProductsScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const { barcode: barcodeParam } = useLocalSearchParams<{ barcode?: string }>()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [products, setProducts] = useState<LocalProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [auditEvents, setAuditEvents] = useState<ProductAuditEvent[]>([])
  const [auditCategory, setAuditCategory] = useState('')
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<LocalProduct | null>(null)
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [newCategory, setNewCategory] = useState('')
  const [unitCode, setUnitCode] = useState('pcs')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('0')
  const [threshold, setThreshold] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof barcodeParam === 'string') setBarcode(barcodeParam)
  }, [barcodeParam])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      if (!current) {
        setProducts([])
        setCategories([])
        return
      }
      const [currentProducts, currentCategories, currentEvents] = await Promise.all([
        listProducts(database, current, search),
        listCategories(database, current),
        canReadAudit(database, current)
          ? listProductAuditEvents(database, current, auditCategory || undefined)
          : Promise.resolve([]),
      ])
      setProducts(currentProducts)
      setCategories(currentCategories)
      setAuditEvents(currentEvents)
    } finally {
      setLoading(false)
    }
  }, [auditCategory, database, search])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => {
      setError(localizeError(reason, 'products.loadError'))
    })
  }, [load, localizeError]))

  const chooseProduct = (product: LocalProduct) => {
    setSelectedProduct(product)
    setName(product.name)
    setSku(product.sku)
    setBarcode(product.barcode ?? '')
    setCategoryId(product.categoryId)
    setUnitCode(product.unitCode)
    setCost(String(product.costPriceMinor))
    setPrice(String(product.sellPriceMinor))
    setQuantity('0')
    setThreshold(String(product.lowStockThreshold))
    setError(null)
  }

  const clearForm = () => {
    setSelectedProduct(null)
    setName('')
    setSku('')
    setBarcode('')
    setCategoryId(null)
    setUnitCode('pcs')
    setCost('')
    setPrice('')
    setQuantity('0')
    setThreshold('0')
  }

  const save = async () => {
    if (!workspace) {
      setError(t('products.signInRequired'))
      return
    }
    const costPriceMinor = parseTzsAmount(cost)
    const sellPriceMinor = parseTzsAmount(price)
    const initialQuantity = parseWholeNumber(quantity)
    const lowStockThreshold = parseWholeNumber(threshold)
    if (costPriceMinor === null || sellPriceMinor === null || initialQuantity === null || lowStockThreshold === null) {
      setError(t('products.amountError'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const input = {
        name,
        sku,
        barcode: barcode.trim() || null,
        categoryId,
        unitCode,
        costPriceMinor,
        sellPriceMinor,
        initialQuantity: selectedProduct ? 0 : initialQuantity,
        lowStockThreshold,
      }
      if (selectedProduct) {
        await updateProduct(database, workspace, selectedProduct.productId, selectedProduct.variantId, input, () => Crypto.randomUUID())
      } else {
        await createProduct(database, workspace, input, () => Crypto.randomUUID())
      }
      clearForm()
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'products.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const addNewCategory = async () => {
    if (!workspace) return
    setSaving(true)
    setError(null)
    try {
      await createCategory(database, workspace, newCategory, () => Crypto.randomUUID())
      setNewCategory('')
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'products.categoryError'))
    } finally {
      setSaving(false)
    }
  }

  const removeCategory = async (category: Category) => {
    if (!workspace) return
    setSaving(true)
    setError(null)
    try {
      await deleteCategory(database, workspace, category.id)
      if (categoryId === category.id) setCategoryId(null)
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'products.deleteError'))
    } finally {
      setSaving(false)
    }
  }

  const confirmRemoveCategory = (category: Category) => {
    Alert.alert(
      t('common.deleteCategoryTitle'),
      t('common.deleteCategoryMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => void removeCategory(category) },
      ],
    )
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>

  return (
    <Screen>
      <PageTitle title={t('products.title')} subtitle={t('products.subtitle', { store: workspace?.storeName ?? t('products.selectedStore') })} />
      <Field label={t('products.search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
      <Card>
        <Text style={styles.sectionTitle}>{selectedProduct ? t('products.edit') : t('products.register')}</Text>
        <Field label={t('products.name')} value={name} onChangeText={setName} autoCapitalize="sentences" />
        <View style={styles.row}>
          <View style={styles.flex}><Field label={t('products.sku')} value={sku} onChangeText={setSku} autoCapitalize="characters" /></View>
          <View style={styles.flex}><Field label={t('products.barcode')} value={barcode} onChangeText={setBarcode} autoCapitalize="none" /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Field label={t('products.unit')} value={unitCode} onChangeText={setUnitCode} autoCapitalize="none" /></View>
          <View style={styles.flex}><Field label={t('products.lowStockAt')} value={threshold} onChangeText={setThreshold} keyboardType="number-pad" /></View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Field label={t('products.cost')} value={cost} onChangeText={setCost} keyboardType="number-pad" /></View>
          <View style={styles.flex}><Field label={t('products.price')} value={price} onChangeText={setPrice} keyboardType="number-pad" /></View>
        </View>
        {!selectedProduct ? (
          <Field label={t('products.openingStock')} value={quantity} onChangeText={setQuantity} keyboardType="number-pad" />
        ) : null}
        <Text style={styles.fieldLabel}>{t('products.category')}</Text>
        <View style={styles.categoryRow}>
          <Chip label={t('common.uncategorized')} selected={!categoryId} onPress={() => setCategoryId(null)} />
          {categories.map((category) => (
            <View key={category.id} style={styles.categoryChoice}>
              <Chip label={category.name} selected={categoryId === category.id} onPress={() => setCategoryId(category.id)} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('products.deleteCategory', { name: category.name })}
                onPress={() => confirmRemoveCategory(category)}
                disabled={saving}
              >
                <Text style={styles.deleteCategory}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={styles.row}>
          <View style={styles.flex}><Field label={t('products.newCategory')} value={newCategory} onChangeText={setNewCategory} /></View>
          <View style={styles.categoryButton}><Button label={t('products.addCategory')} onPress={() => void addNewCategory()} disabled={saving} /></View>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={saving ? t('products.saving') : selectedProduct ? t('products.saveChanges') : t('products.saveNew')} onPress={() => void save()} disabled={saving} />
        {selectedProduct ? <Button label={t('products.cancelEdit')} secondary onPress={clearForm} /> : null}
      </Card>
      <Text style={styles.listTitle}>{t('products.listCount', { count: formatNumber(products.length, language) })}</Text>
      {products.length === 0 ? (
        <Card><Text style={styles.muted}>{search ? t('products.noMatches') : t('products.none')}</Text></Card>
      ) : products.map((product) => (
        <Pressable key={product.variantId} accessibilityRole="button" onPress={() => chooseProduct(product)}>
          <Card style={styles.productCard}>
            <View style={styles.productHeader}>
              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.stock}>
                {product.trackStock ? `${formatNumber(product.quantity, language)} ${product.unitCode}` : t('common.notTracked')}
              </Text>
            </View>
            <Text style={styles.muted}>
              {product.sku}{product.barcode ? ` · ${product.barcode}` : ''} · {formatTzs(product.sellPriceMinor, language)}
            </Text>
            <Text style={styles.muted}>{product.categoryName ?? t('common.uncategorized')} · {t('products.editHint')}</Text>
          </Card>
        </Pressable>
      ))}
      <Card>
        <Text style={styles.sectionTitle}>{t('products.history')}</Text>
        <View style={styles.categoryRow}>
          <Chip label={t('products.allCategories')} selected={!auditCategory} onPress={() => setAuditCategory('')} />
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={auditCategory === category.name}
              onPress={() => setAuditCategory(auditCategory === category.name ? '' : category.name)}
            />
          ))}
        </View>
        {auditEvents.length === 0 ? <Text style={styles.muted}>{t('products.noHistory')}</Text> : auditEvents.map((event) => (
          <View key={event.id} style={styles.historyRow}>
            <View style={styles.flex}>
              <Text style={styles.productName}>{event.productName} · {t(`products.history.${event.eventType}`)}</Text>
              <Text style={styles.muted}>
                {event.categoryName || t('common.uncategorized')} · {event.sku ?? ''}
                {event.actorName ? ` · ${event.actorName}` : ''}
              </Text>
              {event.beforeJson ? <Text style={styles.muted}>{event.beforeJson}</Text> : null}
              <Text style={styles.muted}>{event.afterJson}</Text>
              <Text style={styles.muted}>{new Date(event.createdAt).toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ')}</Text>
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  )
}

async function canReadAudit(database: ReturnType<typeof useSQLiteContext>, workspace: Workspace): Promise<boolean> {
  if (workspace.role === 'owner') return true
  const permission = await database.getFirstAsync<{ allowed: number }>(
    `SELECT 1 AS allowed FROM user_store_permissions
     WHERE business_id = ? AND store_id = ? AND user_id = ?
       AND permission IN ('view_reports', 'manage_products', 'manage_inventory')
     LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
    workspace.userId,
  )
  return Boolean(permission)
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.selectedChip]}>
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>{label}</Text>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    row: { flexDirection: 'row', gap: 10 },
    flex: { flex: 1 },
    categoryButton: { justifyContent: 'flex-end', width: 76 },
    fieldLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
    categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    categoryChoice: { alignItems: 'center', flexDirection: 'row', gap: 2 },
    chip: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
    selectedChip: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    selectedChipText: { color: colors.accentPressed },
    deleteCategory: { color: colors.danger, fontSize: 21, paddingHorizontal: 4 },
    error: { color: colors.danger, fontSize: 14 },
    listTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 2 },
    productCard: { paddingVertical: 13 },
    productHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    productName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
    stock: { color: colors.text, fontSize: 14, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13 },
    historyRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingVertical: 10 },
  })
}
