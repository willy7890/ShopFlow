import type { SQLiteDatabase } from 'expo-sqlite'
import { withDatabaseTransaction } from '../database/transactions.ts'
import { workspaceInput, type WorkspaceInput } from '../domain/validation.ts'
import { createPasswordHash, verifyPasswordHash } from '../domain/credentials.ts'
import type { ApiUser, BusinessAccess } from '../services/api.ts'

export type Permission =
  | 'manage_business'
  | 'manage_stores'
  | 'manage_employees'
  | 'manage_products'
  | 'manage_inventory'
  | 'sell'
  | 'view_reports'
  | 'view_dashboard'
  | 'manage_finance'
  | 'manage_customers'
  | 'manage_suppliers'
  | 'manage_settings'

export interface Workspace {
  businessId: string
  businessName: string
  storeId: string
  storeName: string
  ownerId: string
  ownerName: string
  userId: string
  userName: string
  role: string
}

export interface Store {
  id: string
  name: string
  code: string
  isActive: number
}

export interface LoginState {
  hasBusiness: boolean
  hasCredentiallessOwner: boolean
}

const ALL_PERMISSIONS: Permission[] = [
  'manage_business', 'manage_stores', 'manage_employees', 'manage_products',
  'manage_inventory', 'sell', 'view_reports', 'manage_settings',
  'view_dashboard', 'manage_finance', 'manage_customers', 'manage_suppliers',
]

export async function getActiveWorkspace(database: SQLiteDatabase): Promise<Workspace | null> {
  return database.getFirstAsync<Workspace>(
    `SELECT
       businesses.id AS businessId,
       businesses.name AS businessName,
       stores.id AS storeId,
       stores.name AS storeName,
       COALESCE(owner.id, user.id) AS ownerId,
       COALESCE(owner.display_name, user.display_name) AS ownerName,
       user.id AS userId,
       user.display_name AS userName,
       user.role AS role
     FROM app_settings AS business_setting
     JOIN businesses ON businesses.id = business_setting.setting_value
     JOIN app_settings AS store_setting
       ON store_setting.setting_key = 'active_store_id'
     JOIN stores ON stores.id = store_setting.setting_value
       AND stores.business_id = businesses.id AND stores.is_active = 1
     JOIN app_settings AS user_setting
       ON user_setting.setting_key = 'active_user_id'
     JOIN users AS user ON user.id = user_setting.setting_value
       AND user.business_id = businesses.id AND user.is_active = 1
     LEFT JOIN users AS owner ON owner.business_id = businesses.id AND owner.role = 'owner'
     LEFT JOIN user_store_permissions AS assignment ON assignment.user_id = user.id
       AND assignment.store_id = stores.id AND assignment.business_id = businesses.id
     WHERE business_setting.setting_key = 'active_business_id'
     ORDER BY owner.created_at
     LIMIT 1`,
  )
}

