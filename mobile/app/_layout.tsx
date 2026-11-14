import { Stack } from 'expo-router'
import { SQLiteProvider } from 'expo-sqlite'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { migrateDatabase } from '@/src/database/migrations'
import { ThemeProvider } from '@/src/theme/ThemeProvider'
import { I18nProvider } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'
import { ThemeToggle } from '@/src/components/ThemeToggle'

export default function RootLayout() {
  const [databaseGate, setDatabaseGate] = useState<'checking' | 'ready' | 'busy' | 'unsupported' | 'error'>(
    Platform.OS === 'web' ? 'checking' : 'ready',
  )

  useEffect(() => {
    if (Platform.OS !== 'web') return

    type ExclusiveLockManager = {
      request(
        name: string,
        options: { mode: 'exclusive'; ifAvailable: true },
        callback: (lock: object | null) => Promise<void>,
      ): Promise<void>
    }
    const lockManager = (globalThis.navigator as unknown as { locks?: ExclusiveLockManager }).locks
    if (!lockManager) {
      setDatabaseGate('unsupported')
      return
    }

    let cancelled = false
    let releaseLock: () => void = () => {}
    const lockLifetime = new Promise<void>((resolve) => { releaseLock = resolve })
    void lockManager.request('shopflow-sqlite-web-v1', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        if (!cancelled) setDatabaseGate('busy')
        return
      }
      if (!cancelled) setDatabaseGate('ready')
      await lockLifetime
    }).catch(() => {
      if (!cancelled) setDatabaseGate('error')
    })

    return () => {
      cancelled = true
      releaseLock()
    }
  }, [])

  if (databaseGate !== 'ready') {
    const message = databaseGate === 'busy'
      ? 'ShopFlow is already open in another tab. Close the other ShopFlow tab, then try again.'
      : databaseGate === 'unsupported'
        ? 'This browser cannot safely lock the local ShopFlow database. Open ShopFlow in a current version of Safari, Chrome, Firefox, or Edge.'
        : databaseGate === 'error'
          ? 'ShopFlow could not reserve its local database. Close other ShopFlow tabs and try again.'
          : 'Opening the local ShopFlow database…'
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: '#f6f7f8' }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', marginBottom: 12, color: '#20252b' }}>
          {databaseGate === 'busy' ? 'ShopFlow is open elsewhere' : 'ShopFlow'}
        </Text>
        <Text accessibilityRole="alert" style={{ maxWidth: 460, textAlign: 'center', lineHeight: 22, color: '#515a64' }}>
          {message}
        </Text>
        {(databaseGate === 'busy' || databaseGate === 'error') && (
          <Text
            accessibilityRole="button"
            onPress={() => globalThis.location?.reload()}
            style={{ marginTop: 20, padding: 12, color: '#a64b12', fontWeight: '700' }}
          >
            Try again
          </Text>
        )}
      </View>
    )
  }

  return (
    <SQLiteProvider databaseName="shopflow.db" onInit={migrateDatabase}>
      <I18nProvider>
        <ThemeProvider>
          <RootStack />
        </ThemeProvider>
      </I18nProvider>
    </SQLiteProvider>
  )
}

function RootStack() {
  const { mode, colors } = useTheme()
  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="login" />
        <Stack.Screen name="businesses" />
        <Stack.Screen name="platform-admin" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <ThemeToggle />
    </>
  )
}
