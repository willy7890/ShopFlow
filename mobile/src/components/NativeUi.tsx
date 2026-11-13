import { useState, type PropsWithChildren, type ReactNode } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { passwordVisibilityState, togglePasswordVisibility } from '@/src/domain/passwordVisibility'

export function Screen({
  children,
  keyboardAware = false,
  compact = false,
}: PropsWithChildren<{ keyboardAware?: boolean; compact?: boolean }>) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const scrollView = (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, compact && styles.compactContent]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  )
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {keyboardAware ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {scrollView}
        </KeyboardAvoidingView>
      ) : scrollView}
    </SafeAreaView>
  )
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.pageTitle}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  )
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return <View style={[styles.card, style]}>{children}</View>
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

export function PasswordField({
  label,
  value,
  onChangeText,
  autoCapitalize = 'none',
  error,
  ...props
}: TextInputProps & { label: string; error?: string }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const styles = createStyles(colors)
  const [visible, setVisible] = useState(false)
  const visibility = passwordVisibilityState(visible)
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordInput}>
        <TextInput
          {...props}
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          onChangeText={onChangeText}
          placeholderTextColor={colors.muted}
          secureTextEntry={visibility.secureTextEntry}
          style={styles.passwordTextInput}
          value={value}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(visibility.accessibilityLabel)}
          accessibilityState={{ selected: visible }}
          onPress={() => setVisible(togglePasswordVisibility)}
          style={styles.passwordVisibility}
          hitSlop={8}
        >
          <View style={styles.eye}>
            <View style={styles.eyePupil} />
            {!visible ? <View style={styles.eyeSlash} /> : null}
          </View>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

export function Button({
  label,
  onPress,
  disabled = false,
  secondary = false,
  trailing,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
  trailing?: ReactNode
}) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressedButton,
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
      {trailing}
    </Pressable>
  )
}

export function LoadingState({ label = 'Loading...' }: { label?: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.subtitle}>{label}</Text>
    </View>
  )
}

export function LanguageSelector() {
  const { colors } = useTheme()
  const { language, setLanguage, t } = useI18n()
  const [error, setError] = useState<string | null>(null)
  const styles = createStyles(colors)
  const select = async (option: 'en' | 'sw') => {
    setError(null)
    try {
      await setLanguage(option)
    } catch {
      setError(t('common.languageSaveError'))
    }
  }
  return (
    <>
      <View style={styles.languageRow} accessibilityRole="radiogroup">
        {(['en', 'sw'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: language === option }}
            onPress={() => void select(option)}
            style={[styles.languageOption, language === option && styles.languageSelected]}
          >
            <Text style={[styles.languageText, language === option && styles.languageSelectedText]}>
              {t(option === 'en' ? 'common.english' : 'common.swahili')}
            </Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingTop: 64, paddingBottom: 36, gap: 16 },
    compactContent: { paddingTop: 20, paddingBottom: 24 },
    titleBlock: { gap: 5, marginBottom: 2 },
    pageTitle: { color: colors.text, fontSize: 27, fontWeight: '700' },
    subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      gap: 12,
      padding: 16,
    },
    field: { gap: 7 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600' },
    input: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: 13,
    },
    passwordInput: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 11,
      borderWidth: 1,
      flexDirection: 'row',
      minHeight: 50,
    },
    passwordTextInput: {
      color: colors.text,
      flex: 1,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: 13,
    },
    passwordVisibility: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 14 },
    eye: {
      alignItems: 'center',
      borderColor: colors.muted,
      borderRadius: 12,
      borderWidth: 1.7,
      height: 15,
      justifyContent: 'center',
      overflow: 'hidden',
      width: 22,
    },
    eyePupil: { backgroundColor: colors.muted, borderRadius: 4, height: 7, width: 7 },
    eyeSlash: {
      backgroundColor: colors.surface,
      height: 2,
      left: -2,
      position: 'absolute',
      top: 6,
      transform: [{ rotate: '-35deg' }],
      width: 25,
    },
    error: { color: colors.danger, fontSize: 13 },
    button: {
      alignItems: 'center',
      backgroundColor: colors.accent,
      borderRadius: 12,
      flexDirection: 'row',
      justifyContent: 'center',
      minHeight: 50,
      paddingHorizontal: 16,
    },
    secondaryButton: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1 },
    disabledButton: { opacity: 0.5 },
    pressedButton: { backgroundColor: colors.accentPressed },
    buttonText: { color: '#17191C', fontSize: 16, fontWeight: '700' },
    secondaryButtonText: { color: colors.text },
    loading: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
    languageRow: { flexDirection: 'row', gap: 8 },
    languageOption: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 40,
      paddingHorizontal: 14,
    },
    languageSelected: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    languageText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    languageSelectedText: { color: colors.accentPressed },
  })
}
