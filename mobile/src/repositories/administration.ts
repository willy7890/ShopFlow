import type { SQLiteDatabase } from 'expo-sqlite'
import { withDatabaseTransaction } from '../database/transactions.ts'
import { createPasswordHash } from '../domain/credentials.ts'
import {
  employeeInput,
  employeeRole,
  storeInput,
  type EmployeeInput,
  type EmployeeRole,
  type StoreInput,
} from '../domain/validation.ts'
import type { Workspace, Permission } from './workspace.ts'
import { assertActiveWorkspace, assertPermission } from './workspace.ts'

export interface Employee {
  id: string
  displayName: string
  username: string
  role: string
  isActive: number
  stores: string
  storeIds: string
  permissions: string
}

export interface LocalPreferences {
  theme: 'light' | 'dark'
  inventoryTracking: boolean
  trackingMode: 'inventory' | 'simple_sales'
}

const PERMISSIONS: Permission[] = [
  'manage_business', 'manage_stores', 'manage_employees', 'manage_products',
  'manage_inventory', 'sell', 'view_reports', 'manage_settings',
  'view_dashboard', 'manage_finance', 'manage_customers', 'manage_suppliers',
]

export async function createStore(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: StoreInput,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_stores')
  const parsed = storeInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Store details are invalid.')
  const duplicateCode = await database.getFirstAsync<{ id: string }>(
    'SELECT id FROM stores WHERE business_id = ? AND code = ? COLLATE NOCASE',
    workspace.businessId,
    parsed.data.code,
  )
  if (duplicateCode) throw new Error('That store code is already in use.')
  const storeId = createId()
  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO stores (id, business_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)',
      storeId,
      workspace.businessId,
      parsed.data.name,
      parsed.data.code.toUpperCase(),
      new Date().toISOString(),
    )
    for (const permission of PERMISSIONS) {
      await transaction.runAsync(
        `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
         VALUES (?, ?, ?, ?)`,
        workspace.businessId,
        workspace.ownerId,
        storeId,
        permission,
      )
    }
    if (workspace.userId !== workspace.ownerId) {
      await transaction.runAsync(
        `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
         VALUES (?, ?, ?, 'manage_stores')`,
        workspace.businessId,
        workspace.userId,
        storeId,
      )
    }
  })
}

export async function listEmployees(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<Employee[]> {
  await assertPermission(database, workspace, 'manage_employees')
  return database.getAllAsync<Employee>(
    `SELECT users.id, users.display_name AS displayName, users.username,
       users.role, users.is_active AS isActive,
       COALESCE(GROUP_CONCAT(DISTINCT stores.name), '') AS stores,
       COALESCE(GROUP_CONCAT(DISTINCT stores.id), '') AS storeIds,
       COALESCE(GROUP_CONCAT(DISTINCT assignment.permission), '') AS permissions
     FROM users
     LEFT JOIN user_store_permissions AS assignment ON assignment.user_id = users.id
       AND assignment.business_id = users.business_id
     LEFT JOIN stores ON stores.id = assignment.store_id AND stores.is_active = 1
     WHERE users.business_id = ? AND users.role != 'owner'
     GROUP BY users.id ORDER BY users.display_name COLLATE NOCASE`,
    workspace.businessId,
  )
}

export async function createEmployee(
  database: SQLiteDatabase,
  workspace: Workspace,
  input: EmployeeInput,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_employees')
  const parsed = employeeInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Employee details are invalid.')

  const ids = await database.getAllAsync<{ id: string }>(
    `SELECT id FROM stores WHERE business_id = ? AND is_active = 1
     AND id IN (${parsed.data.storeIds.map(() => '?').join(',')})`,
    workspace.businessId,
    ...parsed.data.storeIds,
  )
  if (ids.length !== new Set(parsed.data.storeIds).size) {
    throw new Error('Choose only active stores belonging to this business.')
  }

  const userId = createId()
  const now = new Date().toISOString()
  const credentials = await createPasswordHash(parsed.data.password, createId())
  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      `INSERT INTO users
         (id, business_id, display_name, role, username, password_salt, password_hash,
          password_iterations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      workspace.businessId,
      parsed.data.displayName,
      parsed.data.role,
      parsed.data.username.trim().toLowerCase(),
      credentials.salt,
      credentials.hash,
      credentials.iterations,
      now,
    )
    for (const storeId of parsed.data.storeIds) {
      for (const permission of parsed.data.permissions) {
        await transaction.runAsync(
          `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
           VALUES (?, ?, ?, ?)`,
          workspace.businessId,
          userId,
          storeId,
          permission,
        )
      }
    }
  })
}

export async function updateEmployeeAccess(
  database: SQLiteDatabase,
  workspace: Workspace,
  employeeId: string,
  storeIds: string[],
  permissions: Permission[],
  isActive: boolean,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_employees')
  const employee = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM users
     WHERE id = ? AND business_id = ? AND role != 'owner'`,
    employeeId,
    workspace.businessId,
  )
  if (!employee) throw new Error('Employee does not belong to this business.')
  if (storeIds.length === 0 && isActive) throw new Error('An active employee needs at least one assigned store.')
  if (permissions.length === 0 && isActive) throw new Error('An active employee needs at least one permission.')
  if (permissions.some((permission) => !PERMISSIONS.includes(permission))) {
    throw new Error('One or more selected permissions are invalid.')
  }
  const uniqueStoreIds = [...new Set(storeIds)]
  if (uniqueStoreIds.length) {
    const placeholders = uniqueStoreIds.map(() => '?').join(',')
    const stores = await database.getAllAsync<{ id: string }>(
      `SELECT id FROM stores WHERE business_id = ? AND is_active = 1 AND id IN (${placeholders})`,
      workspace.businessId,
      ...uniqueStoreIds,
    )
    if (stores.length !== uniqueStoreIds.length) throw new Error('Choose only active stores in this business.')
  }
  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync('DELETE FROM user_store_permissions WHERE user_id = ?', employeeId)
    for (const storeId of uniqueStoreIds) {
      for (const permission of permissions) {
        await transaction.runAsync(
          `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
           VALUES (?, ?, ?, ?)`,
          workspace.businessId,
          employeeId,
          storeId,
          permission,
        )
      }
    }
    await transaction.runAsync(
      'UPDATE users SET is_active = ? WHERE id = ?',
      isActive ? 1 : 0,
      employeeId,
    )
  })
}

