import { useRouter } from 'expo-router'
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Button, LanguageSelector, Screen } from '@/src/components/NativeUi'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

export default function WelcomeScreen() {
  const { colors } = useTheme()
  const { t } = useI18n()
  const router = useRouter()
  const { width, height } = useWindowDimensions()
  const styles = createStyles(colors, Math.min(196, width * 0.52), height)

  return (
    <Screen>
      <LanguageSelector />
      <View style={styles.content}>
        <Image
          accessibilityLabel={t('welcome.logoDescription')}
          source={require('../assets/images/icon.png')}
          resizeMode="contain"
          style={styles.logo}
        />
        <View style={styles.copy}>
          <Text style={styles.title}>{t('welcome.title')}</Text>
          <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>
        </View>
        <View style={styles.action}>
          <Button
            label={t('welcome.getStarted')}
            onPress={() => router.push('/login')}
          />
        </View>
      </View>
    </Screen>
  )
}

function createStyles(colors: ThemeColors, logoSize: number, height: number) {
  const compact = height < 680
  return StyleSheet.create({
    content: {
      alignItems: 'center',
      flexGrow: 1,
      justifyContent: 'center',
      gap: compact ? 26 : 34,
      paddingHorizontal: 8,
      paddingVertical: compact ? 12 : 28,
    },
    logo: {
      width: logoSize,
      height: logoSize,
      borderRadius: 28,
    },
    copy: {
      alignItems: 'center',
      gap: 12,
      maxWidth: 420,
    },
    action: {
      maxWidth: 380,
      width: '100%',
    },
    title: {
      color: colors.text,
      fontSize: compact ? 28 : 32,
      fontWeight: '800',
      textAlign: 'center',
    },
    subtitle: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 24,
      textAlign: 'center',
    },
  })
}
