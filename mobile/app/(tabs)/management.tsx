import { useCallback, useState } from 'react'
import * as Crypto from 'expo-crypto'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSQLiteContext } from 'expo-sqlite'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button, Card, Field, LanguageSelector, LoadingState, PageTitle, Screen } from '@/src/components/NativeUi'
import * as Sharing from 'expo-sharing'
import { File } from 'expo-file-system'
import { createDatabaseBackup, restoreDatabaseBackup } from '@/src/services/backup'
import {
  createEmployee,
  createStore,
  getLocalPreferences,
  listEmployees,
  renameBusiness,
  saveLocalPreferences,
  updateEmployeeAccess,
  updateEmployeeProfile,
  type Employee,
  type LocalPreferences,
} from '@/src/repositories/administration'
import type { EmployeeRole } from '@/src/domain/validation'
import {
  getActiveWorkspace,
  listStores,
  switchStore,
  type Permission,
  type Store,
  type Workspace,
} from '@/src/repositories/workspace'
import { useTheme, type ThemeColors } from '@/src/theme/colors'
import { useI18n } from '@/src/i18n/I18nProvider'
import { translateRole, type TranslationKey } from '@/src/i18n/translations'

const PERMISSIONS: Permission[] = [
  'manage_business', 'manage_stores', 'manage_employees', 'manage_products',
  'manage_inventory', 'sell', 'view_reports', 'manage_settings',
  'view_dashboard', 'manage_finance', 'manage_customers', 'manage_suppliers',
]
const ROLES: EmployeeRole[] = ['manager', 'store_manager', 'cashier', 'accountant', 'inventory_manager']

