import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    { name: 'sf_ui', partialize: (s) => ({ lang: s.lang, theme: s.theme, collapsed: s.collapsed }) },
  ),
)

export function applyTheme(theme: Theme) {
  const r = document.documentElement
  if (theme === 'system') r.removeAttribute('data-theme')
  else r.setAttribute('data-theme', theme)
}
