import { useEffect, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import {
  Button,
  Card,
  Field,
  LanguageSelector,
  LoadingState,
  PageTitle,
  PasswordField,
  Screen,
} from '@/src/components/NativeUi'
import { firstAuthIssue, validateOnlineLogin, validateOnlineRegistration } from '@/src/domain/authValidation'
import {
  authenticateUser,
  getLoginState,
  initializeLegacyOwnerCredentials,
} from '@/src/repositories/workspace'
import {
  clearOnlineSession,
  fetchCurrentUser,
  getApiBaseUrl,
  loginOnline,
  registerOnline,
} from '@/src/services/api'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import type { TranslationKey } from '@/src/i18n/translations'
import { postLoginRoute } from '@/src/domain/platformAdmin'

type OnlineAction = 'login' | 'register'
type AuthField = 'email' | 'password' | 'fullName' | 'phone' | 'businessName' | 'confirmPassword'

export default function LoginScreen() {
  const { colors } = useTheme()
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const router = useRouter()
  const { notice } = useLocalSearchParams<{ notice?: string }>()
  const styles = createStyles(colors)
  const [loading, setLoading] = useState(true)
  const [hasBusiness, setHasBusiness] = useState(true)
  const [legacyOwner, setLegacyOwner] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'device' | 'online'>('online')
  const [onlineAction, setOnlineAction] = useState<OnlineAction>('login')
  const [apiUrl, setApiUrl] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [onlinePassword, setOnlinePassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AuthField, TranslationKey>>>({})

  useEffect(() => {
    let active = true
    Promise.allSettled([getApiBaseUrl(database), getLoginState(database)])
      .then(([apiResult, loginResult]) => {
        if (!active) return
        if (apiResult.status === 'fulfilled') {
          setApiUrl(apiResult.value)
        } else {
          setError(localizeError(apiResult.reason, 'auth.apiAddressError'))
        }
        if (loginResult.status === 'fulfilled') {
          setLegacyOwner(loginResult.value.hasCredentiallessOwner)
          setHasBusiness(loginResult.value.hasBusiness)
        } else {
          setError(localizeError(loginResult.reason, 'auth.localAccountError'))
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [database, localizeError])

  const switchAction = (action: OnlineAction) => {
    setOnlineAction(action)
    setError(null)
    setFieldErrors({})
  }

  const updateField = (field: AuthField, setter: (value: string) => void) => (value: string) => {
    setter(value)
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

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
    const errors = firstAuthIssue(validateOnlineLogin(email, onlinePassword))
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError(null)
      return
    }
    setSaving(true)
    setError(null)
    setFieldErrors({})
    try {
      await loginOnline(database, apiUrl, email, onlinePassword)
      const currentUser = await fetchCurrentUser(database)
      router.replace(postLoginRoute(currentUser) as Href)
    } catch (reason) {
      setError(localizeError(reason, 'auth.signInError'))
    } finally {
      setSaving(false)
    }
  }

  const signUpOnline = async () => {
    const errors = firstAuthIssue(validateOnlineRegistration({
      fullName,
      email,
      phone,
      businessName,
      password: onlinePassword,
      confirmPassword,
    }))
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError(null)
      return
    }
    setSaving(true)
    setError(null)
    setFieldErrors({})
    try {
      const registeredUser = await registerOnline(database, apiUrl, {
        fullName,
        email,
        phone,
        password: onlinePassword,
        businessName,
        preferredLanguage: language,
      })
      const destination = postLoginRoute(registeredUser)
      router.replace({
        pathname: destination,
        params: destination === '/businesses'
          ? { notice: t('auth.registrationSuccess') }
          : undefined,
      })
    } catch (reason) {
      setError(localizeError(reason, 'auth.registerError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Screen compact><LoadingState label={t('auth.checkingLocal')} /></Screen>

  return (
    <Screen keyboardAware compact>
      <View style={styles.container}>
        <LanguageSelector />
        <View style={styles.brand}>
          <Image
            accessibilityLabel={t('welcome.logoDescription')}
            source={require('../assets/images/icon.png')}
            resizeMode="contain"
            style={styles.logo}
          />
          <View style={styles.brandCopy}>
            <Text style={styles.brandName}>{t('app.name')}</Text>
            <Text style={styles.brandSubtitle}>{t('auth.brandSubtitle')}</Text>
          </View>
        </View>

        <View style={styles.modeTabs} accessibilityRole="tablist">
          <AuthTab
            label={t('auth.onlineMode')}
            selected={mode === 'online'}
            onPress={() => { setMode('online'); setError(null); setFieldErrors({}) }}
            disabled={saving}
            colors={colors}
          />
          <AuthTab
            label={t('auth.deviceMode')}
            selected={mode === 'device'}
            onPress={() => { setMode('device'); setError(null); setFieldErrors({}) }}
            disabled={saving}
            colors={colors}
          />
        </View>

        <PageTitle
          title={mode === 'device' && legacyOwner
            ? t('auth.secureExisting')
            : mode === 'online'
              ? t(onlineAction === 'login' ? 'auth.signInTitle' : 'auth.createAccountTitle')
              : t('auth.login')}
          subtitle={mode === 'device' && legacyOwner
            ? t('auth.legacySubtitle')
            : mode === 'online'
              ? t(onlineAction === 'login' ? 'auth.onlineSubtitle' : 'auth.registrationSubtitle')
              : t('auth.localSubtitle')}
        />

        {mode === 'online' ? (
          <View style={styles.actionTabs} accessibilityRole="tablist">
            <AuthTab
              label={t('auth.signInTab')}
              selected={onlineAction === 'login'}
              onPress={() => switchAction('login')}
              disabled={saving}
              colors={colors}
            />
            <AuthTab
              label={t('auth.createAccountTab')}
              selected={onlineAction === 'register'}
              onPress={() => switchAction('register')}
              disabled={saving}
              colors={colors}
            />
          </View>
        ) : null}

        {!hasBusiness && mode === 'device' ? (
          <Button
            label={t('setup.create')}
            secondary
            onPress={() => router.push('/setup')}
            disabled={saving}
          />
        ) : null}

        <Card style={styles.formCard}>
          {mode === 'device' ? (
            <>
              {legacyOwner ? (
                <Field
                  label={t('auth.ownerName')}
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                />
              ) : null}
              <Field
                label={t('auth.username')}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <PasswordField label={t('auth.password')} value={password} onChangeText={setPassword} />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {notice ? <Text style={styles.success}>{notice}</Text> : null}
              <Button
                label={saving ? t('auth.verifying') : legacyOwner ? t('auth.secureOwner') : t('auth.login')}
                onPress={() => void signIn()}
                disabled={saving}
              />
            </>
          ) : (
            <>
              {onlineAction === 'register' ? (
                <>
                  <Field
                    label={t('auth.fullName')}
                    value={fullName}
                    onChangeText={updateField('fullName', setFullName)}
                    autoCapitalize="words"
                    maxLength={160}
                    error={fieldErrors.fullName ? t(fieldErrors.fullName) : undefined}
                  />
                  <Field
                    label={t('auth.email')}
                    value={email}
                    onChangeText={updateField('email', setEmail)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    maxLength={254}
                    error={fieldErrors.email ? t(fieldErrors.email) : undefined}
                  />
                  <Field
                    label={t('auth.phone')}
                    value={phone}
                    onChangeText={updateField('phone', setPhone)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="phone-pad"
                    maxLength={32}
                    error={fieldErrors.phone ? t(fieldErrors.phone) : undefined}
                  />
                  <Field
                    label={t('auth.businessName')}
                    value={businessName}
                    onChangeText={updateField('businessName', setBusinessName)}
                    autoCapitalize="words"
                    maxLength={180}
                    error={fieldErrors.businessName ? t(fieldErrors.businessName) : undefined}
                  />
                </>
              ) : (
                <Field
                  label={t('auth.email')}
                  value={email}
                  onChangeText={updateField('email', setEmail)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  maxLength={254}
                  error={fieldErrors.email ? t(fieldErrors.email) : undefined}
                />
              )}
              <PasswordField
                label={t('auth.password')}
                value={onlinePassword}
                onChangeText={updateField('password', setOnlinePassword)}
                maxLength={128}
                error={fieldErrors.password ? t(fieldErrors.password) : undefined}
              />
              {onlineAction === 'register' ? (
                <PasswordField
                  label={t('auth.confirmPassword')}
                  value={confirmPassword}
                  onChangeText={updateField('confirmPassword', setConfirmPassword)}
                  maxLength={128}
                  error={fieldErrors.confirmPassword ? t(fieldErrors.confirmPassword) : undefined}
                />
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {notice ? <Text style={styles.success}>{notice}</Text> : null}
              <Button
                label={saving
                  ? t('auth.connecting')
                  : t(onlineAction === 'login' ? 'auth.signInOnline' : 'auth.createOnline')}
                onPress={() => void (onlineAction === 'login' ? signInOnline() : signUpOnline())}
                disabled={saving || !apiUrl}
              />
              <Text style={styles.footerText}>
                {onlineAction === 'login' ? t('auth.noAccount') : t('auth.haveAccountPrompt')}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => switchAction(onlineAction === 'login' ? 'register' : 'login')}
                disabled={saving}
                style={styles.footerLink}
              >
                <Text style={styles.linkText}>
                  {t(onlineAction === 'login' ? 'auth.createAccountTab' : 'auth.signInTab')}
                </Text>
              </Pressable>
            </>
          )}
        </Card>
      </View>
    </Screen>
  )
}

function AuthTab({
  label,
  selected,
  onPress,
  disabled,
  colors,
}: {
  label: string
  selected: boolean
  onPress: () => void
  disabled: boolean
  colors: ThemeColors
}) {
  const styles = stylesForAuthTab(colors)
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.tab,
        selected && styles.tabSelected,
      ]}
    >
      <Text style={[
        styles.tabText,
        selected && styles.tabTextSelected,
      ]}>
        {label}
      </Text>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { alignItems: 'center', alignSelf: 'center', gap: 18, maxWidth: 480, width: '100%' },
    brand: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'center', paddingVertical: 2 },
    logo: { borderRadius: 13, height: 48, width: 48 },
    brandCopy: { gap: 2 },
    brandName: { color: colors.text, fontSize: 20, fontWeight: '800' },
    brandSubtitle: { color: colors.muted, fontSize: 12 },
    modeTabs: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      gap: 5,
      maxWidth: 480,
      padding: 4,
      width: '100%',
    },
    actionTabs: { flexDirection: 'row', gap: 8, maxWidth: 480, width: '100%' },
    formCard: { maxWidth: 480, width: '100%' },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    success: { color: colors.accentPressed, fontSize: 13, lineHeight: 18 },
    footerText: { color: colors.muted, fontSize: 13, textAlign: 'center' },
    footerLink: { alignItems: 'center', minHeight: 40, justifyContent: 'center' },
    linkText: { color: colors.accentPressed, fontSize: 14, fontWeight: '700' },
  })
}

function stylesForAuthTab(colors: ThemeColors) {
  return StyleSheet.create({
    tab: {
      alignItems: 'center',
      borderRadius: 10,
      flex: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: 8,
    },
    tabSelected: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    tabText: { color: colors.muted, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    tabTextSelected: { color: colors.text, fontWeight: '700' },
  })
}
