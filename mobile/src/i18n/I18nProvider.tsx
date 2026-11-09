import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useSQLiteContext } from 'expo-sqlite'
import { themeColors } from '../theme/colors'
import { translate, translateError, type Language, type TranslationKey } from './translations'

interface I18nValue {
  language: Language
  setLanguage: (language: Language) => Promise<void>
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
  error: (reason: unknown, fallbackKey: TranslationKey) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: PropsWithChildren) {
  const database = useSQLiteContext()
  const [language, setLanguageState] = useState<Language>('en')
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    database.getFirstAsync<{ setting_value: string }>(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'language'",
    ).then((setting) => {
      if (!active) return
      setLanguageState(setting?.setting_value === 'sw' ? 'sw' : 'en')
      setReady(true)
    }).catch((reason: unknown) => {
      if (!active) return
      setLoadError(reason instanceof Error ? reason.message : 'Could not load language settings.')
    })
    return () => { active = false }
  }, [database])

  const setLanguage = useCallback(async (nextLanguage: Language) => {
    await database.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('language', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
      nextLanguage,
    )
    setLanguageState(nextLanguage)
  }, [database])

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, values) => translate(language, key, values),
    error: (reason, fallbackKey) => {
      return translateError(
        language,
        reason instanceof Error ? reason.message : translate(language, fallbackKey),
      )
    },
  }), [language, setLanguage])

  if (loadError) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: themeColors.light.background, flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: themeColors.light.danger }}>Could not load language settings: {loadError}</Text>
      </View>
    )
  }
  if (!ready) {
    return (
      <View style={{ alignItems: 'center', backgroundColor: themeColors.light.background, flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator color={themeColors.light.accent} />
      </View>
    )
  }
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useI18n must be used within I18nProvider.')
  return value
}
