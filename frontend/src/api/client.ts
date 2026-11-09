import axios, { AxiosError } from 'axios'
import { useAuth } from '@/store/auth'

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'
export const http = axios.create({ baseURL: API_BASE, timeout: 15000 })

http.interceptors.request.use((cfg) => {
  const token = useAuth.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

/** A normalized error every screen can show. */
export class ApiError extends Error {
  constructor(message: string, public status = 0, public network = false) { super(message) }
}

http.interceptors.response.use(
  (r) => r,
  (e: AxiosError<{ detail?: string }>) => {
    if (e.response?.status === 401) useAuth.getState().expire()   // session expiry handling
    const msg = e.response?.data?.detail ?? e.message
    return Promise.reject(new ApiError(typeof msg === 'string' ? msg : 'Request failed', e.response?.status ?? 0, !e.response))
  },
)
