import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { parseTzsAmount, formatTzs } from '@/src/domain/money'
import {
  createCustomer,
  createSupplier,
  listCustomers,
  listCustomerLedgerEntries,
  listSuppliers,
  listSupplierLedgerEntries,
  recordCustomerPayment,
  recordSupplierBill,
  recordSupplierPayment,
  setCustomerArchived,
  setSupplierArchived,
  updateCustomer,
  updateSupplier,
  type CustomerAccount,
  type AccountLedgerEntry,
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
  const [customerEntries, setCustomerEntries] = useState<AccountLedgerEntry[]>([])
  const [supplierEntries, setSupplierEntries] = useState<AccountLedgerEntry[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [customersWithBalanceOnly, setCustomersWithBalanceOnly] = useState(false)
  const [suppliersWithBalanceOnly, setSuppliersWithBalanceOnly] = useState(false)
  const [includeArchivedCustomers, setIncludeArchivedCustomers] = useState(false)
  const [includeArchivedSuppliers, setIncludeArchivedSuppliers] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState(false)
  const [customerEditName, setCustomerEditName] = useState('')
  const [customerEditPhone, setCustomerEditPhone] = useState('')
  const [supplierEditName, setSupplierEditName] = useState('')
  const [supplierEditPhone, setSupplierEditPhone] = useState('')
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
        ? ['sell', 'manage_inventory', 'manage_customers', 'manage_suppliers'] as Permission[]
        : (await database.getAllAsync<{ permission: Permission }>(
          `SELECT permission FROM user_store_permissions
           WHERE business_id = ? AND store_id = ? AND user_id = ?`,
          current.businessId,
          current.storeId,
          current.userId,
        )).map(({ permission }) => permission)
      setPermissions(userPermissions)
      const [nextCustomers, nextSuppliers] = await Promise.all([
        userPermissions.includes('sell') || userPermissions.includes('manage_customers')
          ? listCustomers(database, current, includeArchivedCustomers)
          : Promise.resolve([]),
        userPermissions.includes('manage_inventory') || userPermissions.includes('manage_suppliers')
          ? listSuppliers(database, current, includeArchivedSuppliers)
          : Promise.resolve([]),
      ])
      setCustomers(nextCustomers)
      setSuppliers(nextSuppliers)
      setSelectedCustomerId((selected) => nextCustomers.some((item) => item.id === selected) ? selected : null)
      setSelectedSupplierId((selected) => nextSuppliers.some((item) => item.id === selected) ? selected : null)
    } finally {
      setLoading(false)
    }
  }, [database, includeArchivedCustomers, includeArchivedSuppliers])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'accounts.loadError')))
  }, [load, localizeError]))

  useEffect(() => {
    if (!workspace || !selectedCustomerId) {
      setCustomerEntries([])
      return
    }
    let active = true
    void listCustomerLedgerEntries(database, workspace, selectedCustomerId)
      .then((entries) => { if (active) setCustomerEntries(entries) })
      .catch((reason: unknown) => {
        if (active) setError(localizeError(reason, 'accounts.loadError'))
      })
    return () => { active = false }
  }, [database, localizeError, selectedCustomerId, workspace])

  useEffect(() => {
    if (!workspace || !selectedSupplierId) {
      setSupplierEntries([])
      return
    }
    let active = true
    void listSupplierLedgerEntries(database, workspace, selectedSupplierId)
      .then((entries) => { if (active) setSupplierEntries(entries) })
      .catch((reason: unknown) => {
        if (active) setError(localizeError(reason, 'accounts.loadError'))
      })
    return () => { active = false }
  }, [database, localizeError, selectedSupplierId, workspace])

  const filteredCustomers = useMemo(() => customers.filter((customer) => {
    const matchesSearch = `${customer.name} ${customer.phone}`.toLocaleLowerCase().includes(customerSearch.trim().toLocaleLowerCase())
    return matchesSearch && (!customersWithBalanceOnly || customer.balanceMinor > 0)
  }), [customerSearch, customers, customersWithBalanceOnly])
  const filteredSuppliers = useMemo(() => suppliers.filter((supplier) => {
    const matchesSearch = `${supplier.name} ${supplier.phone}`.toLocaleLowerCase().includes(supplierSearch.trim().toLocaleLowerCase())
    return matchesSearch && (!suppliersWithBalanceOnly || supplier.balanceMinor > 0)
  }), [supplierSearch, suppliers, suppliersWithBalanceOnly])

  const runAction = async (action: () => Promise<void>, successMessage: string): Promise<boolean> => {
    if (!workspace) return false
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      await load()
      setNotice(successMessage)
      return true
    } catch (reason) {
      setError(localizeError(reason, 'accounts.saveError'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const parsedCustomerAmount = parseTzsAmount(customerAmount)
  const parsedSupplierAmount = parseTzsAmount(supplierAmount)
  const selectedCustomer = customers.find(({ id }) => id === selectedCustomerId)
  const selectedSupplier = suppliers.find(({ id }) => id === selectedSupplierId)
  const canManageCustomers = permissions.includes('sell') || permissions.includes('manage_customers')
  const canManageSuppliers = permissions.includes('manage_inventory') || permissions.includes('manage_suppliers')

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('accounts.title')} /><Card><Text style={styles.muted}>{t('accounts.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('accounts.title')} subtitle={t('accounts.subtitle', { store: workspace.storeName })} />
      {canManageCustomers ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('accounts.debtors')}</Text>
          <Text style={styles.muted}>{t('accounts.customerHelp')}</Text>
          <Field label={t('accounts.search')} value={customerSearch} onChangeText={setCustomerSearch} autoCapitalize="none" />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: customersWithBalanceOnly }}
            onPress={() => setCustomersWithBalanceOnly((current) => !current)}
            style={styles.balanceFilter}
          >
            <Text style={styles.filterText}>{t(customersWithBalanceOnly ? 'accounts.showAll' : 'accounts.showOutstanding')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: includeArchivedCustomers }}
            onPress={() => setIncludeArchivedCustomers((current) => !current)}
            style={styles.balanceFilter}
          >
            <Text style={styles.filterText}>{t(includeArchivedCustomers ? 'accounts.hideArchived' : 'accounts.showArchived')}</Text>
          </Pressable>
          {filteredCustomers.length === 0
            ? <Text style={styles.muted}>{customers.length === 0 ? t('accounts.noCustomers') : t('accounts.noMatches')}</Text>
            : filteredCustomers.map((customer) => (
            <Pressable
              key={customer.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCustomerId === customer.id }}
              onPress={() => setSelectedCustomerId((current) => current === customer.id ? null : customer.id)}
              style={[styles.accountRow, selectedCustomerId === customer.id && styles.selectedRow]}
            >
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{customer.name}{customer.isActive ? '' : ` · ${t('accounts.archived')}`}</Text>
                {!!customer.phone && <Text style={styles.muted}>{customer.phone}</Text>}
              </View>
              <Text style={[styles.balance, customer.balanceMinor > 0 && styles.debt]}>
                {formatTzs(customer.balanceMinor, language)}
              </Text>
            </Pressable>
          ))}
          {selectedCustomerId ? (
            <View style={styles.history}>
              <Text style={styles.historyTitle}>{t('accounts.statement')}</Text>
              {customerEntries.length === 0 ? <Text style={styles.muted}>{t('accounts.noEntries')}</Text> : customerEntries.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={styles.accountInfo}>
                    <Text style={styles.accountName}>{t(entry.entryType === 'debt' ? 'accounts.debtEntry' : 'accounts.paymentEntry')}</Text>
                    <Text style={styles.muted}>
                      {new Date(entry.createdAt).toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ')}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.balance, entry.entryType === 'debt' && styles.debt]}>
                    {entry.entryType === 'debt' ? '+' : '−'}{formatTzs(entry.amountMinor, language)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
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
              {selectedCustomer ? (
                <>
                  <Button
                    label={t(editingCustomer ? 'accounts.cancelEdit' : 'accounts.edit')}
                    secondary
                    onPress={() => {
                      setEditingCustomer((current) => !current)
                      setCustomerEditName(selectedCustomer.name)
                      setCustomerEditPhone(selectedCustomer.phone)
                    }}
                  />
                  {editingCustomer && selectedCustomer.isActive ? (
                    <>
                      <Field label={t('accounts.customerName')} value={customerEditName} onChangeText={setCustomerEditName} />
                      <Field label={t('accounts.phone')} value={customerEditPhone} onChangeText={setCustomerEditPhone} keyboardType="phone-pad" />
                      <Button
                        label={t('accounts.saveEdit')}
                        disabled={saving}
                        onPress={() => void runAction(
                          () => updateCustomer(database, workspace, selectedCustomer.id, { name: customerEditName, phone: customerEditPhone }, () => Crypto.randomUUID()),
                          t('accounts.updated'),
                        ).then((saved) => { if (saved) setEditingCustomer(false) })}
                      />
                    </>
                  ) : null}
                  <Button
                    label={t(selectedCustomer.isActive ? 'accounts.archive' : 'accounts.restore')}
                    secondary
                    disabled={saving}
                    onPress={() => Alert.alert(
                      t(selectedCustomer.isActive ? 'accounts.archiveTitle' : 'accounts.restoreTitle'),
                      t('accounts.archiveMessage'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t(selectedCustomer.isActive ? 'accounts.archive' : 'accounts.restore'),
                          style: selectedCustomer.isActive ? 'destructive' : 'default',
                          onPress: () => void runAction(
                            () => setCustomerArchived(database, workspace, selectedCustomer.id, Boolean(selectedCustomer.isActive), () => Crypto.randomUUID()),
                            t(selectedCustomer.isActive ? 'accounts.archivedNotice' : 'accounts.restoredNotice'),
                          ),
                        },
                      ],
                    )}
                  />
                </>
              ) : null}
              {selectedCustomer?.isActive ? (
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
            </>
          ) : null}
        </Card>
      ) : null}

      {canManageSuppliers ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('accounts.creditors')}</Text>
          <Text style={styles.muted}>{t('accounts.supplierHelp')}</Text>
          <Field label={t('accounts.search')} value={supplierSearch} onChangeText={setSupplierSearch} autoCapitalize="none" />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: suppliersWithBalanceOnly }}
            onPress={() => setSuppliersWithBalanceOnly((current) => !current)}
            style={styles.balanceFilter}
          >
            <Text style={styles.filterText}>{t(suppliersWithBalanceOnly ? 'accounts.showAll' : 'accounts.showOutstanding')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: includeArchivedSuppliers }}
            onPress={() => setIncludeArchivedSuppliers((current) => !current)}
            style={styles.balanceFilter}
          >
            <Text style={styles.filterText}>{t(includeArchivedSuppliers ? 'accounts.hideArchived' : 'accounts.showArchived')}</Text>
          </Pressable>
          {filteredSuppliers.length === 0
            ? <Text style={styles.muted}>{suppliers.length === 0 ? t('accounts.noSuppliers') : t('accounts.noMatches')}</Text>
            : filteredSuppliers.map((supplier) => (
            <Pressable
              key={supplier.id}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedSupplierId === supplier.id }}
              onPress={() => setSelectedSupplierId((current) => current === supplier.id ? null : supplier.id)}
              style={[styles.accountRow, selectedSupplierId === supplier.id && styles.selectedRow]}
            >
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{supplier.name}{supplier.isActive ? '' : ` · ${t('accounts.archived')}`}</Text>
                {!!supplier.phone && <Text style={styles.muted}>{supplier.phone}</Text>}
              </View>
              <Text style={[styles.balance, supplier.balanceMinor > 0 && styles.debt]}>
                {formatTzs(supplier.balanceMinor, language)}
              </Text>
            </Pressable>
          ))}
          {selectedSupplierId ? (
            <View style={styles.history}>
              <Text style={styles.historyTitle}>{t('accounts.statement')}</Text>
              {supplierEntries.length === 0 ? <Text style={styles.muted}>{t('accounts.noEntries')}</Text> : supplierEntries.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <View style={styles.accountInfo}>
                    <Text style={styles.accountName}>{t(entry.entryType === 'bill' ? 'accounts.billEntry' : 'accounts.paymentEntry')}</Text>
                    <Text style={styles.muted}>
                      {new Date(entry.createdAt).toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ')}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.balance, entry.entryType === 'bill' && styles.debt]}>
                    {entry.entryType === 'bill' ? '+' : '−'}{formatTzs(entry.amountMinor, language)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
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
              {selectedSupplier ? (
                <>
                  <Button
                    label={t(editingSupplier ? 'accounts.cancelEdit' : 'accounts.edit')}
                    secondary
                    onPress={() => {
                      setEditingSupplier((current) => !current)
                      setSupplierEditName(selectedSupplier.name)
                      setSupplierEditPhone(selectedSupplier.phone)
                    }}
                  />
                  {editingSupplier && selectedSupplier.isActive ? (
                    <>
                      <Field label={t('accounts.supplierName')} value={supplierEditName} onChangeText={setSupplierEditName} />
                      <Field label={t('accounts.phone')} value={supplierEditPhone} onChangeText={setSupplierEditPhone} keyboardType="phone-pad" />
                      <Button
                        label={t('accounts.saveEdit')}
                        disabled={saving}
                        onPress={() => void runAction(
                          () => updateSupplier(database, workspace, selectedSupplier.id, { name: supplierEditName, phone: supplierEditPhone }, () => Crypto.randomUUID()),
                          t('accounts.updated'),
                        ).then((saved) => { if (saved) setEditingSupplier(false) })}
                      />
                    </>
                  ) : null}
                  <Button
                    label={t(selectedSupplier.isActive ? 'accounts.archive' : 'accounts.restore')}
                    secondary
                    disabled={saving}
                    onPress={() => Alert.alert(
                      t(selectedSupplier.isActive ? 'accounts.archiveTitle' : 'accounts.restoreTitle'),
                      t('accounts.archiveMessage'),
                      [
                        { text: t('common.cancel'), style: 'cancel' },
                        {
                          text: t(selectedSupplier.isActive ? 'accounts.archive' : 'accounts.restore'),
                          style: selectedSupplier.isActive ? 'destructive' : 'default',
                          onPress: () => void runAction(
                            () => setSupplierArchived(database, workspace, selectedSupplier.id, Boolean(selectedSupplier.isActive), () => Crypto.randomUUID()),
                            t(selectedSupplier.isActive ? 'accounts.archivedNotice' : 'accounts.restoredNotice'),
                          ),
                        },
                      ],
                    )}
                  />
                </>
              ) : null}
              {selectedSupplier?.isActive ? (
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
    balanceFilter: { alignSelf: 'flex-start', borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
    filterText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    history: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingTop: 12 },
    historyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    historyRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', paddingVertical: 8 },
    error: { color: colors.danger, fontSize: 14 },
    success: { color: colors.success, fontSize: 14, fontWeight: '600' },
  })
}
