import { useCallback, useEffect, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { Alert, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs, parseTzsAmount } from '@/src/domain/money'
import { buildProductQrHtml, generateProductQr, type ProductQr } from '@/src/domain/productQr'
import {
  createCategory,
  createProduct,
  deleteCategory,
  findProductByCode,
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
import type { TranslationKey } from '@/src/i18n/translations'
import { formatDateTime, formatNumber } from '@/src/i18n/format'
import { BarcodeScanner } from '@/src/components/BarcodeScanner'
import { productAuditAction, productAuditDetails } from '@/src/domain/productAuditPresentation'

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
  const [duplicateProduct, setDuplicateProduct] = useState<LocalProduct | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [qrProduct, setQrProduct] = useState<{ product: LocalProduct; qr: ProductQr } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [qrSharing, setQrSharing] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof barcodeParam === 'string') {
      setBarcode(barcodeParam)
      setSku((current) => current || barcodeParam)
    }
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
        setAuditEvents([])
        return
      }
      const hasAuditAccess = await canReadAudit(database, current)
      const [currentProducts, currentCategories, currentEvents] = await Promise.all([
        listProducts(database, current, search),
        listCategories(database, current),
        hasAuditAccess
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

  useEffect(() => {
    const code = barcode.trim()
    if (!workspace || !code) {
      setDuplicateProduct(null)
      return
    }
    let active = true
    const timeout = setTimeout(() => {
      void findProductByCode(database, workspace, code).then((product) => {
        if (!active) return
        setDuplicateProduct(
          product && product.productId !== selectedProduct?.productId ? product : null,
        )
      }).catch((reason: unknown) => {
        if (active) setError(localizeError(reason, 'products.codeLookupError'))
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(timeout)
    }
  }, [barcode, database, localizeError, selectedProduct?.productId, workspace])

  const chooseProduct = (product: LocalProduct) => {
    setSelectedProduct(product)
    setDuplicateProduct(null)
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
    setDuplicateProduct(null)
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
      const codeMatch = await Promise.all([
        findProductByCode(database, workspace, input.sku),
        input.barcode ? findProductByCode(database, workspace, input.barcode) : Promise.resolve(null),
      ])
      const duplicate = codeMatch.find(
        (product) => product && product.productId !== selectedProduct?.productId,
      )
      if (duplicate) {
        setDuplicateProduct(duplicate)
        setError(t('products.duplicateCode'))
        return
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

  const showQrCode = async (product: LocalProduct) => {
    setQrBusy(true)
    setError(null)
    try {
      setQrProduct({
        product,
        qr: generateProductQr(product.sku),
      })
    } catch (reason) {
      setError(localizeError(reason, 'products.qrError'))
    } finally {
      setQrBusy(false)
    }
  }

  const qrHtml = () => {
    if (!qrProduct) throw new Error(t('products.qrError'))
    return buildProductQrHtml({
      title: t('products.qrTitle'),
      productName: qrProduct.product.name,
      sku: qrProduct.product.sku,
      qr: qrProduct.qr,
    })
  }

  const printQrCode = async () => {
    setQrBusy(true)
    setError(null)
    try {
      await Print.printAsync({ html: qrHtml() })
    } catch (reason) {
      setError(localizeError(reason, 'products.qrError'))
    } finally {
      setQrBusy(false)
    }
  }

  const shareQrCode = async () => {
    setQrSharing(true)
    setError(null)
    try {
      const file = await Print.printToFileAsync({ html: qrHtml() })
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(t('products.qrShareUnavailable'))
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('products.qrShareTitle'),
        UTI: 'com.adobe.pdf',
      })
    } catch (reason) {
      setError(localizeError(reason, 'products.qrError'))
    } finally {
      setQrSharing(false)
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
        {!selectedProduct ? (
          <Button
            label={t('products.scanCode')}
            secondary
            onPress={() => setScannerOpen(true)}
            disabled={saving}
          />
        ) : null}
        {duplicateProduct ? (
          <Card style={styles.duplicateCard}>
            <Text style={styles.duplicateTitle}>{t('products.duplicateCode')}</Text>
            <Text style={styles.muted}>{t('products.duplicateDetails', {
              name: duplicateProduct.name,
              sku: duplicateProduct.sku,
              price: formatTzs(duplicateProduct.sellPriceMinor, language),
            })}</Text>
            <Button
              label={t('products.openExisting')}
              secondary
              onPress={() => chooseProduct(duplicateProduct)}
            />
          </Card>
        ) : null}
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
        <Button label={saving ? t('products.saving') : selectedProduct ? t('products.saveChanges') : t('products.saveNew')} onPress={() => void save()} disabled={saving || Boolean(duplicateProduct)} />
        {selectedProduct ? <Button label={t('products.cancelEdit')} secondary onPress={clearForm} /> : null}
      </Card>
      <Text style={styles.listTitle}>{t('products.listCount', { count: formatNumber(products.length, language) })}</Text>
      {products.length === 0 ? (
        <Card><Text style={styles.muted}>{search ? t('products.noMatches') : t('products.none')}</Text></Card>
      ) : products.map((product) => (
        <View key={product.variantId} style={styles.productRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => chooseProduct(product)}
            style={styles.productPressable}
          >
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
          <View style={styles.qrButton}>
            <Button
              label={t('products.qrShort')}
              secondary
              onPress={() => void showQrCode(product)}
              disabled={qrBusy}
            />
          </View>
        </View>
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
        {auditEvents.length === 0 ? <Text style={styles.muted}>{t('products.noHistory')}</Text> : auditEvents.map((event) => {
          const action = productAuditAction(event.eventType)
          const details = productAuditDetails(event, (value) => formatNumber(value, language))
          return (
            <View key={event.id} style={styles.historyRow}>
              <View style={styles.historyTimeline}>
                <View style={[styles.historyMarker, styles[`historyMarker_${action}`]]}>
                  <Text style={[styles.historyMarkerText, styles[`historyMarkerText_${action}`]]}>
                    {action === 'created' ? '+' : action === 'updated' ? '✎' : action === 'stock_adjusted' ? '↕' : action === 'deleted' ? '×' : '•'}
                  </Text>
                </View>
                <View style={styles.historyContent}>
                  <View style={styles.historyHeading}>
                    <Text style={styles.productName} numberOfLines={2}>{event.productName}</Text>
                    <View style={[styles.actionBadge, styles[`actionBadge_${action}`]]}>
                      <Text style={[styles.actionBadgeText, styles[`actionBadgeText_${action}`]]}>
                        {t(`products.history.${action}`)}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.muted}>
                    {t(`products.history.actor.${action}`, { name: event.actorName || t('products.history.unknownActor') })}
                  </Text>
                  {details.length === 0 ? (
                    <Text style={styles.muted}>{t('products.audit.detailsUnavailable')}</Text>
                  ) : (
                    <View style={styles.auditDetails}>
                      {details.map((detail) => (
                        <View key={detail.key} style={styles.auditDetailRow}>
                          <Text style={styles.auditDetailLabel}>{t(detail.labelKey as TranslationKey)}</Text>
                          <Text style={styles.auditDetailValue}>
                            {detail.previous !== undefined
                              ? `${detail.previous || t('common.uncategorized')} → `
                              : ''}
                            {detail.key === 'categoryName' && !detail.current
                              ? t('common.uncategorized')
                              : detail.current}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!details.some((detail) => detail.key === 'categoryName') ? (
                    <View style={styles.auditDetailRow}>
                      <Text style={styles.auditDetailLabel}>{t('products.audit.category')}</Text>
                      <Text style={styles.auditDetailValue}>{event.categoryName || t('common.uncategorized')}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.auditTimestamp}>{formatDateTime(event.createdAt, language)}</Text>
                </View>
              </View>
            </View>
          )
        })}
      </Card>
      <BarcodeScanner
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={(code) => {
          setBarcode(code)
          setSku((current) => current || code)
          setError(null)
          setScannerOpen(false)
        }}
        title={t('products.scanCode')}
        permissionMessage={t('products.cameraPermission')}
      />
      <Modal
        visible={Boolean(qrProduct)}
        animationType="slide"
        onRequestClose={() => setQrProduct(null)}
      >
        <SafeAreaView style={[styles.qrModal, { backgroundColor: colors.background }]}>
          <Text style={styles.qrTitle}>{t('products.qrTitle')}</Text>
          {qrProduct ? (
            <>
              <View
                accessibilityRole="image"
                accessibilityLabel={t('products.qrFor', { name: qrProduct.product.name })}
                style={styles.qrImage}
              >
                {Array.from({ length: qrProduct.qr.size }, (_, y) => (
                  <View key={`row-${y}`} style={styles.qrRow}>
                    {Array.from({ length: qrProduct.qr.size }, (_, x) => (
                      <View
                        key={`module-${x}`}
                        style={[
                          styles.qrModule,
                          { backgroundColor: qrProduct.qr.modules[y * qrProduct.qr.size + x] ? '#17191C' : '#FFFFFF' },
                        ]}
                      />
                    ))}
                  </View>
                ))}
              </View>
              <Text style={styles.qrProductName}>{qrProduct.product.name}</Text>
              <Text style={styles.muted}>{t('products.qrCodeLabel', { code: qrProduct.product.sku })}</Text>
            </>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label={t('products.printQr')} onPress={() => void printQrCode()} disabled={qrBusy || qrSharing} />
          <Button label={qrSharing ? t('products.qrSharing') : t('products.shareQr')} secondary onPress={() => void shareQrCode()} disabled={qrBusy || qrSharing} />
          <Button label={t('common.cancel')} secondary onPress={() => setQrProduct(null)} />
        </SafeAreaView>
      </Modal>
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
    productRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
    productPressable: { flex: 1 },
    qrButton: { width: 76 },
    productHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
    productName: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
    stock: { color: colors.text, fontSize: 14, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13 },
    historyRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingVertical: 12 },
    historyTimeline: { flexDirection: 'row', gap: 11 },
    historyMarker: { alignItems: 'center', borderRadius: 16, borderWidth: 1, height: 30, justifyContent: 'center', marginTop: 1, width: 30 },
    historyMarker_created: { backgroundColor: colors.success + '18', borderColor: colors.success + '66' },
    historyMarker_updated: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder },
    historyMarker_stock_adjusted: { backgroundColor: colors.danger + '18', borderColor: colors.danger + '66' },
    historyMarker_deleted: { backgroundColor: colors.danger + '18', borderColor: colors.danger + '66' },
    historyMarker_unknown: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
    historyMarkerText: { fontSize: 16, fontWeight: '800' },
    historyMarkerText_created: { color: colors.success },
    historyMarkerText_updated: { color: colors.accentPressed },
    historyMarkerText_stock_adjusted: { color: colors.danger },
    historyMarkerText_deleted: { color: colors.danger },
    historyMarkerText_unknown: { color: colors.muted },
    historyContent: { flex: 1, gap: 5 },
    historyHeading: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'space-between' },
    actionBadge: { alignSelf: 'flex-start', borderRadius: 99, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
    actionBadge_created: { backgroundColor: colors.success + '18', borderColor: colors.success + '66' },
    actionBadge_updated: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder },
    actionBadge_stock_adjusted: { backgroundColor: colors.danger + '18', borderColor: colors.danger + '66' },
    actionBadge_deleted: { backgroundColor: colors.danger + '18', borderColor: colors.danger + '66' },
    actionBadge_unknown: { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
    actionBadgeText: { fontSize: 11, fontWeight: '700' },
    actionBadgeText_created: { color: colors.success },
    actionBadgeText_updated: { color: colors.accentPressed },
    actionBadgeText_stock_adjusted: { color: colors.danger },
    actionBadgeText_deleted: { color: colors.danger },
    actionBadgeText_unknown: { color: colors.muted },
    auditDetails: { gap: 4, paddingTop: 3 },
    auditDetailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    auditDetailLabel: { color: colors.muted, fontSize: 12 },
    auditDetailValue: { color: colors.text, flexShrink: 1, fontSize: 12, fontWeight: '600' },
    auditTimestamp: { color: colors.muted, fontSize: 11, paddingTop: 3 },
    duplicateCard: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder },
    duplicateTitle: { color: colors.accentText, fontSize: 15, fontWeight: '700' },
    qrModal: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center', padding: 24 },
    qrTitle: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
    qrImage: { backgroundColor: '#FFFFFF', height: 280, maxWidth: 320, padding: 18, width: '100%' },
    qrRow: { flex: 1, flexDirection: 'row' },
    qrModule: { flex: 1 },
    qrProductName: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  })
}
