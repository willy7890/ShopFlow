import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Me } from '@/api/types'

interface AuthState {
  token: string | null
  me: Me | null
  expired: boolean
  storeId: string        // 'all' or a store id
  setSession: (token: string, me: Me) => void
  setMe: (me: Me) => void
  setStore: (id: string) => void
  logout: () => void
  expire: () => void
  can: (perm: string) => boolean
  feature: (key: string) => boolean
}

/** Permissions and entitlements come from the backend (`me`). The UI only hides things; the API enforces. */
export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null, me: null, expired: false, storeId: 'all',
      setSession: (token, me) => set({ token, me, expired: false }),
      setMe: (me) => set({ me }),
      setStore: (storeId) => set({ storeId }),
      logout: () => set({ token: null, me: null, expired: false }),
      expire: () => set({ token: null, me: null, expired: true }),
      can: (p) => !!get().me?.user.permissions.includes(p),
      feature: (k) => !!get().me?.entitlements.features[k],
    }),
    { name: 'sf_auth', partialize: (s) => ({ token: s.token, me: s.me, storeId: s.storeId }) },
  ),
)
