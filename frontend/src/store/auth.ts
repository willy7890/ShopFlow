import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Me } from '@/api/types'

const safeStorage = {
  getItem: (key: string) => {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(key, value)
    } catch {
      // ignore storage errors in test or restricted environments
    }
  },
  removeItem: (key: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(key)
    } catch {
      // ignore storage errors in test or restricted environments
    }
  },
}

interface AuthState {
  token: string | null
  refreshToken: string | null
  me: Me | null
  expired: boolean
  storeId: string        // 'all' or a store id
  setSession: (token: string, me: Me, refreshToken?: string) => void
  updateTokens: (token: string, refreshToken: string) => void
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
      token: null, refreshToken: null, me: null, expired: false, storeId: 'all',
      setSession: (token, me, refreshToken) => set({ token, refreshToken: refreshToken ?? null, me, storeId: 'all', expired: false }),
      updateTokens: (token, refreshToken) => set({ token, refreshToken }),
      setMe: (me) => set({ me }),
      setStore: (storeId) => set({ storeId }),
      logout: () => set({ token: null, refreshToken: null, me: null, expired: false }),
      expire: () => set({ token: null, refreshToken: null, me: null, expired: true }),
      can: (p) => !!get().me?.user.permissions.includes(p),
      feature: (k) => !!get().me?.entitlements.features[k],
    }),
    {
      name: 'sf_auth',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ token: s.token, refreshToken: s.refreshToken, me: s.me, storeId: s.storeId }),
    },
  ),
)