export async function updateEmployeeProfile(
  database: SQLiteDatabase,
  workspace: Workspace,
  employeeId: string,
  displayName: string,
  role: EmployeeRole,
  newPassword: string,
  createId: () => string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_employees')
  const employee = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM users WHERE id = ? AND business_id = ? AND role != 'owner'`,
    employeeId,
    workspace.businessId,
  )
  if (!employee) throw new Error('Employee does not belong to this business.')
  const name = displayName.trim()
  if (name.length < 2 || name.length > 160) throw new Error('Employee name must contain 2 to 160 characters.')
  const parsedRole = employeeRole.safeParse(role)
  if (!parsedRole.success) throw new Error('Choose a valid employee role.')
  if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
    throw new Error('A replacement password must be between 8 and 128 characters.')
  }

  if (newPassword) {
    const credentials = await createPasswordHash(newPassword, createId())
    await database.runAsync(
      `UPDATE users SET display_name = ?, role = ?, password_salt = ?, password_hash = ?,
       password_iterations = ?, failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      name,
      parsedRole.data,
      credentials.salt,
      credentials.hash,
      credentials.iterations,
      employeeId,
    )
  } else {
    await database.runAsync(
      'UPDATE users SET display_name = ?, role = ? WHERE id = ?',
      name,
      parsedRole.data,
      employeeId,
    )
  }
}

export async function getLocalPreferences(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<LocalPreferences> {
  await assertActiveWorkspace(database, workspace)
  const rows = await database.getAllAsync<{ settingKey: string; settingValue: string }>(
    `SELECT setting_key AS settingKey, setting_value AS settingValue FROM app_settings
     WHERE setting_key = 'theme'`,
  )
  const preferences = Object.fromEntries(rows.map(({ settingKey, settingValue }) => [settingKey, settingValue]))
  const business = await database.getFirstAsync<{ trackingMode: 'inventory' | 'simple_sales' }>(
    'SELECT tracking_mode AS trackingMode FROM businesses WHERE id = ?',
    workspace.businessId,
  )
  return {
    theme: preferences.theme === 'dark' ? 'dark' : 'light',
    inventoryTracking: business?.trackingMode === 'inventory',
    trackingMode: business?.trackingMode ?? 'inventory',
  }
}

export async function saveLocalPreferences(
  database: SQLiteDatabase,
  workspace: Workspace,
  preferences: LocalPreferences,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_settings')
  if (
    !['light', 'dark'].includes(preferences.theme)
    || !['inventory', 'simple_sales'].includes(preferences.trackingMode)
    || preferences.inventoryTracking !== (preferences.trackingMode === 'inventory')
  ) {
    throw new Error('Choose a valid, consistent appearance and sales mode.')
  }
  await withDatabaseTransaction(database, async (transaction) => {
    for (const [key, value] of [['theme', preferences.theme]]) {
      await transaction.runAsync(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        key,
        value,
      )
    }
    await transaction.runAsync(
      'UPDATE product_variants SET track_stock = ? WHERE business_id = ?',
      preferences.trackingMode === 'inventory' ? 1 : 0,
      workspace.businessId,
    )
    if (preferences.trackingMode === 'inventory') {
      await transaction.runAsync(
        `INSERT OR IGNORE INTO inventory_balances
           (id, business_id, store_id, variant_id, quantity, updated_at)
         SELECT lower(hex(randomblob(16))), ?, stores.id, product_variants.id, 0, ?
         FROM stores CROSS JOIN product_variants
         WHERE stores.business_id = ? AND product_variants.business_id = ?`,
        workspace.businessId,
        new Date().toISOString(),
        workspace.businessId,
        workspace.businessId,
      )
    }
    await transaction.runAsync(
      'UPDATE businesses SET tracking_mode = ? WHERE id = ?',
      preferences.trackingMode,
      workspace.businessId,
    )
  })
}

export async function renameBusiness(
  database: SQLiteDatabase,
  workspace: Workspace,
  name: string,
): Promise<void> {
  await assertPermission(database, workspace, 'manage_business')
  const normalized = name.trim()
  if (normalized.length < 2 || normalized.length > 180) {
    throw new Error('Business name must contain 2 to 180 characters.')
  }
  await database.runAsync('UPDATE businesses SET name = ? WHERE id = ?', normalized, workspace.businessId)
}
