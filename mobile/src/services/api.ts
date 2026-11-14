
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { SQLiteDatabase } from 'expo-sqlite'
import {
  apiBaseUrlFromPackagerHost,
  defaultApiBaseUrl,
  normalizeApiBaseUrl,
} from '../domain/apiUrl.ts'
import type { Language } from '../i18n/translations.ts'

const ACCESS_TOKEN_KEY = 'shopflow.api.access-token'
const REFRESH_TOKEN_KEY = 'shopflow.api.refresh-token'
const API_BASE_URL_KEY = 'api_base_url'
const REQUEST_TIMEOUT_MS = 60_000

export interface ApiTokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  user: ApiUser
}

export interface ApiUser {
  id: string
  full_name: string
  email: string
  phone: string | null
  preferred_language: string
  is_super_admin: boolean
}

export interface RegistrationResult {
  email: string
  verification_required: boolean
  email_sent: boolean
  delivery_configured: boolean
  message?: string
}

export interface SubscriptionPlan {
  id: string
  slug: string
  name: string
  description: string | null
  price: string
  currency: string
  duration_days: number
  trial_days: number
  features: Record<string, boolean | number | string>
  entitlement_schema_version: number
  is_active: boolean
}

export interface CurrentSubscription {
  id: string
  business_id: string
  plan_id: string | null
  status: string
  effective_status: string | null
  started_at: string
  expires_at: string | null
  renewal_price: string
  currency: string
  entitlement_mode: 'legacy' | 'enforced'
}

export interface PaymentInstructions {
  currency: string
  configured: boolean
  instructions: string
  methods: {
    id: string
    method: 'manual' | 'mobile_money' | 'bank' | 'cash'
    display_name: string
    recipient_name: string
    recipient_details: string
    reference_instructions: string
    evidence_supported: boolean
  }[]
}

export interface SubscriptionPaymentRecord {
  id: string
  subscription_id: string
  amount: string
  currency: string
  payment_method: string
  transaction_reference: string | null
  paid_at: string
  status: 'pending' | 'confirmed' | 'failed' | 'refunded'
}

export interface ResendVerificationResult {
  message: string
  delivery_configured: boolean
  delivery_sent?: boolean | null
}

export interface ApiStore {
  id: string
  business_id: string
  name: string
  code: string
  address: string | null
}

export interface BusinessAccess {
  business_id: string
  business_name: string
  currency: string
  role: string
  store_ids: string[]
  permissions: string[]
  stores: ApiStore[]
}

interface ApiErrorResponse {
  detail?: string | { msg?: string }[]
}

export interface SyncPushResult {
  client_id: string
  state: 'synced' | 'failed' | 'pending' | 'conflict'
  message: string | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

let refreshInProgress: Promise<string | null> | null = null

/**
 * Platform-aware token storage.
 *
 * Web:
 * Uses browser localStorage because expo-secure-store requires
 * native functionality that is unavailable in a browser.
 *
 * Android/iOS:
 * Uses Expo SecureStore.
 */
async function getStoredToken(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage.getItem(key)
  }

  return SecureStore.getItemAsync(key)
}

async function setStoredToken(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(key, value)
    return
  }

  await SecureStore.setItemAsync(key, value)
}

async function deleteStoredToken(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(key)
    return
  }

  await SecureStore.deleteItemAsync(key)
}

export async function saveApiBaseUrl(
  database: SQLiteDatabase,
  value: string,
): Promise<string> {
  const normalized = normalizeApiBaseUrl(value)

  if (
    !__DEV__ &&
    normalized !== defaultApiBaseUrl(false, process.env.EXPO_PUBLIC_API_URL)
  ) {
    throw new Error('Production builds must use the ShopFlow production API.')
  }

  await database.runAsync(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    API_BASE_URL_KEY,
    normalized,
  )

  return normalized
}

