import { Stack } from 'expo-router'
import { SQLiteProvider } from 'expo-sqlite'
import { StatusBar } from 'expo-status-bar'
import { migrateDatabase } from '@/src/database/migrations'
import { ThemeProvider } from '@/src/theme/ThemeProvider'
import { I18nProvider } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'
import { ThemeToggle } from '@/src/components/ThemeToggle'

export default function RootLayout() {
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
        <Stack.Screen name="(tabs)" />
      </Stack>
      <ThemeToggle />
    </>
  )
}
