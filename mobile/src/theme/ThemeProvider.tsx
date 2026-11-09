import { useEffect, useState, type PropsWithChildren } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useSQLiteContext } from 'expo-sqlite'
import { ThemeContext, themeColors, type ThemeContextValue } from './colors'
import { useI18n } from '../i18n/I18nProvider'

export function ThemeProvider({ children }: PropsWithChildren) {
  const database = useSQLiteContext()
  const { t } = useI18n()
  const [mode, setMode] = useState<ThemeContextValue['mode']>('light')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    database.getFirstAsync<{ setting_value: string }>(
      `SELECT setting_value FROM app_settings WHERE setting_key = 'theme'`,
    ).then((setting) => {
      if (active) {
        setMode(setting?.setting_value === 'dark' ? 'dark' : 'light')
        setReady(true)
      }
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : 'Could not load appearance settings.')
      }
    })
    return () => { active = false }
  }, [database])

  if (error) {
    return (
      <View style={{ backgroundColor: themeColors.light.background, flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: themeColors.light.danger }}>{t('common.error')} {error}</Text>
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

  const toggleMode = async () => {
    const nextMode = mode === 'dark' ? 'light' : 'dark'
    await database.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('theme', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
      nextMode,
    )
    setMode(nextMode)
  }

  return (
    <ThemeContext.Provider value={{ mode, colors: themeColors[mode], setMode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  )
}
