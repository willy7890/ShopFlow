import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { parseTzsAmount, formatTzs } from '@/src/domain/money'
import {
  createCustomer,
  createSupplier,
  listCustomers,
  listSuppliers,
  recordCustomerPayment,
  recordSupplierBill,
  recordSupplierPayment,
  type CustomerAccount,
  type SupplierAccount,
} from '@/src/repositories/accounts'
import { getActiveWorkspace, type Permission, type Workspace } from '@/src/repositories/workspace'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

export default function AccountsScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [customers, setCustomers] = useState<CustomerAccount[]>([])
  const [suppliers, setSuppliers] = useState<SupplierAccount[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAmount, setCustomerAmount] = useState('')
  const [customerNote, setCustomerNote] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierAmount, setSupplierAmount] = useState('')
  const [supplierNote, setSupplierNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      if (!current) {
        setCustomers([])
        setSuppliers([])
        setPermissions([])
        return
      }
      const userPermissions = current.role === 'owner'
        ? ['sell', 'manage_inventory'] as Permission[]
        : (await database.getAllAsync<{ permission: Permission }>(
          `SELECT permission FROM user_store_permissions
           WHERE business_id = ? AND store_id = ? AND user_id = ?`,
          current.businessId,
          current.storeId,
          current.userId,
        )).map(({ permission }) => permission)
      setPermissions(userPermissions)
      const [nextCustomers, nextSuppliers] = await Promise.all([
        userPermissions.includes('sell') ? listCustomers(database, current) : Promise.resolve([]),
        userPermissions.includes('manage_inventory') ? listSuppliers(database, current) : Promise.resolve([]),
      ])
      setCustomers(nextCustomers)
      setSuppliers(nextSuppliers)
      setSelectedCustomerId((selected) => nextCustomers.some((item) => item.id === selected) ? selected : null)
      setSelectedSupplierId((selected) => nextSuppliers.some((item) => item.id === selected) ? selected : null)
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'accounts.loadError')))
  }, [load, localizeError]))

  const runAction = async (action: () => Promise<void>, successMessage: string) => {
    if (!workspace) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      setNotice(successMessage)
    } catch (reason) {
      setError(localizeError(reason, 'accounts.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const parsedCustomerAmount = parseTzsAmount(customerAmount)
  const parsedSupplierAmount = parseTzsAmount(supplierAmount)
  const canSell = permissions.includes('sell')
  const canManageInventory = permissions.includes('manage_inventory')

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('accounts.title')} /><Card><Text style={styles.muted}>{t('accounts.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('accounts.title')} subtitle={t('accounts.subtitle', { store: workspace.storeName })} />
      {canSell ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('accounts.debtors')}</Text>
          <Text style={styles.muted}>{t('accounts.customerHelp')}</Text>
          {customers.length === 0 ? <Text style={styles.muted}>{t('accounts.noCustomers')}</Text> : customers.map((customer) => (
            <Pressable
              key={customer.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCustomerId === customer.id }}
              onPress={() => setSelectedCustomerId((current) => current === customer.id ? null : customer.id)}
              style={[styles.accountRow, selectedCustomerId === customer.id && styles.selectedRow]}
            >
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{customer.name}</Text>
                {!!customer.phone && <Text style={styles.muted}>{customer.phone}</Text>}
              </View>
              <Text style={[styles.balance, customer.balanceMinor > 0 && styles.debt]}>
                {formatTzs(customer.balanceMinor, language)}
              </Text>
            </Pressable>
          ))}
          <Field label={t('accounts.customerName')} value={customerName} onChangeText={setCustomerName} />
          <Field label={t('accounts.phone')} value={customerPhone} onChangeText={setCustomerPhone} keyboardType="phone-pad" />
          <Button
            label={t('accounts.addCustomer')}
            secondary
            disabled={saving}
            onPress={() => void runAction(async () => {
              await createCustomer(database, workspace, { name: customerName, phone: customerPhone }, () => Crypto.randomUUID())
              setCustomerName('')
              setCustomerPhone('')
            }, t('accounts.customerAdded'))}
          />
          {selectedCustomerId ? (
            <>
              <Field label={t('accounts.collectAmount')} value={customerAmount} onChangeText={setCustomerAmount} keyboardType="number-pad" />
              <Field label={t('accounts.noteOptional')} value={customerNote} onChangeText={setCustomerNote} />
              <Button
                label={t('accounts.recordCollection')}
                disabled={saving || parsedCustomerAmount === null || parsedCustomerAmount <= 0}
                onPress={() => {
                  const amount = parsedCustomerAmount
                  if (amount === null || !selectedCustomerId) return
                  void runAction(async () => {
                    await recordCustomerPayment(database, workspace, selectedCustomerId, amount, customerNote, () => Crypto.randomUUID())
                    setCustomerAmount('')
                    setCustomerNote('')
                  }, t('accounts.collectionSaved'))
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}

      {canManageInventory ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('accounts.creditors')}</Text>
          <Text style={styles.muted}>{t('accounts.supplierHelp')}</Text>
          {suppliers.length === 0 ? <Text style={styles.muted}>{t('accounts.noSuppliers')}</Text> : suppliers.map((supplier) => (
            <Pressable
              key={supplier.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedSupplierId === supplier.id }}
              onPress={() => setSelectedSupplierId((current) => current === supplier.id ? null : supplier.id)}
              style={[styles.accountRow, selectedSupplierId === supplier.id && styles.selectedRow]}
            >
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{supplier.name}</Text>
                {!!supplier.phone && <Text style={styles.muted}>{supplier.phone}</Text>}
              </View>
              <Text style={[styles.balance, supplier.balanceMinor > 0 && styles.debt]}>
                {formatTzs(supplier.balanceMinor, language)}
              </Text>
            </Pressable>
          ))}
          <Field label={t('accounts.supplierName')} value={supplierName} onChangeText={setSupplierName} />
          <Field label={t('accounts.phone')} value={supplierPhone} onChangeText={setSupplierPhone} keyboardType="phone-pad" />
          <Button
            label={t('accounts.addSupplier')}
            secondary
            disabled={saving}
            onPress={() => void runAction(async () => {
              await createSupplier(database, workspace, { name: supplierName, phone: supplierPhone }, () => Crypto.randomUUID())
              setSupplierName('')
              setSupplierPhone('')
            }, t('accounts.supplierAdded'))}
          />
          {selectedSupplierId ? (
            <>
              <Field label={t('accounts.amount')} value={supplierAmount} onChangeText={setSupplierAmount} keyboardType="number-pad" />
              <Field label={t('accounts.noteOptional')} value={supplierNote} onChangeText={setSupplierNote} />
              <Button
                label={t('accounts.recordBill')}
                secondary
                disabled={saving || parsedSupplierAmount === null || parsedSupplierAmount <= 0}
                onPress={() => {
                  const amount = parsedSupplierAmount
                  if (amount === null || !selectedSupplierId) return
                  void runAction(async () => {
                    await recordSupplierBill(database, workspace, selectedSupplierId, amount, supplierNote, () => Crypto.randomUUID())
                    setSupplierAmount('')
                    setSupplierNote('')
                  }, t('accounts.billSaved'))
                }}
              />
              <Button
                label={t('accounts.recordSupplierPayment')}
                disabled={saving || parsedSupplierAmount === null || parsedSupplierAmount <= 0}
                onPress={() => {
                  const amount = parsedSupplierAmount
                  if (amount === null || !selectedSupplierId) return
                  void runAction(async () => {
                    await recordSupplierPayment(database, workspace, selectedSupplierId, amount, supplierNote, () => Crypto.randomUUID())
                    setSupplierAmount('')
                    setSupplierNote('')
                  }, t('accounts.paymentSaved'))
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    accountRow: { alignItems: 'center', borderColor: colors.border, borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', padding: 12 },
    selectedRow: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    accountInfo: { flex: 1, gap: 3 },
    accountName: { color: colors.text, fontSize: 15, fontWeight: '600' },
    balance: { color: colors.text, fontSize: 14, fontWeight: '700' },
    debt: { color: colors.danger },
    error: { color: colors.danger, fontSize: 14 },
    success: { color: colors.success, fontSize: 14, fontWeight: '600' },
  })
}
