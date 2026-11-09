import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

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

export type Lang = 'sw' | 'en'
export type Theme = 'light' | 'dark' | 'system'
interface UiState {
  lang: Lang; theme: Theme; collapsed: boolean; menuOpen: boolean; toast: string
  setLang: (l: Lang) => void; setTheme: (t: Theme) => void
  toggleCollapsed: () => void; setMenu: (o: boolean) => void; notify: (m: string) => void
}
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      lang: 'sw', theme: 'system', collapsed: false, menuOpen: false, toast: '',
      setLang: (lang) => set({ lang }), setTheme: (theme) => set({ theme }),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setMenu: (menuOpen) => set({ menuOpen }),
      notify: (toast) => { set({ toast }); setTimeout(() => set((s) => (s.toast === toast ? { toast: '' } : s)), 2600) },
    }),
    {
      name: 'sf_ui',
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ lang: s.lang, theme: s.theme, collapsed: s.collapsed }),
    },
  ),
)

export function applyTheme(theme: Theme) {
  const r = document.documentElement
  if (theme === 'system') r.removeAttribute('data-theme')
  else r.setAttribute('data-theme', theme)
}
