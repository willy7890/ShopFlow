import * as SecureStore from 'expo-secure-store'
import type { SQLiteDatabase } from 'expo-sqlite'
import { normalizeApiBaseUrl } from '../domain/apiUrl.ts'
import type { Language } from '../i18n/translations.ts'

const ACCESS_TOKEN_KEY = 'shopflow.api.access-token'
const REFRESH_TOKEN_KEY = 'shopflow.api.refresh-token'
const API_BASE_URL_KEY = 'api_base_url'

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
  detail?: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let refreshInProgress: Promise<string | null> | null = null

export async function saveApiBaseUrl(database: SQLiteDatabase, value: string): Promise<string> {
  const normalized = normalizeApiBaseUrl(value)
  await database.runAsync(
    `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
    API_BASE_URL_KEY,
    normalized,
  )
  return normalized
}

export async function getApiBaseUrl(database: SQLiteDatabase): Promise<string> {
  const setting = await database.getFirstAsync<{ setting_value: string }>(
    'SELECT setting_value FROM app_settings WHERE setting_key = ?',
    API_BASE_URL_KEY,
  )
  const configured = setting?.setting_value ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000/api/v1'
  return normalizeApiBaseUrl(configured)
}

export async function hasOnlineSession(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(ACCESS_TOKEN_KEY))
}

export async function loginOnline(
  database: SQLiteDatabase,
  apiUrl: string,
  email: string,
  password: string,
): Promise<ApiUser> {
  await saveApiBaseUrl(database, apiUrl)
  const response = await request<ApiTokenResponse>(database, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), password }),
  }, false)
  await saveTokens(response)
  return response.user
}

export async function registerOnline(
  database: SQLiteDatabase,
  apiUrl: string,
  input: {
    fullName: string
    email: string
    password: string
    businessName: string
    preferredLanguage: Language
  },
): Promise<ApiUser> {
  await saveApiBaseUrl(database, apiUrl)
  const response = await request<ApiTokenResponse>(database, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      full_name: input.fullName.trim(),
      email: input.email.trim(),
      password: input.password,
      business_name: input.businessName.trim(),
      country_code: 'TZ',
      currency: 'TZS',
      preferred_language: input.preferredLanguage,
    }),
  }, false)
  await saveTokens(response)
  return response.user
}

export async function fetchCurrentUser(database: SQLiteDatabase): Promise<ApiUser> {
  return request<ApiUser>(database, '/auth/me')
}

export async function fetchBusinessAccess(database: SQLiteDatabase): Promise<BusinessAccess[]> {
  return request<BusinessAccess[]>(database, '/businesses/access')
}

export async function logoutOnline(database: SQLiteDatabase): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  try {
    if (refreshToken) {
      await request(database, '/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
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
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (authenticated) {
    const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY)
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetch(url, { ...init, headers })
  if (response.status === 401 && authenticated) {
    const accessToken = await refreshAccessToken(database)
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`)
      response = await fetch(url, { ...init, headers })
    }
  }

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function refreshAccessToken(database: SQLiteDatabase): Promise<string | null> {
  if (refreshInProgress) return refreshInProgress
  refreshInProgress = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
    if (!refreshToken) {
      await clearOnlineSession()
      return null
    }
    try {
      const response = await request<ApiTokenResponse>(database, '/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, false)
      await saveTokens(response)
      return response.access_token
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearOnlineSession()
        return null
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
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.access_token)
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token)
}

export async function clearOnlineSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ])
}

async function readErrorMessage(response: Response): Promise<string> {
  let payload: ApiErrorResponse | undefined
  try {
    payload = await response.json() as ApiErrorResponse
  } catch {
    return `ShopFlow API request failed (${response.status}).`
  }
  return typeof payload.detail === 'string'
    ? payload.detail
    : `ShopFlow API request failed (${response.status}).`
}
