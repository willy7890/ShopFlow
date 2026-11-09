import { httpApi } from './http'
import { mockApi } from './mock'
import type { Api } from './api'

export const USE_MOCK = String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true'
export const api: Api = USE_MOCK ? mockApi : httpApi
export type { Api } from './api'
export * from './types'
