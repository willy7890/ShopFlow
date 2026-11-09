import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'

const tabSymbols: Record<string, string> = {
  index: '⌂',
  pos: '+',
  products: '▦',
  inventory: '≡',
  management: '⚙',
}

export default function TabLayout() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tab,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 66 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ color }) => (
          <Text style={{ color, fontSize: 21, fontWeight: '700' }}>{tabSymbols[route.name]}</Text>
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="pos" options={{ title: t('tabs.sell') }} />
      <Tabs.Screen name="products" options={{ title: t('tabs.products') }} />
      <Tabs.Screen name="inventory" options={{ title: t('tabs.stock') }} />
      <Tabs.Screen name="management" options={{ title: t('tabs.manage') }} />
    </Tabs>
  )
}