export default function ManagementScreen() {
  const { colors, setMode } = useTheme()
  const { language, setLanguage, t, error: localizeError } = useI18n()
  const styles = createStyles(colors)
  const database = useSQLiteContext()
  const router = useRouter()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [stores, setStores] = useState<Store[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [allowedPermissions, setAllowedPermissions] = useState<Permission[]>([])
  const [canManageEmployees, setCanManageEmployees] = useState(false)
  const [preferences, setPreferences] = useState<LocalPreferences | null>(null)
  const [businessName, setBusinessName] = useState('')
  const [storeName, setStoreName] = useState('')
  const [storeCode, setStoreCode] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [employeeUsername, setEmployeeUsername] = useState('')
  const [employeePassword, setEmployeePassword] = useState('')
  const [employeeRole, setEmployeeRole] = useState<typeof ROLES[number]>('cashier')
  const [employeeStoreIds, setEmployeeStoreIds] = useState<string[]>([])
  const [employeePermissions, setEmployeePermissions] = useState<Permission[]>(['sell'])
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(null)
  const [editingEmployeeName, setEditingEmployeeName] = useState('')
  const [editingEmployeeRole, setEditingEmployeeRole] = useState<EmployeeRole>('cashier')
  const [replacementPassword, setReplacementPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ key: TranslationKey; values?: Record<string, string | number> } | null>(null)
  const [saving, setSaving] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
    const current = await getActiveWorkspace(database)
    setWorkspace(current)
    if (!current) {
      setStores([])
      setEmployees([])
      setAllowedPermissions([])
      setCanManageEmployees(false)
      setPreferences(null)
      return
    }
    const [availableStores, currentPreferences] = await Promise.all([
      listStores(database, current),
      getLocalPreferences(database, current),
    ])
    setStores(availableStores)
    setPreferences(currentPreferences)
    setBusinessName(current.businessName)
    setEmployeeStoreIds([current.storeId])
    const userPermissions = current.role === 'owner'
      ? PERMISSIONS
      : (await database.getAllAsync<{ permission: Permission }>(
        `SELECT permission FROM user_store_permissions
         WHERE business_id = ? AND store_id = ? AND user_id = ?`,
        current.businessId,
        current.storeId,
        current.userId,
      )).map(({ permission }) => permission)
    const employeePermission = userPermissions.includes('manage_employees')
    setAllowedPermissions(userPermissions)
    setCanManageEmployees(employeePermission)
    setEmployees(employeePermission ? await listEmployees(database, current) : [])
    } finally {
      setLoading(false)
    }
  }, [database])

  useFocusEffect(useCallback(() => {
    void load().catch((reason: unknown) => setError(
      localizeError(reason, 'management.loadError'),
    ))
  }, [load, localizeError]))

  const runAction = async (
    action: () => Promise<void>,
    successKey: TranslationKey,
    values?: Record<string, string | number>,
  ): Promise<boolean> => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await action()
      await load()
      setMessage({ key: successKey, values })
      return true
    } catch (reason) {
      setError(localizeError(reason, 'management.saveError'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveBusinessName = () => {
    if (!workspace) return
    void runAction(() => renameBusiness(database, workspace, businessName), 'management.savedBusiness')
  }

  const saveStore = () => {
    if (!workspace) return
    void runAction(
      () => createStore(database, workspace, { name: storeName, code: storeCode }, () => Crypto.randomUUID()),
      'management.storeAdded',
    ).then((saved) => {
      if (saved) {
        setStoreName('')
        setStoreCode('')
      }
    })
  }

  const saveEmployee = () => {
    if (!workspace) return
    void runAction(() => createEmployee(database, workspace, {
      displayName: employeeName,
      username: employeeUsername,
      password: employeePassword,
      role: employeeRole,
      storeIds: employeeStoreIds,
      permissions: employeePermissions,
    }, () => Crypto.randomUUID()), 'management.employeeCreated').then((saved) => {
      if (saved) {
        setEmployeeName('')
        setEmployeeUsername('')
        setEmployeePassword('')
      }
    })
  }

  const toggleEmployeePermission = (permission: Permission) => {
    setEmployeePermissions((current) => current.includes(permission)
      ? current.filter((value) => value !== permission)
      : [...current, permission])
  }

  const toggleEmployeeStore = (storeId: string) => {
    setEmployeeStoreIds((current) => current.includes(storeId)
      ? current.filter((value) => value !== storeId)
      : [...current, storeId])
  }

  const saveEmployeeChanges = (employee: Employee, isActive = Boolean(employee.isActive)) => {
    if (!workspace) return
    const storeIds = employee.storeIds ? employee.storeIds.split(',') : []
    const permissions = employee.permissions
      ? employee.permissions.split(',') as Permission[]
      : []
    void runAction(
      () => updateEmployeeAccess(database, workspace, employee.id, storeIds, permissions, isActive),
      isActive ? 'management.employeeAccessUpdated' : 'management.employeeAccessDisabled',
    )
  }

  const editEmployee = (employee: Employee) => {
    const expanded = expandedEmployeeId === employee.id
    setExpandedEmployeeId(expanded ? null : employee.id)
    if (!expanded) {
      setEditingEmployeeName(employee.displayName)
      setEditingEmployeeRole(employee.role as EmployeeRole)
      setReplacementPassword('')
    }
  }

  const saveEmployeeProfile = (employee: Employee) => {
    if (!workspace) return
    void runAction(
      () => updateEmployeeProfile(
        database,
        workspace,
        employee.id,
        editingEmployeeName,
        editingEmployeeRole,
        replacementPassword,
        () => Crypto.randomUUID(),
      ),
      'management.employeeProfileSaved',
    ).then((saved) => {
      if (saved) setReplacementPassword('')
    })
  }

  const savePreferences = (next: LocalPreferences) => {
    if (!workspace) return
    void runAction(
      async () => {
        await saveLocalPreferences(database, workspace, next)
        setMode(next.theme)
      },
      'management.savedSettings',
    )
  }

  const lockDevice = async () => {
    await database.runAsync("DELETE FROM app_settings WHERE setting_key = 'active_user_id'")
    router.replace('/login')
  }

  const confirmEmployeeStatus = (employee: Employee) => {
    if (!employee.isActive) {
      saveEmployeeChanges(employee, true)
      return
    }
    Alert.alert(
      t('common.disableEmployeeTitle'),
      t('common.disableEmployeeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('management.disableAccount'),
          style: 'destructive',
          onPress: () => saveEmployeeChanges(employee, false),
        },
      ],
    )
  }

  const selectLanguage = async (next: 'en' | 'sw') => {
    try {
      await setLanguage(next)
    } catch (reason) {
      setError(localizeError(reason, 'management.saveError'))
    }
  }

  const exportBackup = async () => {
    if (!workspace) return
    let file: File | null = null
    setBackupBusy(true)
    setError(null)
    try {
      file = await createDatabaseBackup(database, workspace, () => Crypto.randomUUID())
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/vnd.shopflow.backup',
        dialogTitle: t('management.backupShareTitle'),
      })
      setMessage({ key: 'management.backupCreated' })
    } catch (reason) {
      setError(localizeError(reason, 'management.backupError'))
    } finally {
      if (file?.exists) {
        try {
          await file.delete()
        } catch (reason) {
          setError(localizeError(reason, 'management.backupError'))
        }
      }
      setBackupBusy(false)
    }
  }

  const chooseBackup = async () => {
    try {
      const picked = await File.pickFileAsync({ mimeTypes: '*/*' })
      if (picked.canceled) return
      const bytes = await picked.result.bytes()
      Alert.alert(
        t('management.restoreTitle'),
        t('management.restoreConfirm'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('management.restore'),
            style: 'destructive',
            onPress: () => {
              if (!workspace) return
              setBackupBusy(true)
              setError(null)
              void restoreDatabaseBackup(database, workspace, bytes).then(async () => {
                Alert.alert(t('management.restoreComplete'))
                router.replace('/login')
              }).catch((reason: unknown) => {
                setError(localizeError(reason, 'management.backupError'))
              }).finally(() => setBackupBusy(false))
            },
          },
        ],
      )
    } catch (reason) {
      setError(localizeError(reason, 'management.backupError'))
    }
  }

  if (loading) return <Screen><LoadingState label={t('common.loading')} /></Screen>

  if (!workspace) {
    return <Screen><PageTitle title={t('management.home')} /><Card><Text style={styles.muted}>{t('management.localSignIn')}</Text></Card></Screen>
  }

  return (
    <Screen>
      <PageTitle title={t('management.title')} subtitle={t('management.subtitle', { name: workspace.userName, role: translateRole(language, workspace.role) })} />
      {allowedPermissions.includes('sell')
        || allowedPermissions.includes('manage_inventory')
        || allowedPermissions.includes('manage_customers')
        || allowedPermissions.includes('manage_suppliers') ? (
        <Button label={t('accounts.open')} secondary onPress={() => router.push('/accounts')} />
      ) : null}
      {allowedPermissions.includes('sell') || allowedPermissions.includes('view_reports') ? (
        <Button label={t('sales.open')} secondary onPress={() => router.push('./sales')} />
      ) : null}
      {allowedPermissions.includes('manage_settings') ? (
        <Button label={t('syncQueue.open')} secondary onPress={() => router.push('./sync')} />
      ) : null}
      {allowedPermissions.includes('sell')
        || allowedPermissions.includes('manage_inventory')
        || allowedPermissions.includes('manage_finance')
        || allowedPermissions.includes('view_reports') ? (
        <Button label={t('cashbook.open')} secondary onPress={() => router.push('/cashbook')} />
      ) : null}
      <Button
        label={t('reports.open')}
        secondary
        disabled={!allowedPermissions.includes('view_reports')}
        onPress={() => router.push('/reports')}
      />
      {!allowedPermissions.includes('view_reports') ? (
        <Text style={styles.muted}>{t('reports.permissionRequired')}</Text>
      ) : null}

      {allowedPermissions.includes('manage_business') ? <Card>
        <Text style={styles.sectionTitle}>{t('management.businessDetails')}</Text>
        <Field label={t('management.businessName')} value={businessName} onChangeText={setBusinessName} />
        <Button label={t('management.saveBusiness')} secondary onPress={saveBusinessName} disabled={saving} />
      </Card> : null}

      <Card>
        <Text style={styles.sectionTitle}>{t('management.stores')}</Text>
        <Text style={styles.muted}>{t('management.currentStore', { name: workspace.storeName })}</Text>
        {stores.map((store) => (
          <Button
            key={store.id}
            label={`${store.id === workspace.storeId ? '✓ ' : ''}${store.name} (${store.code})`}
            secondary
            onPress={() => {
              void runAction(
                async () => {
                  await switchStore(database, workspace, store.id)
                  const nextWorkspace = await getActiveWorkspace(database)
                  setWorkspace(nextWorkspace)
                },
                'management.switchedStore',
                { name: store.name },
              )
            }}
            disabled={saving || store.id === workspace.storeId}
          />
        ))}
        {allowedPermissions.includes('manage_stores') ? (
          <>
            <Field label={t('management.newStoreName')} value={storeName} onChangeText={setStoreName} />
            <Field label={t('management.storeCode')} value={storeCode} onChangeText={setStoreCode} autoCapitalize="characters" />
            <Button label={t('management.addStore')} onPress={saveStore} disabled={saving} />
          </>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionTitle}>{t('management.employees')}</Text>
        {canManageEmployees ? (
        <>
        {employees.length === 0
          ? <Text style={styles.muted}>{t('management.noEmployees')}</Text>
          : employees.map((employee) => (
            <View key={employee.id} style={styles.employeeBlock}>
              <Pressable onPress={() => editEmployee(employee)}>
                <Text style={styles.employeeName}>
                  {employee.displayName} · {employee.isActive ? t('common.active') : t('common.disabled')}
                </Text>
                <Text style={styles.muted}>@{employee.username} · {translateRole(language, employee.role)} · {employee.stores || t('common.noStores')}</Text>
              </Pressable>
              {expandedEmployeeId === employee.id ? (
                <>
                  <Field label={t('management.employeeName')} value={editingEmployeeName} onChangeText={setEditingEmployeeName} />
                  <Text style={styles.label}>{t('management.role')}</Text>
                  <View style={styles.chipRow}>
                    {ROLES.map((role) => (
                      <Chip
                        key={role}
                        label={translateRole(language, role)}
                        selected={editingEmployeeRole === role}
                        onPress={() => setEditingEmployeeRole(role)}
                      />
                    ))}
                  </View>
                  <Field
                    label={t('management.newPasswordKeep')}
                    value={replacementPassword}
                    onChangeText={setReplacementPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <Button label={t('management.saveProfile')} secondary onPress={() => saveEmployeeProfile(employee)} disabled={saving} />
                  <Text style={styles.label}>{t('management.assignedStores')}</Text>
                  <View style={styles.chipRow}>
                    {stores.map((store) => (
                      <Chip
                        key={store.id}
                        label={store.name}
                        selected={employee.storeIds.split(',').includes(store.id)}
                        onPress={() => {
                          const currentStores = employee.storeIds ? employee.storeIds.split(',') : []
                          const currentPermissions = employee.permissions ? employee.permissions.split(',') as Permission[] : []
                          const nextStores = currentStores.includes(store.id)
                            ? currentStores.filter((id) => id !== store.id)
                            : [...currentStores, store.id]
                          void runAction(
                            () => updateEmployeeAccess(database, workspace, employee.id, nextStores, currentPermissions, Boolean(employee.isActive)),
                            'management.storeAssignmentsUpdated',
                          )
                        }}
                      />
                    ))}
                  </View>
                  <Text style={styles.label}>{t('management.permissions')}</Text>
                  <View style={styles.chipRow}>
                    {PERMISSIONS.map((id) => (
                      <Chip
                        key={id}
                        label={t(`permissions.${id}`)}
                        selected={employee.permissions.split(',').includes(id)}
                        onPress={() => {
                          const currentStores = employee.storeIds ? employee.storeIds.split(',') : []
                          const currentPermissions = employee.permissions ? employee.permissions.split(',') as Permission[] : []
                          const nextPermissions = currentPermissions.includes(id)
                            ? currentPermissions.filter((permission) => permission !== id)
                            : [...currentPermissions, id]
                          void runAction(
                            () => updateEmployeeAccess(database, workspace, employee.id, currentStores, nextPermissions, Boolean(employee.isActive)),
                            'management.permissionsUpdated',
                          )
                        }}
                      />
                    ))}
                  </View>
                  <Button
                    label={employee.isActive ? t('management.disableAccount') : t('management.enableAccount')}
                    secondary
                    onPress={() => confirmEmployeeStatus(employee)}
                    disabled={saving}
                  />
                </>
              ) : null}
            </View>
          ))}
        <Text style={styles.label}>{t('management.newEmployee')}</Text>
        <Field label={t('management.fullName')} value={employeeName} onChangeText={setEmployeeName} autoCapitalize="words" />
        <Field label={t('auth.username')} value={employeeUsername} onChangeText={setEmployeeUsername} autoCapitalize="none" autoCorrect={false} />
        <Field label={t('management.passwordHint')} value={employeePassword} onChangeText={setEmployeePassword} secureTextEntry autoCapitalize="none" />
        <View style={styles.chipRow}>
          {ROLES.map((role) => (
            <Chip key={role} label={translateRole(language, role)} selected={employeeRole === role} onPress={() => setEmployeeRole(role)} />
          ))}
        </View>
        <Text style={styles.label}>{t('management.storeAssignments')}</Text>
        <View style={styles.chipRow}>
          {stores.map((store) => (
            <Chip key={store.id} label={store.name} selected={employeeStoreIds.includes(store.id)} onPress={() => toggleEmployeeStore(store.id)} />
          ))}
        </View>
        <Text style={styles.label}>{t('management.allowedOperations')}</Text>
        <View style={styles.chipRow}>
          {PERMISSIONS.map((id) => (
            <Chip key={id} label={t(`permissions.${id}`)} selected={employeePermissions.includes(id)} onPress={() => toggleEmployeePermission(id)} />
          ))}
        </View>
        <Button label={t('management.createEmployee')} onPress={saveEmployee} disabled={saving} />
        </>
        ) : <Text style={styles.muted}>{t('management.noEmployeePermission')}</Text>}
      </Card>

      {preferences ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('management.settings')}</Text>
          <Text style={styles.label}>{t('common.language')}</Text>
          <View style={styles.chipRow}>
            {(['en', 'sw'] as const).map((option) => (
              <Chip
                key={option}
                label={t(option === 'en' ? 'common.english' : 'common.swahili')}
                selected={language === option}
                onPress={() => void selectLanguage(option)}
              />
            ))}
          </View>
          {allowedPermissions.includes('manage_settings') ? (
          <>
          <Text style={styles.label}>{t('management.salesMode')}</Text>
          <View style={styles.chipRow}>
            <Chip
              label={t('management.inventoryTracking')}
              selected={preferences.trackingMode === 'inventory'}
              onPress={() => savePreferences({ ...preferences, inventoryTracking: true, trackingMode: 'inventory' })}
            />
            <Chip
              label={t('management.simpleSales')}
              selected={preferences.trackingMode === 'simple_sales'}
              onPress={() => savePreferences({ ...preferences, inventoryTracking: false, trackingMode: 'simple_sales' })}
            />
          </View>
          <Text style={styles.muted}>
            {t('management.simpleSalesNote')}
          </Text>
          </>
          ) : null}
        </Card>
      ) : null}

      {allowedPermissions.includes('manage_settings') ? (
        <Card>
          <Text style={styles.sectionTitle}>{t('management.backupTitle')}</Text>
          <Text style={styles.muted}>{t('management.backupWarning')}</Text>
          <Button
            label={backupBusy ? t('management.backupWorking') : t('management.backupExport')}
            onPress={() => void exportBackup()}
            disabled={backupBusy || saving}
            secondary
          />
          <Button
            label={backupBusy ? t('management.backupWorking') : t('management.backupRestore')}
            onPress={() => void chooseBackup()}
            disabled={backupBusy || saving}
            secondary
          />
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.success}>{t(message.key, message.values)}</Text> : null}
      <Button label={t('management.lockEmployee')} secondary onPress={() => void lockDevice()} />
    </Screen>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selectedChip]}
    >
      <Text style={[styles.chipText, selected && styles.selectedChipText]}>{label}</Text>
    </Pressable>
  )
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
    label: { color: colors.text, fontSize: 14, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    employeeBlock: { borderTopColor: colors.border, borderTopWidth: 1, gap: 10, paddingVertical: 12 },
    employeeName: { color: colors.text, fontSize: 15, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
    selectedChip: { backgroundColor: colors.accentSurface, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
    selectedChipText: { color: colors.accentPressed },
    error: { color: colors.danger, fontSize: 14 },
    success: { color: colors.success, fontSize: 14 },
  })
}
