import { useEffect, useRef, useState } from 'react'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Linking, Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useI18n } from '@/src/i18n/I18nProvider'
import { useTheme } from '@/src/theme/colors'
import { Button } from './NativeUi'

interface BarcodeScannerProps {
  visible: boolean
  onClose: () => void
  onScanned: (barcode: string) => void
  continuous?: boolean
  title?: string
  permissionMessage?: string
}

export function BarcodeScanner({
  visible,
  onClose,
  onScanned,
  continuous = false,
  title,
  permissionMessage,
}: BarcodeScannerProps) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const [permission, requestPermission] = useCameraPermissions()
  const [error, setError] = useState<string | null>(null)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const scanned = useRef(false)
  const lastScan = useRef<{ value: string; at: number } | null>(null)

  useEffect(() => {
    if (visible) {
      scanned.current = false
      lastScan.current = null
      setCameraReady(false)
      setTorchEnabled(false)
      setError(null)
    }
  }, [visible])

  const grantPermission = async () => {
    setError(null)
    try {
      const result = await requestPermission()
      if (!result.granted) {
        setError(t(result.canAskAgain ? 'pos.cameraPermissionDenied' : 'pos.cameraPermissionSettings'))
      }
    } catch {
      setError(t('pos.cameraPermissionError'))
    }
  }

  const openSettings = async () => {
    try {
      await Linking.openSettings()
    } catch {
      setError(t('pos.cameraSettingsError'))
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{title ?? t('pos.scanTitle')}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={[styles.closeText, { color: colors.text }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
        {permission?.granted ? (
          <>
            <View style={styles.preview}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                enableTorch={torchEnabled}
                barcodeScannerSettings={{
                  barcodeTypes: [
                    'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39',
                    'code93', 'codabar', 'itf14', 'qr', 'pdf417', 'aztec', 'datamatrix',
                  ],
                }}
                onCameraReady={() => setCameraReady(true)}
                onBarcodeScanned={({ data }) => {
                  const value = data.trim()
                  if (!value) return
                  if (!continuous && scanned.current) return
                  const now = Date.now()
                  if (
                    continuous
                    && lastScan.current?.value === value
                    && now - lastScan.current.at < 1000
                  ) return
                  lastScan.current = { value, at: now }
                  if (!continuous) scanned.current = true
                  onScanned(value)
                }}
                onMountError={() => setError(t('pos.cameraUnavailable'))}
              />
              <View pointerEvents="none" style={styles.scanGuide}>
                <View style={[styles.scanFrame, { borderColor: colors.accent }]}>
                  <View style={[styles.scanLine, { backgroundColor: colors.accent }]} />
                </View>
                <Text style={styles.guideText}>{t('pos.scanAim')}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(torchEnabled ? 'pos.torchOff' : 'pos.torchOn')}
                accessibilityState={{ selected: torchEnabled }}
                onPress={() => setTorchEnabled((enabled) => !enabled)}
                style={[styles.torchButton, { backgroundColor: colors.surface }]}
              >
                <Text style={[styles.torchText, { color: colors.text }]}>
                  {t(torchEnabled ? 'pos.torchOff' : 'pos.torchOn')}
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.scanStatus, { color: colors.muted }]}>
              {cameraReady ? t('pos.scanReady') : t('pos.scanStarting')}
            </Text>
          </>
        ) : (
          <View style={styles.permission}>
            <Text style={[styles.message, { color: colors.text }]}>
              {permissionMessage ?? t('pos.cameraPermission')}
            </Text>
            <Button
              label={permission?.canAskAgain === false ? t('pos.openSettings') : t('pos.cameraAllow')}
              onPress={() => void (permission?.canAskAgain === false ? openSettings() : grantPermission())}
            />
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
  preview: { borderRadius: 16, flex: 1, overflow: 'hidden' },
  scanGuide: { alignItems: 'center', bottom: 56, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0 },
  scanFrame: { alignItems: 'center', borderRadius: 16, borderWidth: 3, height: 150, justifyContent: 'center', width: '84%' },
  scanLine: { height: 2, opacity: 0.9, width: '100%' },
  guideText: { backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginTop: 16, overflow: 'hidden', paddingHorizontal: 12, paddingVertical: 8, textAlign: 'center' },
  torchButton: { alignSelf: 'center', borderRadius: 20, bottom: 12, minHeight: 42, justifyContent: 'center', paddingHorizontal: 18, position: 'absolute' },
  torchText: { fontSize: 14, fontWeight: '700' },
  scanStatus: { fontSize: 13, paddingTop: 10, textAlign: 'center' },
  permission: { alignItems: 'center', flex: 1, gap: 20, justifyContent: 'center' },
  message: { fontSize: 16, textAlign: 'center' },
  error: { fontSize: 14, marginTop: 12, textAlign: 'center' },
})
