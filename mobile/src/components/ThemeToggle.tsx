import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'

export function ThemeToggle() {
  const { mode, colors, toggleMode } = useTheme()
  const { t } = useI18n()
  const insets = useSafeAreaInsets()
  const [saving, setSaving] = useState(false)
  const targetMode = mode === 'dark' ? 'light' : 'dark'

  const changeMode = async () => {
    if (saving) return
    setSaving(true)
    try {
      await toggleMode()
    } catch {
      Alert.alert(t('common.error'), t('management.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(targetMode === 'light' ? 'theme.switchToLight' : 'theme.switchToDark')}
      accessibilityState={{ disabled: saving }}
      disabled={saving}
      onPress={() => void changeMode()}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          right: 16,
          top: insets.top + 10,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.icon, { color: colors.text }]}>{mode === 'dark' ? '☀' : '☾'}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 24,
    borderWidth: 1,
    elevation: 4,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    width: 48,
    zIndex: 10,
  },
  icon: {
    fontSize: 24,
    lineHeight: 30,
  },
  pressed: {
    opacity: 0.75,
  },
})
