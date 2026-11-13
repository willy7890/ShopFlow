import type { ApiUser } from '../services/api.ts'

export function isPlatformAdmin(user: Pick<ApiUser, 'is_super_admin'> | null | undefined): boolean {
  return user?.is_super_admin === true
}

export function postLoginRoute(user: Pick<ApiUser, 'is_super_admin'>): '/platform-admin' | '/businesses' {
  return isPlatformAdmin(user) ? '/platform-admin' : '/businesses'
}
