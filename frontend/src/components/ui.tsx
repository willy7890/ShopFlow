import { ReactNode, forwardRef, InputHTMLAttributes, SelectHTMLAttributes, useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(
  ({ label, error, hint, className, ...p }, ref) => (
    <label className={cn('block mb-4', className)}>
      <span className="block text-sm font-semibold mb-1">{label}</span>
      <input ref={ref} aria-invalid={!!error} className={cn('inp', error && 'border-er')} {...p} />
      {hint && !error && <small className="text-mu">{hint}</small>}
      {error && <em className="block text-er text-sm not-italic mt-1" role="alert">{error}</em>}
    </label>
  ),
)
export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }>(
  ({ label, error, children, className, ...p }, ref) => (
    <label className={cn('block mb-4', className)}>
      <span className="block text-sm font-semibold mb-1">{label}</span>
      <select ref={ref} className={cn('inp', error && 'border-er')} {...p}>{children}</select>
      {error && <em className="block text-er text-sm not-italic mt-1" role="alert">{error}</em>}
    </label>
  ),
)
export function Seg<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: [V, string][] }) {
  return (
    <div className="inline-flex border border-bd rounded-lg overflow-hidden" role="group">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className={cn('px-3 min-h-[38px] text-sm font-semibold', value === v ? 'bg-ac text-on' : 'bg-sf text-mu')}>{l}</button>
      ))}
    </div>
  )
}
export const PageHeader = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3 mb-4"><h1 className="text-2xl font-bold tracking-tight mr-auto">{title}</h1>{children}</div>
)
export const Kpis = ({ items }: { items: [string, string][] }) => (
  <div className="grid gap-px bg-bd border border-bd rounded-xl overflow-hidden mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
    {items.map(([l, v]) => <div key={l} className="bg-sf p-4"><small className="text-mu block">{l}</small><b className="text-xl tracking-tight">{v}</b></div>)}
  </div>
)
export const Panel = ({ title, children }: { title?: string; children: ReactNode }) => (
  <section className="border-t border-bd pt-3 mb-6">{title && <h3 className="font-semibold mb-2">{title}</h3>}{children}</section>
)
export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse"><thead><tr>{head.map((h, i) => <th key={i} className="th">{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
      {empty && <p className="text-mu py-4">{empty}</p>}
    </div>
  )
}
export const Skeleton = ({ h = 76 }: { h?: number }) => <div className="rounded-lg bg-bd/60 animate-pulse mb-3" style={{ height: h }} />
export function QueryState({ loading, error }: { loading: boolean; error?: unknown }) {
  const { t } = useT()
  if (loading) return <><Skeleton /><Skeleton h={220} /></>
  if (error) return <p className="text-er" role="alert">{(error as Error).message || t('a_err')}</p>
  return null
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); if (open) addEventListener('keydown', h); return () => removeEventListener('keydown', h) }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 bg-black/50 grid place-items-center p-4" onClick={onClose}>
      <div role="dialog" aria-label={title} className="bg-sf rounded-xl p-5 w-[min(460px,100%)] max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3"><h3 className="font-bold text-lg mr-auto">{title}</h3><button aria-label="close" className="lnk" onClick={onClose}><X size={18} /></button></div>
        {children}
      </div>
    </div>
  )
}
export function Toast() {
  const m = useUi((s) => s.toast)
  return <div role="status" className={cn('fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-6 z-50 px-4 py-2 rounded-lg bg-tx text-bg font-semibold transition-opacity', m ? 'opacity-100' : 'opacity-0 pointer-events-none')}>{m}</div>
}
export const Chip = ({ kind = 'ok', children }: { kind?: 'ok' | 'p' | 'e'; children: ReactNode }) => (
  <span className={cn('chip', kind === 'p' && 'chip-p', kind === 'e' && 'chip-e')}>{children}</span>
)
export const useNotify = () => useUi((s) => s.notify)
