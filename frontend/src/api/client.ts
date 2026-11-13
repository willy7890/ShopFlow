import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuth } from '@/store/auth'

// The deployment target is supplied at build time; API URLs never live in screens.
export const API_BASE = import.meta.env.VITE_API_BASE_URL
export const http = axios.create({ baseURL: API_BASE, timeout: 15000 })

http.interceptors.request.use((cfg) => {
  const { token, me } = useAuth.getState()
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (me?.business?.id) cfg.headers['X-Business-ID'] = me.business.id
  return cfg
})

/** A normalized error every screen can show. */
export class ApiError extends Error {
  constructor(message: string, public status = 0, public network = false) { super(message) }
}

let refreshInFlight: Promise<{ access_token: string; refresh_token: string }> | null = null
http.interceptors.response.use(
  (r) => r,
  async (e: AxiosError<{ detail?: string }>) => {
    const request = e.config as (InternalAxiosRequestConfig & { _refreshAttempted?: boolean }) | undefined
    const state = useAuth.getState()
    const isAuthRequest = request?.url?.startsWith('/auth/')
    if (e.response?.status === 401 && request && !request._refreshAttempted && !isAuthRequest && state.refreshToken) {
      request._refreshAttempted = true
      try {
        refreshInFlight ??= axios.post<{ access_token: string; refresh_token: string }>(
          `${API_BASE}/auth/refresh`, { refresh_token: state.refreshToken }, { timeout: 15000 },
        ).then((response) => response.data).finally(() => { refreshInFlight = null })
        const tokens = await refreshInFlight
        useAuth.getState().updateTokens(tokens.access_token, tokens.refresh_token)
        request.headers.Authorization = `Bearer ${tokens.access_token}`
        return http(request)
      } catch {
        useAuth.getState().expire()
      }
    } else if (e.response?.status === 401 && !isAuthRequest) {
      useAuth.getState().expire()
    }
    const msg = e.response?.data?.detail ?? e.message
    return Promise.reject(new ApiError(typeof msg === 'string' ? msg : 'Request failed', e.response?.status ?? 0, !e.response))
  },
)
