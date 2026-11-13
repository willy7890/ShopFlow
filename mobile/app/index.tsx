import { useEffect, useState } from 'react'
import { useRouter, type Href } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { LoadingState, Screen } from '@/src/components/NativeUi'
import { restoreLocalWorkspace } from '@/src/repositories/workspace'
import { fetchBusinessAccess, fetchCurrentUser, hasOnlineSession } from '@/src/services/api'
import { postLoginRoute } from '@/src/domain/platformAdmin'
import { useI18n } from '@/src/i18n/I18nProvider'

export default function EntryScreen() {
  const database = useSQLiteContext()
  const router = useRouter()
  const { t, error: localizeError } = useI18n()
  const [message, setMessage] = useState('Preparing your local shop...')

  useEffect(() => {
    let active = true
    const openApp = async () => {
      try {
        if (await hasOnlineSession()) {
          try {
            const user = await fetchCurrentUser(database)
            if (postLoginRoute(user) === '/platform-admin') {
              if (active) router.replace('/platform-admin' as Href)
              return
            }
            await fetchBusinessAccess(database)
            if (active) router.replace('/businesses' as Href)
            return
          } catch (reason) {
            if (!active) return
            const notice = t('auth.offlineNotice', {
              message: localizeError(reason, 'auth.signInError'),
            })
            await restoreLocalWorkspace(database)
            router.replace({ pathname: '/login', params: { notice } })
            return
          }
        }
        await restoreLocalWorkspace(database)
        if (active) router.replace('/welcome')
      } catch (reason) {
        if (active) setMessage(localizeError(reason, 'dashboard.stockError'))
      }
    }
    void openApp()
    return () => { active = false }
  }, [database, router, localizeError, t])

  return <Screen><LoadingState label={message} /></Screen>
}
