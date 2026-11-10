import { httpApi } from './http'
import { mockApi } from './mock'
import type { Api } from './api'

export const USE_MOCK = import.meta.env.MODE === 'test' || String(import.meta.env.VITE_USE_MOCK ?? 'false') === 'true'
export const api: Api = USE_MOCK ? mockApi : httpApi
export type { Api } from './api'
export * from './types'