export async function getApiBaseUrl(
  database: SQLiteDatabase,
): Promise<string> {
  if (!__DEV__) {
    return defaultApiBaseUrl(false, process.env.EXPO_PUBLIC_API_URL)
  }

  const setting = await database.getFirstAsync<{ setting_value: string }>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    API_BASE_URL_KEY,
  )

  return defaultApiBaseUrl(
    true,
    process.env.EXPO_PUBLIC_API_URL
      ?? apiBaseUrlFromPackagerHost(Constants.expoConfig?.hostUri)
      ?? setting?.setting_value,
  )
}

export async function hasOnlineSession(): Promise<boolean> {
  const [accessToken, refreshToken] = await Promise.all([
    getStoredToken(ACCESS_TOKEN_KEY),
    getStoredToken(REFRESH_TOKEN_KEY),
  ])
  return Boolean(accessToken || refreshToken)
}

export async function loginOnline(
  database: SQLiteDatabase,
  apiUrl: string,
  email: string,
  password: string,
): Promise<ApiUser> {
  await saveApiBaseUrl(database, apiUrl)

  const response = await request<ApiTokenResponse>(
    database,
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({
        email: email.trim(),
        password,
      }),
    },
    false,
  )

  await saveTokens(response)

  return response.user
}

export async function registerOnline(
  database: SQLiteDatabase,
  apiUrl: string,
  input: {
    fullName: string
    email: string
    phone?: string
    password: string
    businessName: string
    preferredLanguage: Language
  },
): Promise<RegistrationResult> {
  await saveApiBaseUrl(database, apiUrl)

  return request<RegistrationResult>(
    database,
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({
        full_name: input.fullName.trim(),
        email: input.email.trim(),
        phone: input.phone?.trim() || null,
        password: input.password,
        business_name: input.businessName.trim(),
        country_code: 'TZ',
        currency: 'TZS',
        preferred_language: input.preferredLanguage,
      }),
    },
    false,
  )
}

export async function resendVerificationEmail(
  database: SQLiteDatabase,
  email: string,
): Promise<ResendVerificationResult> {
  return request<ResendVerificationResult>(
    database,
    '/auth/resend-verification',
    { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) },
    false,
  )
}

export async function requestPasswordReset(
  database: SQLiteDatabase,
  email: string,
): Promise<{ message: string }> {
  return request<{ message: string }>(database, '/auth/password-reset/request', {
    method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }),
  }, false)
}

export async function fetchSubscriptionPlans(database: SQLiteDatabase): Promise<SubscriptionPlan[]> {
  return request(database, '/subscriptions/plans?active_only=true')
}

export async function fetchCurrentSubscription(database: SQLiteDatabase, businessId: string): Promise<CurrentSubscription | null> {
  return authenticatedApiRequest(database, '/subscriptions/current', {}, { businessId })
}

export async function fetchSubscriptionHistory(database: SQLiteDatabase, businessId: string): Promise<CurrentSubscription[]> {
  return authenticatedApiRequest(database, '/subscriptions/history', {}, { businessId })
}

export async function requestSubscriptionPlan(database: SQLiteDatabase, businessId: string, planId: string): Promise<CurrentSubscription> {
  return authenticatedApiRequest(database, '/subscriptions/request', {
    method: 'POST', body: JSON.stringify({ plan_id: planId }),
  }, { businessId })
}

export async function fetchSubscriptionPaymentInstructions(database: SQLiteDatabase, businessId: string): Promise<PaymentInstructions> {
  return authenticatedApiRequest(database, '/subscriptions/payment-instructions', {}, { businessId })
}

export async function fetchSubscriptionPayments(database: SQLiteDatabase, businessId: string): Promise<SubscriptionPaymentRecord[]> {
  return authenticatedApiRequest(database, '/subscriptions/payments/mine', {}, { businessId })
}

export async function submitSubscriptionPayment(
  database: SQLiteDatabase,
  businessId: string,
  input: { payment_method: PaymentInstructions['methods'][number]['method']; transaction_reference: string; paid_at: string },
): Promise<SubscriptionPaymentRecord> {
  return authenticatedApiRequest(database, '/subscriptions/payments/submit', {
    method: 'POST', body: JSON.stringify(input),
  }, { businessId })
}

export async function fetchCurrentUser(
  database: SQLiteDatabase,
): Promise<ApiUser> {
  return request<ApiUser>(database, '/auth/me')
}

