import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { formatTzs, parseTzsAmount } from '@/src/domain/money'
import {
  createManualCashbookEntry,
  getCashbookTotals,
  listCashbookEntries,
  type CashbookEntry,
  type CashbookEntryType,
  type CashbookTotals,
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
  const [entryType, setEntryType] = useState<CashbookEntryType>('income')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
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
        ? ['sell', 'manage_inventory', 'view_reports'] as Permission[]
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
        listCashbookEntries(database, current),
        getCashbookTotals(database, current),
      ])
      setEntries(nextEntries)
      setTotals(nextTotals)
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'cashbook.loadError')))
  }, [load, localizeError]))

  const canRecordIncome = permissions.includes('sell')
  const canRecordExpense = permissions.includes('manage_inventory')
  const parsedAmount = parseTzsAmount(amount)
  const net = totals.incomeMinor - totals.expenseMinor

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
