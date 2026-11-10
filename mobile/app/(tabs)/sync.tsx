import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Button, Card, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { StyleSheet, Text, View } from 'react-native'
import {
  listSyncQueue,
  retryFailedSyncItems,
  type SyncEntityType,
  type SyncQueueItem,
  type SyncQueueStatus,
} from '@/src/repositories/syncQueue'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { hasOnlineSession } from '@/src/services/api'
import { syncWorkspaceOutbox, type SyncSummary } from '@/src/services/sync'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'
import type { TranslationKey } from '@/src/i18n/translations'

const entityLabelKeys: Record<SyncEntityType, TranslationKey> = {
  sale: 'syncQueue.entity.sale',
  customer: 'syncQueue.entity.customer',
  customer_update: 'syncQueue.entity.customer_update',
  supplier: 'syncQueue.entity.supplier',
  supplier_update: 'syncQueue.entity.supplier_update',
  customer_ledger: 'syncQueue.entity.customer_ledger',
  supplier_ledger: 'syncQueue.entity.supplier_ledger',
  cashbook_entry: 'syncQueue.entity.cashbook_entry',
}

const statusLabelKeys: Record<SyncQueueStatus, TranslationKey> = {
  pending: 'syncQueue.status.pending',
  in_progress: 'syncQueue.status.in_progress',
  failed: 'syncQueue.status.failed',
  conflict: 'syncQueue.status.conflict',
}

export default function SyncScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [items, setItems] = useState<SyncQueueItem[]>([])
  const [online, setOnline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const current = await getActiveWorkspace(database)
      setWorkspace(current)
      if (!current) {
        setItems([])
        setOnline(false)
        return
      }
      const [queue, context, session] = await Promise.all([
        listSyncQueue(database, current),
        database.getFirstAsync<{ setting_value: string }>(
          "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
        ),
        hasOnlineSession(),
      ])
      setItems(queue)
      setOnline(context?.setting_value === 'online' && session)
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(localizeError(reason, 'syncQueue.loadError')))
  }, [load, localizeError]))

  const retryFailed = async () => {
    if (!workspace) return
    setSyncing(true)
    setError(null)
    setNotice(null)
    try {
      const queued = await retryFailedSyncItems(database, workspace)
      if (queued > 0) {
        const result: SyncSummary = await syncWorkspaceOutbox(database, workspace)
        setNotice(t('syncQueue.retrySummary', {
          queued,
          synced: result.synced,
          failed: result.failed,
          pending: result.pending,
        }))
      } else {
        setNotice(t('syncQueue.nothingToRetry'))
      }
      await load()
    } catch (reason) {
      setError(localizeError(reason, 'syncQueue.retryError'))
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>
  if (!workspace) return <Screen><PageTitle title={t('syncQueue.title')} /><Card><Text style={styles.muted}>{t('syncQueue.signInRequired')}</Text></Card></Screen>

  const retryCount = items.filter((item) => item.status === 'failed').length
  return (
    <Screen>
      <PageTitle title={t('syncQueue.title')} subtitle={t('syncQueue.subtitle', { store: workspace.storeName })} />
      {items.length === 0 ? (
        <Card><Text style={styles.muted}>{t('syncQueue.empty')}</Text></Card>
      ) : items.map((item) => (
        <Card key={item.clientId}>
          <View style={styles.heading}>
            <Text style={styles.entity}>{t(entityLabelKeys[item.entityType])}</Text>
            <Text style={styles.status}>{t(statusLabelKeys[item.status])}</Text>
          </View>
          <Text style={styles.muted}>{t('syncQueue.operation', { operation: item.operation })}</Text>
          <Text style={styles.muted}>{formatDate(item.createdAt, language)}</Text>
          <Text style={styles.muted}>{t('syncQueue.attempts', { count: item.attemptCount })}</Text>
          {item.lastError ? <Text style={styles.error}>{item.lastError}</Text> : null}
          {item.status === 'conflict' ? <Text style={styles.muted}>{t('syncQueue.conflictHelp')}</Text> : null}
        </Card>
      ))}
      {!online && items.length > 0 ? <Text style={styles.muted}>{t('syncQueue.onlineRequired')}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.success}>{notice}</Text> : null}
      <Button
        label={syncing ? t('sync.running') : t('syncQueue.retryFailed')}
        onPress={() => void retryFailed()}
        disabled={!online || syncing || retryCount === 0}
      />
      <Text style={styles.muted}>{t('syncQueue.conflictNotice')}</Text>
    </Screen>
  )
}

function formatDate(value: string, language: 'en' | 'sw'): string {
  return new Intl.DateTimeFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    heading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    entity: { color: colors.text, flex: 1, fontSize: 15, fontWeight: '700' },
    status: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
    success: { color: colors.success, fontSize: 14 },
  })
}