export async function activateRemoteWorkspace(
  database: SQLiteDatabase,
  user: ApiUser,
  access: BusinessAccess,
  storeId: string,
): Promise<void> {
  if (access.currency !== 'TZS') {
    throw new Error(`This mobile release supports TZS workspaces only; ${access.currency} is not supported offline yet.`)
  }
  const stores = access.stores.filter((store) => access.store_ids.includes(store.id))
  const selectedStore = stores.find((store) => store.id === storeId)
  if (!selectedStore) throw new Error('This business has no active store assigned to your account.')
  const roles = new Set(['owner', 'manager', 'store_manager', 'cashier', 'accountant', 'inventory_manager'])
  const role = roles.has(access.role) ? access.role : 'cashier'
  const localPermissionMap: Record<string, Permission> = {
    manage_business: 'manage_business',
    manage_stores: 'manage_stores',
    manage_employees: 'manage_employees',
    manage_products: 'manage_products',
    manage_inventory: 'manage_inventory',
    manage_sales: 'sell',
    view_reports: 'view_reports',
    view_dashboard: 'view_dashboard',
    manage_finance: 'manage_finance',
    manage_customers: 'manage_customers',
    manage_suppliers: 'manage_suppliers',
    manage_settings: 'manage_settings',
  }
  const now = new Date().toISOString()

  await withDatabaseTransaction(database, async (transaction) => {
    const activeContext = await transaction.getFirstAsync<{ setting_value: string }>(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
    )
    if (activeContext?.setting_value !== 'online') {
      for (const [activeKey, localKey] of [
        ['active_business_id', 'local_active_business_id'],
        ['active_store_id', 'local_active_store_id'],
        ['active_user_id', 'local_active_user_id'],
      ]) {
        const current = await transaction.getFirstAsync<{ setting_value: string }>(
          'SELECT setting_value FROM app_settings WHERE setting_key = ?',
          activeKey,
        )
        if (current) {
          await transaction.runAsync(
            `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
             ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
            localKey,
            current.setting_value,
          )
        } else {
          await transaction.runAsync('DELETE FROM app_settings WHERE setting_key = ?', localKey)
        }
      }
    }
    await transaction.runAsync(
      `INSERT INTO businesses (id, name, currency, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, currency = excluded.currency`,
      access.business_id,
      access.business_name,
      access.currency,
      now,
    )
    for (const store of stores) {
      await transaction.runAsync(
        `INSERT INTO stores (id, business_id, name, code, is_active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, code = excluded.code, is_active = 1`,
        store.id,
        access.business_id,
        store.name,
        store.code,
        now,
      )
    }
    await transaction.runAsync(
      `INSERT INTO users (id, business_id, display_name, role, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, is_active = 1`,
      user.id,
      access.business_id,
      user.full_name,
      role,
      now,
    )
    await transaction.runAsync(
      'DELETE FROM user_store_permissions WHERE business_id = ? AND user_id = ?',
      access.business_id,
      user.id,
    )
    const grantedPermissions = access.role === 'owner'
      ? ALL_PERMISSIONS
      : access.permissions.map((permission) => localPermissionMap[permission]).filter(
        (permission): permission is Permission => Boolean(permission),
      )
    for (const storeId of access.store_ids) {
      for (const permission of grantedPermissions) {
        if (!stores.some((store) => store.id === storeId)) continue
        await transaction.runAsync(
          `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
           VALUES (?, ?, ?, ?)`,
          access.business_id,
          user.id,
          storeId,
          permission,
        )
      }
    }
    for (const [key, value] of [
      ['active_business_id', access.business_id],
      ['active_store_id', selectedStore.id],
      ['active_user_id', user.id],
      ['active_context', 'online'],
    ]) {
      await transaction.runAsync(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        key,
        value,
      )
    }
  })
}

export async function restoreLocalWorkspace(database: SQLiteDatabase): Promise<void> {
  await withDatabaseTransaction(database, async (transaction) => {
    const activeContext = await transaction.getFirstAsync<{ setting_value: string }>(
      "SELECT setting_value FROM app_settings WHERE setting_key = 'active_context'",
    )
    if (activeContext?.setting_value !== 'online') return

    for (const [activeKey, localKey] of [
      ['active_business_id', 'local_active_business_id'],
      ['active_store_id', 'local_active_store_id'],
      ['active_user_id', 'local_active_user_id'],
    ]) {
      const localValue = await transaction.getFirstAsync<{ setting_value: string }>(
        'SELECT setting_value FROM app_settings WHERE setting_key = ?',
        localKey,
      )
      if (localValue) {
        await transaction.runAsync(
          `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
           ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
          activeKey,
          localValue.setting_value,
        )
      } else {
        await transaction.runAsync('DELETE FROM app_settings WHERE setting_key = ?', activeKey)
      }
      await transaction.runAsync('DELETE FROM app_settings WHERE setting_key = ?', localKey)
    }
    await transaction.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_context', 'local')
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    )
  })
}

export async function createWorkspace(
  database: SQLiteDatabase,
  input: WorkspaceInput,
  createId: () => string,
): Promise<Workspace> {
  const parsed = workspaceInput.safeParse(input)
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Business setup details are invalid.')
  const businessId = createId()
  const storeId = createId()
  const ownerId = createId()
  const now = new Date().toISOString()
  const credentials = await createPasswordHash(parsed.data.ownerPassword, createId())

  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      'INSERT INTO businesses (id, name, created_at) VALUES (?, ?, ?)',
      businessId,
      parsed.data.businessName,
      now,
    )
    await transaction.runAsync(
      'INSERT INTO stores (id, business_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)',
      storeId,
      businessId,
      parsed.data.storeName,
      'MAIN',
      now,
    )
    await transaction.runAsync(
      `INSERT INTO users
         (id, business_id, display_name, role, username, password_salt, password_hash,
          password_iterations, created_at)
       VALUES (?, ?, ?, 'owner', ?, ?, ?, ?, ?)`,
      ownerId,
      businessId,
      parsed.data.ownerName,
      parsed.data.ownerUsername.trim().toLowerCase(),
      credentials.salt,
      credentials.hash,
      credentials.iterations,
      now,
    )
    for (const permission of ALL_PERMISSIONS) {
      await transaction.runAsync(
        `INSERT INTO user_store_permissions (business_id, user_id, store_id, permission)
         VALUES (?, ?, ?, ?)`,
        businessId,
        ownerId,
        storeId,
        permission,
      )
    }
    for (const [key, value] of [
      ['active_business_id', businessId],
      ['active_store_id', storeId],
      ['active_user_id', ownerId],
      ['active_context', 'local'],
    ]) {
      await transaction.runAsync(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        key,
        value,
      )
    }
  })

  return {
    businessId,
    businessName: parsed.data.businessName,
    storeId,
    storeName: parsed.data.storeName,
    ownerId,
    ownerName: parsed.data.ownerName,
    userId: ownerId,
    userName: parsed.data.ownerName,
    role: 'owner',
  }
}

