import { useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import { getActiveWorkspace, type Workspace } from '@/src/repositories/workspace'
import { answerBusinessQuestion } from '@/src/services/assistant'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme, type ThemeColors } from '@/src/theme/colors'

interface ConversationMessage {
  id: number
  question: string
  answer: string
}

export default function AssistantScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { language, t, error: localizeError } = useI18n()
  const database = useSQLiteContext()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadWorkspace = useCallback(async () => {
    try {
      setWorkspace(await getActiveWorkspace(database))
    } catch (reason) {
      setError(localizeError(reason, 'assistant.loadError'))
    } finally {
      setLoading(false)
    }
  }, [database, localizeError])

  useFocusEffect(useCallback(() => { void loadWorkspace() }, [loadWorkspace]))

  const ask = async () => {
    if (!workspace || !question.trim() || busy) return
    const prompt = question.trim()
    setBusy(true)
    setError(null)
    try {
      const answer = await answerBusinessQuestion(database, workspace, prompt, language)
      setMessages((current) => [...current, { id: Date.now(), question: prompt, answer }])
      setQuestion('')
    } catch (reason) {
      setError(localizeError(reason, 'assistant.answerError'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Screen><LoadingState label={t('dashboard.loading')} /></Screen>
  if (!workspace) {
    return (
      <Screen>
        <PageTitle title={t('assistant.title')} />
        <Card><Text style={styles.muted}>{t('assistant.loadError')}</Text></Card>
      </Screen>
    )
  }

  return (
    <Screen>
      <PageTitle title={t('assistant.title')} subtitle={t('assistant.subtitle', { store: workspace.storeName })} />
      <Card><Text style={styles.notice}>{t('assistant.notice')}</Text></Card>
      {messages.map((message) => (
        <View key={message.id} style={styles.messageGroup}>
          <Card style={styles.questionCard}>
            <Text style={styles.messageLabel}>{t('assistant.you')}</Text>
            <Text style={styles.messageText}>{message.question}</Text>
          </Card>
          <Card>
            <Text style={styles.messageLabel}>{t('assistant.helper')}</Text>
            <Text style={styles.messageText}>{message.answer}</Text>
          </Card>
        </View>
      ))}
      <Card>
        <Field
          label={t('assistant.question')}
          value={question}
          onChangeText={setQuestion}
          placeholder={t('assistant.placeholder')}
          multiline
        />
        <Button
          label={busy ? t('assistant.asking') : t('assistant.ask')}
          onPress={() => void ask()}
          disabled={busy || !question.trim()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </Screen>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    messageGroup: { gap: 8 },
    questionCard: { backgroundColor: colors.accentSurface, borderColor: colors.accentBorder },
    messageLabel: { color: colors.accentText, fontSize: 12, fontWeight: '700' },
    messageText: { color: colors.text, fontSize: 15, lineHeight: 22 },
    notice: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
    error: { color: colors.danger, fontSize: 13 },
  })
}
