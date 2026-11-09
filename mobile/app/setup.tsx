import { useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { StyleSheet, Text } from 'react-native'
import { Button, Card, Field, LanguageSelector, PageTitle, Screen } from '@/src/components/NativeUi'
import { workspaceInput } from '@/src/domain/validation'
import { createWorkspace } from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'

export default function SetupScreen() {
  const { colors } = useTheme()
  const { t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const router = useRouter()
  const [ownerName, setOwnerName] = useState('')
  const [ownerUsername, setOwnerUsername] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const parsed = workspaceInput.safeParse({ ownerName, ownerUsername, ownerPassword, businessName, storeName })
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message
      setError(message ? localizeError(new Error(message), 'setup.checkDetails') : t('setup.checkDetails'))
      return
    }

    setSaving(true)
    setError(null)
    try {
      await createWorkspace(database, parsed.data, () => Crypto.randomUUID())
      router.replace('/(tabs)')
    } catch (reason) {
      setError(localizeError(reason, 'setup.saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen>
      <LanguageSelector />
      <PageTitle title={t('setup.welcome')} subtitle={t('setup.subtitle')} />
      <Card>
        <Text style={styles.sectionTitle}>{t('setup.yourBusiness')}</Text>
        <Field label={t('auth.ownerName')} value={ownerName} onChangeText={setOwnerName} autoCapitalize="words" />
        <Field label={t('auth.username')} value={ownerUsername} onChangeText={setOwnerUsername} autoCapitalize="none" />
        <Field label={t('setup.passwordHint')} value={ownerPassword} onChangeText={setOwnerPassword} secureTextEntry autoCapitalize="none" />
        <Field label={t('auth.businessName')} value={businessName} onChangeText={setBusinessName} autoCapitalize="words" />
        <Field label={t('setup.firstStore')} value={storeName} onChangeText={setStoreName} placeholder={t('setup.defaultStore')} autoCapitalize="words" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={saving ? t('setup.saving') : t('setup.create')} onPress={() => void save()} disabled={saving} />
      </Card>
      <Text style={styles.note}>
        {t('setup.passwordNote')}
      </Text>
      <Button
        label={t('setup.onlineAccount')}
        secondary
        onPress={() => router.replace('/login')}
      />
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    error: { color: colors.danger, fontSize: 14 },
    note: { color: colors.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 2 },
  })
}