export async function assertPermission(
  database: SQLiteDatabase,
  workspace: Workspace,
  permission: Permission,
): Promise<void> {
  if (!(await hasPermission(database, workspace, permission))) {
    throw new Error('You do not have permission to perform this action in the selected store.')
  }
}

export async function assertAnyPermission(
  database: SQLiteDatabase,
  workspace: Workspace,
  permissions: Permission[],
): Promise<void> {
  const activeRole = await assertActiveWorkspace(database, workspace)
  if (activeRole === 'owner') return
  if (permissions.length === 0) throw new Error('At least one permission is required.')
  const placeholders = permissions.map(() => '?').join(', ')
  const allowed = await database.getFirstAsync<{ allowed: number }>(
    `SELECT 1 AS allowed
     FROM user_store_permissions
     WHERE business_id = ? AND store_id = ? AND user_id = ?
       AND permission IN (${placeholders})
     LIMIT 1`,
    workspace.businessId,
    workspace.storeId,
    workspace.userId,
    ...permissions,
  )
  if (!allowed) throw new Error('You do not have permission to perform this action in the selected store.')
}

export async function hasPermission(
  database: SQLiteDatabase,
  workspace: Workspace,
  permission: Permission,
): Promise<boolean> {
  const activeRole = await assertActiveWorkspace(database, workspace)
  if (activeRole === 'owner') return true
  const allowed = await database.getFirstAsync<{ allowed: number }>(
    `SELECT 1 AS allowed
     FROM user_store_permissions
     WHERE business_id = ? AND store_id = ? AND user_id = ? AND permission = ?`,
    workspace.businessId,
    workspace.storeId,
    workspace.userId,
    permission,
  )
  return Boolean(allowed)
}

export async function assertActiveWorkspace(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<string> {
  const active = await database.getFirstAsync<{ id: string; role: string }>(
    `SELECT users.id, users.role FROM users
     JOIN app_settings AS business_setting ON business_setting.setting_key = 'active_business_id'
       AND business_setting.setting_value = users.business_id
     JOIN app_settings AS user_setting ON user_setting.setting_key = 'active_user_id'
       AND user_setting.setting_value = users.id
     JOIN app_settings AS store_setting ON store_setting.setting_key = 'active_store_id'
       AND store_setting.setting_value = ?
     JOIN stores ON stores.id = store_setting.setting_value
       AND stores.business_id = users.business_id AND stores.is_active = 1
     WHERE users.id = ? AND users.business_id = ? AND users.is_active = 1`,
    workspace.storeId,
    workspace.userId,
    workspace.businessId,
  )
  if (!active) throw new Error('The active local session or store has changed. Sign in again.')
  return active.role
}

export async function listStores(
  database: SQLiteDatabase,
  workspace: Workspace,
): Promise<Store[]> {
  await assertActiveWorkspace(database, workspace)
  return database.getAllAsync<Store>(
    `SELECT stores.id, stores.name, stores.code, stores.is_active AS isActive
     FROM stores
     JOIN user_store_permissions AS assignments ON assignments.store_id = stores.id
       AND assignments.user_id = ? AND assignments.business_id = stores.business_id
     WHERE stores.business_id = ?
     GROUP BY stores.id
     ORDER BY stores.name COLLATE NOCASE`,
    workspace.userId,
    workspace.businessId,
  )
}

export async function switchStore(
  database: SQLiteDatabase,
  workspace: Workspace,
  storeId: string,
): Promise<void> {
  await assertActiveWorkspace(database, workspace)
  const store = await database.getFirstAsync<{ id: string }>(
    `SELECT stores.id FROM stores
     JOIN user_store_permissions AS assignments ON assignments.store_id = stores.id
       AND assignments.user_id = ? AND assignments.business_id = stores.business_id
     WHERE stores.id = ? AND stores.business_id = ? AND stores.is_active = 1
     LIMIT 1`,
    workspace.userId,
    storeId,
    workspace.businessId,
  )
  if (!store) throw new Error('This user is not assigned to the selected store.')
  await database.runAsync(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_store_id', ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    storeId,
  )
}

export async function authenticateUser(
  database: SQLiteDatabase,
  username: string,
  password: string,
): Promise<void> {
  const businessId = await database.getFirstAsync<{ setting_value: string }>(
    `SELECT setting_value FROM app_settings WHERE setting_key = 'active_business_id'`,
  )
  if (!businessId) throw new Error('Set up a business before signing in.')
  const normalized = username.trim().toLowerCase()
  const user = await database.getFirstAsync<{
    id: string
    passwordSalt: string | null
    passwordHash: string | null
    passwordIterations: number
    failedAttempts: number
    lockedUntil: string | null
  }>(
    `SELECT id, password_salt AS passwordSalt, password_hash AS passwordHash,
       password_iterations AS passwordIterations,
       failed_login_attempts AS failedAttempts, locked_until AS lockedUntil
     FROM users WHERE business_id = ? AND username = ? AND is_active = 1`,
    businessId.setting_value,
    normalized,
  )
  if (!user?.passwordSalt || !user.passwordHash) throw new Error('Username or password is incorrect.')
  if (user.lockedUntil && user.lockedUntil > new Date().toISOString()) {
    throw new Error('Sign-in is temporarily locked after repeated failed attempts. Try again later.')
  }

  const candidate = await verifyPasswordHash(password, user.passwordSalt, user.passwordIterations)
  if (candidate !== user.passwordHash) {
    const failedAttempts = user.failedAttempts + 1
    const lockedUntil = failedAttempts >= 5
      ? new Date(Date.now() + 60_000).toISOString()
      : null
    await database.runAsync(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`,
      lockedUntil ? 0 : failedAttempts,
      lockedUntil,
      user.id,
    )
    throw new Error('Username or password is incorrect.')
  }

  const assignedStore = await database.getFirstAsync<{ storeId: string }>(
    `SELECT stores.id AS storeId FROM stores
     JOIN user_store_permissions AS assignment ON assignment.store_id = stores.id
       AND assignment.user_id = ? AND assignment.business_id = stores.business_id
     WHERE stores.business_id = ? AND stores.is_active = 1
     ORDER BY stores.created_at LIMIT 1`,
    user.id,
    businessId.setting_value,
  )
  if (!assignedStore) throw new Error('This account is not assigned to an active store.')

  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      user.id,
    )
    for (const [key, value] of [
      ['active_user_id', user.id],
      ['active_store_id', assignedStore.storeId],
    ]) {
      await transaction.runAsync(
        `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
        key,
        value,
      )
    }
  })
}

