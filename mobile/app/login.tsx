import { useEffect, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Text } from 'react-native'
import { Button, Card, Field, LanguageSelector, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import {
  authenticateUser,
  getLoginState,
  initializeLegacyOwnerCredentials,
} from '@/src/repositories/workspace'
import { clearOnlineSession, getApiBaseUrl, loginOnline, registerOnline } from '@/src/services/api'
import { useTheme } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'

export default function LoginScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const router = useRouter()
  const { notice } = useLocalSearchParams<{ notice?: string }>()
  const [loading, setLoading] = useState(true)
  const [legacyOwner, setLegacyOwner] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'device' | 'online'>('device')
  const [onlineAction, setOnlineAction] = useState<'login' | 'register'>('login')
  const [apiUrl, setApiUrl] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [onlinePassword, setOnlinePassword] = useState('')

  useEffect(() => {
    let active = true
    getApiBaseUrl(database).then((value) => {
      if (active) setApiUrl(value)
    }).catch((reason: unknown) => {
      if (active) setError(localizeError(reason, 'auth.apiAddressError'))
    })
    getLoginState(database).then((state) => {
      if (active) setLegacyOwner(state.hasCredentiallessOwner)
    }).catch((reason: unknown) => {
      if (active) setError(localizeError(reason, 'auth.localAccountError'))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [database, localizeError])

  const signIn = async () => {
    setSaving(true)
    setError(null)
    try {
      if (legacyOwner) {
        await initializeLegacyOwnerCredentials(database, displayName, username, password, () => Crypto.randomUUID())
      } else {
        await authenticateUser(database, username, password)
      }
      await clearOnlineSession()
      router.replace('/(tabs)')
    } catch (reason) {
      setError(localizeError(reason, 'auth.localAccountError'))
    } finally {
      setSaving(false)
    }
  }

  const signInOnline = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('errors.emailInvalid'))
      return
    }
    if (!onlinePassword) {
      setError(t('errors.onlinePasswordRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await loginOnline(database, apiUrl, email, onlinePassword)
      router.replace('/businesses' as Href)
    } catch (reason) {
      setError(localizeError(reason, 'auth.signInError'))
    } finally {
      setSaving(false)
    }
  }

  const signUpOnline = async () => {
    if (fullName.trim().length < 2) {
      setError(t('errors.onlineFullName'))
      return
    }
    if (businessName.trim().length < 2) {
      setError(t('errors.onlineBusinessName'))
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('errors.emailInvalid'))
      return
    }
    if (onlinePassword.length < 8) {
      setError(t('errors.onlinePasswordLength'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await registerOnline(database, apiUrl, {
        fullName,
        email,
        password: onlinePassword,
        businessName,
        preferredLanguage: language,
      })
      router.replace('/businesses' as Href)
    } catch (reason) {
      setError(localizeError(reason, 'auth.registerError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Screen><LoadingState label={t('auth.checkingLocal')} /></Screen>

  return (
    <Screen>
      <LanguageSelector />
      <PageTitle
        title={mode === 'device' && legacyOwner ? t('auth.secureExisting') : t('auth.login')}
        subtitle={mode === 'device' && legacyOwner
          ? t('auth.legacySubtitle')
          : mode === 'online'
            ? t('auth.onlineSubtitle')
            : t('auth.localSubtitle')}
      />
      <Button
        label={mode === 'device' ? t('auth.useOnline') : t('auth.useOffline')}
        secondary
        onPress={() => {
          setMode((current) => current === 'device' ? 'online' : 'device')
          setError(null)
        }}
        disabled={saving}
      />
      <Card>
        {mode === 'device' ? (
          <>
            {legacyOwner ? (
              <Field label={t('auth.ownerName')} value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
            ) : null}
            <Field label={t('auth.username')} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} />
            <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          </>
        ) : (
          <>
            <Field label={t('auth.apiAddress')} value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            {onlineAction === 'register' ? (
              <>
                <Field label={t('auth.fullName')} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
                <Field label={t('auth.businessName')} value={businessName} onChangeText={setBusinessName} autoCapitalize="words" />
              </>
            ) : null}
            <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <Field label={t('auth.password')} value={onlinePassword} onChangeText={setOnlinePassword} secureTextEntry autoCapitalize="none" />
            <Button
              label={saving
                ? t('auth.connecting')
                : onlineAction === 'login'
                  ? t('auth.signInOnline')
                  : t('auth.createOnline')}
              onPress={() => void (onlineAction === 'login' ? signInOnline() : signUpOnline())}
              disabled={saving}
            />
            <Button
              label={onlineAction === 'login' ? t('auth.createAccount') : t('auth.haveAccount')}
              secondary
              onPress={() => {
                setOnlineAction((current) => current === 'login' ? 'register' : 'login')
                setError(null)
              }}
              disabled={saving}
            />
          </>
        )}
        {notice ? <Text style={{ color: colors.danger }}>{notice}</Text> : null}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
        {mode === 'device' ? (
          <Button
            label={saving ? t('auth.verifying') : legacyOwner ? t('auth.secureOwner') : t('auth.login')}
            onPress={() => void signIn()}
            disabled={saving}
          />
        ) : null}
      </Card>
    </Screen>
  )
}
