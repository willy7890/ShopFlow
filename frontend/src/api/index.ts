import { httpApi } from './http'
import { mockApi } from './mock'
import type { Api } from './api'

// Tests may opt into the isolated fixture adapter. Normal builds always use FastAPI.
export const USE_MOCK = import.meta.env.MODE === 'test'
export const api: Api = USE_MOCK ? mockApi : httpApi
export type { Api } from './api'
export * from './types'
