import { useEffect, useRef, useState } from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'
import { Button } from './NativeUi'

interface BarcodeScannerProps {
  visible: boolean
  onClose: () => void
  onScanned: (barcode: string) => void
}

export function BarcodeScanner({ visible, onClose, onScanned }: BarcodeScannerProps) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [permission, requestPermission] = useCameraPermissions()
  const [error, setError] = useState<string | null>(null)
  const scanned = useRef(false)

  useEffect(() => {
    if (visible) {
      scanned.current = false
      setError(null)
    }
  }, [visible])

  const grantPermission = async () => {
    setError(null)
    try {
      await requestPermission()
    } catch {
      setError(t('pos.cameraPermissionError'))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{t('pos.scanTitle')}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={[styles.closeText, { color: colors.text }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'itf14'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return
              scanned.current = true
              onScanned(data)
            }}
            onMountError={() => setError(t('pos.cameraUnavailable'))}
          />
        ) : (
          <View style={styles.permission}>
            <Text style={[styles.message, { color: colors.text }]}>{t('pos.cameraPermission')}</Text>
            <Button label={t('pos.cameraAllow')} onPress={() => void grantPermission()} />
          </View>
        )}
        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  close: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  closeText: { fontSize: 15, fontWeight: '600' },
  camera: { borderRadius: 16, flex: 1, overflow: 'hidden' },
  permission: { alignItems: 'center', flex: 1, gap: 20, justifyContent: 'center' },
  message: { fontSize: 16, textAlign: 'center' },
  error: { fontSize: 14, marginTop: 12, textAlign: 'center' },
})
