import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { cacheDirectory, deleteAsync, writeAsStringAsync } from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs, parseTzsAmount } from '@/src/domain/money'
import {
  createManualCashbookEntry,
  cashbookEntriesToCsv,
  getCashbookTotals,
  getOpeningBalance,
  listCashbookEntries,
  reconcileCashbook,
  recordOpeningBalance,
  type CashbookEntry,
  type CashbookEntryType,
  type CashbookTotals,
  type OpeningBalance,
} from '@/src/repositories/cashbook'
import { getActiveWorkspace, type Permission, type Workspace } from '@/src/repositories/workspace'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

export default function CashbookScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [entries, setEntries] = useState<CashbookEntry[]>([])
  const [totals, setTotals] = useState<CashbookTotals>({ incomeMinor: 0, expenseMinor: 0 })
  const [openingBalance, setOpeningBalance] = useState<OpeningBalance | null>(null)
  const [openingAmount, setOpeningAmount] = useState('')
  const [openingNote, setOpeningNote] = useState('')
  const [countedBalance, setCountedBalance] = useState('')
  const [reconciliationNote, setReconciliationNote] = useState('')
  const [entryType, setEntryType] = useState<CashbookEntryType>('income')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [search, setSearch] = useState('')
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      if (!current) {
        setEntries([])
        setTotals({ incomeMinor: 0, expenseMinor: 0 })
        setPermissions([])
        return
      }
      const userPermissions = current.role === 'owner'
        ? ['sell', 'manage_inventory', 'view_reports', 'manage_settings'] as Permission[]
        : (await database.getAllAsync<{ permission: Permission }>(
          `SELECT permission FROM user_store_permissions
           WHERE business_id = ? AND store_id = ? AND user_id = ?`,
          current.businessId,
          current.storeId,
          current.userId,
        )).map(({ permission }) => permission)
      setPermissions(userPermissions)
      setEntryType((currentType) => (
        currentType === 'income' && userPermissions.includes('sell')
        || currentType === 'expense' && userPermissions.includes('manage_inventory')
      ) ? currentType : userPermissions.includes('sell') ? 'income' : 'expense')
      const [nextEntries, nextTotals] = await Promise.all([
        listCashbookEntries(database, current, { days, search }),
        getCashbookTotals(database, current),
      ])
      const currentOpeningBalance = await getOpeningBalance(database, current)
      setEntries(nextEntries)
      setTotals(nextTotals)
      setOpeningBalance(currentOpeningBalance)
    } finally {
      setLoading(false)
    }
  }, [database, days, search])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'cashbook.loadError')))
  }, [load, localizeError]))

  const canRecordIncome = permissions.includes('sell')
  const canRecordExpense = permissions.includes('manage_inventory')
  const parsedAmount = parseTzsAmount(amount)
  const parsedOpeningAmount = parseTzsAmount(openingAmount)
  const parsedCountedBalance = parseTzsAmount(countedBalance)
  const net = totals.incomeMinor - totals.expenseMinor
  const canManageCashbookSettings = permissions.includes('manage_settings')

  const saveEntry = () => {
    if (!workspace || parsedAmount === null) return
    setSaving(true)
    setError(null)
    setNotice(null)
    void createManualCashbookEntry(database, workspace, {
      entryType,
      category,
      amountMinor: parsedAmount,
      note,
    }, () => Crypto.randomUUID()).then(async () => {
      setCategory('')
      setAmount('')
      setNote('')
      setNotice(t('cashbook.saved'))
      await load()
    }).catch((reason: unknown) => {
      setError(localizeError(reason, 'cashbook.saveError'))
    }).finally(() => setSaving(false))
  }

  const exportEntries = async () => {
    let fileUri: string | null = null
    try {
      if (!cacheDirectory) throw new Error(t('cashbook.exportUnavailable'))
      fileUri = `${cacheDirectory}cashbook-${Crypto.randomUUID()}.csv`
      await writeAsStringAsync(fileUri, cashbookEntriesToCsv(entries))
      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        UTI: 'public.comma-separated-values-text',
        dialogTitle: t('cashbook.exportTitle'),
      })
    } catch (reason) {
      setError(localizeError(reason, 'cashbook.exportError'))
    } finally {
      if (fileUri) {
        try {
          await deleteAsync(fileUri, { idempotent: true })
        } catch (reason) {
          setError(localizeError(reason, 'cashbook.exportError'))
        }
      }
    }
  }

  const saveOpeningBalance = async () => {
    if (!workspace || parsedOpeningAmount === null || parsedOpeningAmount <= 0) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      await recordOpeningBalance(database, workspace, {
        entryType,
        amountMinor: parsedOpeningAmount,
        note: openingNote,
      }, () => Crypto.randomUUID())
      setOpeningAmount('')
      setOpeningNote('')
      setNotice(t('cashbook.openingSaved'))
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'cashbook.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const saveReconciliation = async () => {
    if (!workspace || parsedCountedBalance === null) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const difference = await reconcileCashbook(
        database,
        workspace,
        parsedCountedBalance,
        reconciliationNote,
        () => Crypto.randomUUID(),
      )
      setCountedBalance('')
      setReconciliationNote('')
      setNotice(t(difference === 0 ? 'cashbook.reconciled' : 'cashbook.reconciliationSaved', {
        amount: formatTzs(Math.abs(difference), language),
      }))
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'cashbook.saveError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('cashbook.title')} /><Card><Text style={styles.muted}>{t('cashbook.signInRequired')}</Text></Card></Screen>

  return (
    <Screen>
      <PageTitle title={t('cashbook.title')} subtitle={t('cashbook.subtitle', { store: workspace.storeName })} />
      <Card>
        <Text style={styles.sectionTitle}>{t('cashbook.balance')}</Text>
        <Text style={styles.total}>{net < 0 ? '−' : ''}{formatTzs(Math.abs(net), language)}</Text>
        <View style={styles.totalsRow}>
          <Text style={styles.income}>{t('cashbook.income')}: {formatTzs(totals.incomeMinor, language)}</Text>
          <Text style={styles.expense}>{t('cashbook.expense')}: {formatTzs(totals.expenseMinor, language)}</Text>
        </View>
      </Card>

      {canManageCashbookSettings ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('cashbook.openingBalance')}</Text>
          {openingBalance ? (
            <Text style={styles.muted}>
              {t('cashbook.openingSet', {
                amount: `${openingBalance.entryType === 'expense' ? '−' : ''}${formatTzs(openingBalance.amountMinor, language)}`,
              })}
            </Text>
          ) : (
            <>
              <Text style={styles.muted}>{t('cashbook.openingHelp')}</Text>
              <View style={styles.typeRow}>
                {(['income', 'expense'] as const).map((type) => (
                  <Pressable
                    key={type}
                    accessibilityRole="button"
                    accessibilityState={{ selected: entryType === type }}
                    onPress={() => setEntryType(type)}
                    style={[styles.typeButton, entryType === type && styles.selectedType]}
                  >
                    <Text style={styles.typeText}>{t(type === 'income' ? 'cashbook.cashOnHand' : 'cashbook.overdraft')}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label={t('cashbook.amount')} value={openingAmount} onChangeText={setOpeningAmount} keyboardType="number-pad" />
              <Field label={t('cashbook.note')} value={openingNote} onChangeText={setOpeningNote} />
              <Button
                label={t('cashbook.setOpeningBalance')}
                onPress={() => void saveOpeningBalance()}
                disabled={saving || parsedOpeningAmount === null || parsedOpeningAmount <= 0}
              />
            </>
          )}
          <Text style={styles.sectionTitle}>{t('cashbook.reconcile')}</Text>
          <Text style={styles.muted}>{t('cashbook.reconcileHelp', {
            balance: `${net < 0 ? '−' : ''}${formatTzs(Math.abs(net), language)}`,
          })}</Text>
          <Field label={t('cashbook.countedCash')} value={countedBalance} onChangeText={setCountedBalance} keyboardType="number-pad" />
          <Field label={t('cashbook.reconcileNote')} value={reconciliationNote} onChangeText={setReconciliationNote} />
          <Button
            label={t('cashbook.reconcile')}
            secondary
            onPress={() => void saveReconciliation()}
            disabled={saving || parsedCountedBalance === null || reconciliationNote.trim().length < 2}
          />
        </Card>
      ) : null}

      {canRecordIncome || canRecordExpense ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('cashbook.addEntry')}</Text>
          <View style={styles.typeRow}>
            {canRecordIncome ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: entryType === 'income' }}
                onPress={() => setEntryType('income')}
                style={[styles.typeButton, entryType === 'income' && styles.selectedType]}
              >
                <Text style={styles.typeText}>{t('cashbook.income')}</Text>
              </Pressable>
            ) : null}
            {canRecordExpense ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: entryType === 'expense' }}
                onPress={() => setEntryType('expense')}
                style={[styles.typeButton, entryType === 'expense' && styles.selectedType]}
              >
                <Text style={styles.typeText}>{t('cashbook.expense')}</Text>
              </Pressable>
            ) : null}
          </View>
          <Field label={t('cashbook.category')} value={category} onChangeText={setCategory} />
          <Field label={t('cashbook.amount')} value={amount} onChangeText={setAmount} keyboardType="number-pad" />
          <Field label={t('cashbook.note')} value={note} onChangeText={setNote} />
          <Button
            label={saving ? t('cashbook.saving') : t('cashbook.save')}
            onPress={saveEntry}
            disabled={saving || parsedAmount === null || parsedAmount <= 0}
          />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>{t('cashbook.recent')}</Text>
        <Field label={t('cashbook.search')} value={search} onChangeText={setSearch} autoCapitalize="none" />
        <View style={styles.typeRow}>
          {([7, 30, 90] as const).map((period) => (
            <Pressable
              key={period}
              accessibilityRole="button"
              accessibilityState={{ selected: days === period }}
              onPress={() => setDays(period)}
              style={[styles.typeButton, days === period && styles.selectedType]}
            >
              <Text style={styles.typeText}>{t('reports.period', { days: period })}</Text>
            </Pressable>
          ))}
        </View>
        {entries.length > 0 ? <Button label={t('cashbook.export')} secondary onPress={() => void exportEntries()} /> : null}
        {entries.length === 0 ? <Text style={styles.muted}>{t('cashbook.empty')}</Text> : entries.map((entry) => (
          <View key={entry.id} style={styles.entryRow}>
            <View style={styles.entryInfo}>
              <Text style={styles.entryTitle}>{entry.category}</Text>
              <Text style={styles.muted}>
                {entry.source === 'manual' ? t('cashbook.manual') : t(`cashbook.source.${entry.source}`)}
                {entry.note ? ` · ${entry.note}` : ''}
              </Text>
              <Text style={styles.date}>
                {new Date(entry.createdAt).toLocaleString(language === 'sw' ? 'sw-TZ' : 'en-TZ')}
              </Text>
            </View>
            <Text style={entry.entryType === 'income' ? styles.income : styles.expense}>
              {entry.entryType === 'income' ? '+' : '−'}{formatTzs(entry.amountMinor, language)}
            </Text>
          </View>
        ))}
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.income}>{notice}</Text> : null}
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
    total: { color: colors.text, fontSize: 26, fontWeight: '800' },
    totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
    typeRow: { flexDirection: 'row', gap: 8 },
    typeButton: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
    selectedType: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    typeText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    entryRow: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', paddingVertical: 11 },
    entryInfo: { flex: 1, gap: 3 },
    entryTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    date: { color: colors.muted, fontSize: 11 },
    income: { color: colors.success, fontSize: 14, fontWeight: '700' },
    expense: { color: colors.danger, fontSize: 14, fontWeight: '700' },
    error: { color: colors.danger, fontSize: 14 },
  })
}
