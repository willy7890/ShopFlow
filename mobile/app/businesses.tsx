import { useCallback, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Text } from 'react-native'
import { Button, Card, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { activateRemoteWorkspace, restoreLocalWorkspace } from '@/src/repositories/workspace'
import {
  fetchBusinessAccess,
  fetchCurrentUser,
  clearOnlineSession,
  hasOnlineSession,
  logoutOnline,
  type ApiUser,
  type BusinessAccess,
} from '@/src/services/api'
import { downloadRemoteCatalog } from '@/src/services/remoteCatalog'
import { useTheme } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { translateRole } from '@/src/i18n/translations'

export default function BusinessesScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const router = useRouter()
  const [businesses, setBusinesses] = useState<BusinessAccess[]>([])
  const [user, setUser] = useState<ApiUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingStoreId, setSavingStoreId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [currentUser, access] = await Promise.all([
        fetchCurrentUser(database),
        fetchBusinessAccess(database),
      ])
      setUser(currentUser)
      setBusinesses(access)
    } catch (reason) {
      setError(localizeError(reason, 'businesses.loadError'))
    } finally {
      setLoading(false)
    }
  }, [database, localizeError])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  const selectBusiness = async (business: BusinessAccess, storeId: string) => {
    if (!user) return
    setSavingStoreId(storeId)
    setError(null)
    try {
      await activateRemoteWorkspace(database, user, business, storeId)
      if (await hasOnlineSession()) {
        await downloadRemoteCatalog(database, business.business_id, business.store_ids)
      }
      router.replace('/(tabs)')
    } catch (reason) {
      setError(localizeError(reason, 'businesses.openError'))
    } finally {
      setSavingStoreId(null)
    }
  }

  const signOut = async () => {
    setLoading(true)
    try {
      await logoutOnline(database)
      await restoreLocalWorkspace(database)
      router.replace('/login')
    } catch (reason) {
      setError(localizeError(reason, 'businesses.signOutError'))
    } finally {
      setLoading(false)
    }
  }

  const useLocalAccount = async () => {
    try {
      await clearOnlineSession()
      await restoreLocalWorkspace(database)
      router.replace('/login')
    } catch (reason) {
      setError(localizeError(reason, 'auth.localAccountError'))
    }
  }

  if (loading) return <Screen><LoadingState label={t('businesses.loading')} /></Screen>

  return (
    <Screen>
      <PageTitle
        title={t('businesses.title')}
        subtitle={user ? t('businesses.signedIn', { name: user.full_name }) : t('businesses.subtitle')}
      />
      <Card>
        <Text style={{ color: colors.muted }}>
          {t('businesses.syncNotice')}
        </Text>
      </Card>
      {businesses.length === 0 ? (
        <Card><Text style={{ color: colors.muted }}>{t('businesses.none')}</Text></Card>
      ) : businesses.map((business) => (
        <Card key={business.business_id}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{business.business_name}</Text>
          <Text style={{ color: colors.muted }}>{business.currency} · {translateRole(language, business.role)}</Text>
          {business.stores.map((store) => (
            <Button
              key={store.id}
              label={savingStoreId === store.id ? t('businesses.opening') : t('businesses.continue', { name: store.name })}
              onPress={() => void selectBusiness(business, store.id)}
              disabled={savingStoreId !== null}
            />
          ))}
          {business.stores.length === 0 ? (
            <Text style={{ color: colors.muted }}>{t('businesses.noStores')}</Text>
          ) : null}
        </Card>
      ))}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button label={t('businesses.signOut')} secondary onPress={() => void signOut()} disabled={savingStoreId !== null} />
      <Button label={t('businesses.useLocal')} secondary onPress={() => void useLocalAccount()} />
    </Screen>
  )
}
