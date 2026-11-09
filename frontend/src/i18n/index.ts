import { sw } from './sw'
import { en } from './en'
import { useUi } from '@/store/ui'

const dict = { sw, en }
export type TFn = (key: string, vars?: Record<string, string | number>) => any

/** Centralized translations. Every visible string goes through t(). Objects (e.g. t('nav').dash) are returned as-is. */
export function translate(lang: 'sw' | 'en', key: string, vars?: Record<string, string | number>): any {
  const v = dict[lang][key] ?? dict.en[key] ?? key
  if (typeof v !== 'string' || !vars) return v
  return v.replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? ''))
}
export function useT(): { t: TFn; lang: 'sw' | 'en' } {
  const lang = useUi((s) => s.lang)
  return { t: (k, v) => translate(lang, k, v), lang }
}
export const dictionaries = dict