export async function clearActiveSession(database: SQLiteDatabase): Promise<void> {
  await database.runAsync("DELETE FROM app_settings WHERE setting_key = 'active_user_id'")
}

export async function getLoginState(database: SQLiteDatabase): Promise<LoginState> {
  const business = await database.getFirstAsync<{ id: string }>(
    `SELECT businesses.id FROM businesses
     JOIN app_settings ON app_settings.setting_key = 'active_business_id'
       AND app_settings.setting_value = businesses.id LIMIT 1`,
  )
  if (!business) return { hasBusiness: false, hasCredentiallessOwner: false }
  const owner = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM users WHERE business_id = ? AND role = 'owner' AND is_active = 1
      AND (username IS NULL OR password_hash IS NULL) LIMIT 1`,
    business.id,
  )
  return { hasBusiness: true, hasCredentiallessOwner: Boolean(owner) }
}

export async function initializeLegacyOwnerCredentials(
  database: SQLiteDatabase,
  displayName: string,
  username: string,
  password: string,
  createId: () => string,
): Promise<void> {
  const business = await database.getFirstAsync<{ id: string }>(
    `SELECT businesses.id FROM businesses
     JOIN app_settings ON app_settings.setting_key = 'active_business_id'
       AND app_settings.setting_value = businesses.id LIMIT 1`,
  )
  if (!business) throw new Error('No existing local business was found.')
  const owner = await database.getFirstAsync<{ id: string }>(
    `SELECT id FROM users WHERE business_id = ? AND role = 'owner' AND is_active = 1
      AND (username IS NULL OR password_hash IS NULL) LIMIT 1`,
    business.id,
  )
  if (!owner) throw new Error('The owner account already has sign-in credentials.')
  const normalizedName = displayName.trim()
  if (normalizedName.length < 2 || normalizedName.length > 160) {
    throw new Error('Owner name must contain 2 to 160 characters.')
  }
  const normalizedUsername = username.trim().toLowerCase()
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(normalizedUsername)) {
    throw new Error('Username must be 3 to 40 letters, numbers, dots, underscores or hyphens.')
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be between 8 and 128 characters.')
  }
  const credentials = await createPasswordHash(password, createId())
  await withDatabaseTransaction(database, async (transaction) => {
    await transaction.runAsync(
      `UPDATE users SET display_name = ?, username = ?, password_salt = ?, password_hash = ?,
       password_iterations = ?
       WHERE id = ? AND business_id = ?`,
      normalizedName,
      normalizedUsername,
      credentials.salt,
      credentials.hash,
      credentials.iterations,
      owner.id,
      business.id,
    )
    await transaction.runAsync(
      `INSERT INTO app_settings (setting_key, setting_value) VALUES ('active_user_id', ?)
       ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
      owner.id,
    )
  })
}