export async function fetchBusinessAccess(
  database: SQLiteDatabase,
): Promise<BusinessAccess[]> {
  return request<BusinessAccess[]>(database, '/businesses/access')
}

export async function authenticatedApiRequest<T>(
  database: SQLiteDatabase,
  path: string,
  init: RequestInit = {},
  context?: {
    businessId?: string
    storeId?: string
    deviceId?: string
  },
): Promise<T> {
  const headers = new Headers(init.headers)

  if (context?.businessId) {
    headers.set('X-Business-ID', context.businessId)
  }

  if (context?.storeId) {
    headers.set('X-Store-ID', context.storeId)
  }

  if (context?.deviceId) {
    headers.set('X-Device-ID', context.deviceId)
  }

  return request<T>(database, path, {
    ...init,
    headers,
  })
}

export async function logoutOnline(
  database: SQLiteDatabase,
): Promise<void> {
  const refreshToken = await getStoredToken(REFRESH_TOKEN_KEY)

  try {
    if (refreshToken) {
      await request(
        database,
        '/auth/logout',
        {
          method: 'POST',
          body: JSON.stringify({
            refresh_token: refreshToken,
          }),
        },
      )
    }
  } finally {
    await clearOnlineSession()
  }
}

async function request<T>(
  database: SQLiteDatabase,
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<T> {
  const url = `${await getApiBaseUrl(database)}${path}`
  const headers = new Headers(init.headers)

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (authenticated) {
    let token = await getStoredToken(ACCESS_TOKEN_KEY)

    if (!token) {
      token = await refreshAccessToken(database)
      if (!token) {
        throw new ApiError('No active online session.', 401)
      }
    }

    headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetchWithTimeout(url, {
    ...init,
    headers,
  })

  if (response.status === 401 && authenticated) {
    const accessToken = await refreshAccessToken(database)

    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)

      response = await fetchWithTimeout(url, {
        ...init,
        headers,
      })
    }
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new ApiError('ShopFlow API request timed out.', 0)
    }

    if (error instanceof TypeError) {
      throw new ApiError('Network request failed', 0)
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function refreshAccessToken(
  database: SQLiteDatabase,
): Promise<string | null> {
  if (refreshInProgress) {
    return refreshInProgress
  }

  refreshInProgress = (async () => {
    const refreshToken = await getStoredToken(REFRESH_TOKEN_KEY)

    if (!refreshToken) {
      await clearOnlineSession()
      return null
    }

    try {
      const response = await request<ApiTokenResponse>(
        database,
        '/auth/refresh',
        {
          method: 'POST',
          body: JSON.stringify({
            refresh_token: refreshToken,
          }),
        },
        false,
      )

      await saveTokens(response)

      return response.access_token
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearOnlineSession()
        return null
      }
      if (error instanceof ApiError && error.status === 403) {
        await clearOnlineSession()
      }

      throw error
    }
  })()

  try {
    return await refreshInProgress
  } finally {
    refreshInProgress = null
  }
}

async function saveTokens(tokens: ApiTokenResponse): Promise<void> {
  await Promise.all([
    setStoredToken(ACCESS_TOKEN_KEY, tokens.access_token),
    setStoredToken(REFRESH_TOKEN_KEY, tokens.refresh_token),
  ])
}

export async function clearOnlineSession(): Promise<void> {
  await Promise.all([
    deleteStoredToken(ACCESS_TOKEN_KEY),
    deleteStoredToken(REFRESH_TOKEN_KEY),
  ])
}

async function readErrorMessage(
  response: Response,
): Promise<string> {
  let payload: ApiErrorResponse | undefined

  try {
    payload = await response.json() as ApiErrorResponse
  } catch {
    return `ShopFlow API request failed (${response.status}).`
  }

  if (typeof payload.detail === 'string') {
    return payload.detail
  }

  if (Array.isArray(payload.detail)) {
    const messages = payload.detail
      .map((item) => item.msg)
      .filter((message): message is string => Boolean(message))

    if (messages.length > 0) {
      return messages.join(' ')
    }
  }

  return `ShopFlow API request failed (${response.status}).`
}
