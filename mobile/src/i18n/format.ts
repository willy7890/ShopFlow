import type { Language } from './translations'

export function formatNumber(value: number, language: Language): string {
  return new Intl.NumberFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDateTime(value: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'sw' ? 'sw-TZ' : 'en-TZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
