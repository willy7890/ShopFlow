import { ReactNode, useState, forwardRef, InputHTMLAttributes } from 'react'
import { Eye, EyeOff, Sun, Moon } from 'lucide-react'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/** Diagonal "welcome" layout used by all auth screens (login, register, forgot, reset). */
export function AuthFrame({ children, reverse, title }: { children: ReactNode; reverse?: boolean; title: string }) {
  const ui = useUi()
  const dark = ui.theme === 'dark' || (ui.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className="min-h-screen flex flex-col" style={{ background: dark ? 'radial-gradient(ellipse at 50% 45%,#0b2d34 0,#03090d 68%)' : '#fff' }}>
      <div className="flex justify-end gap-2 p-4">
        <div className="inline-flex border border-bd rounded-lg overflow-hidden">
          {(['sw', 'en'] as const).map((l) => <button key={l} aria-pressed={ui.lang === l} onClick={() => ui.setLang(l)} className={cn('px-3 min-h-[36px] text-sm font-semibold', ui.lang === l ? 'bg-ac text-on' : 'bg-sf text-mu')}>{l === 'sw' ? 'Kiswahili' : 'English'}</button>)}
        </div>
        <button className="btn btn-ghost !min-h-[36px] !px-2" aria-label="theme" onClick={() => ui.setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button>
      </div>
      <div className="flex-1 grid place-items-center px-4 pb-10">
        <div className={cn('relative w-[min(900px,100%)] min-h-[500px] overflow-hidden border-[1.5px] border-ac bg-sf md:flex', dark ? 'shadow-[0_0_30px_rgba(47,196,211,.5),inset_0_0_44px_rgba(47,196,211,.14)]' : 'shadow-[0_12px_40px_rgba(15,138,152,.2)]')}>
          <div className={cn('md:absolute md:inset-0 flex items-center px-8 py-8 md:py-0 text-white font-extrabold uppercase text-3xl md:text-5xl leading-none [text-shadow:0_2px_0_rgba(0,0,0,.35)]',
            reverse ? 'md:justify-start md:text-left [clip-path:polygon(0_0,100%_0,100%_78%,0_100%)] md:[clip-path:polygon(0_0,66%_0,100%_100%,0_100%)]' : 'md:justify-end md:text-right [clip-path:polygon(0_0,100%_0,100%_78%,0_100%)] md:[clip-path:polygon(34%_0,100%_0,100%_100%,0_100%)]')}
            style={{ background: 'linear-gradient(135deg,#0f3a42 0%,#1d7f8c 55%,#35b5c3 100%)' }}>
            <span className="max-w-[7ch]">{title}</span>
          </div>
          <div className={cn('relative z-[1] w-full md:w-[46%] px-6 md:px-10 py-8 md:py-12', reverse && 'md:ml-auto')}>{children}</div>
        </div>
      </div>
    </div>
  )
}

export const PasswordField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }>(({ label, error, ...p }, ref) => {
  const [show, setShow] = useState(false)
  const { t } = useT()
  return (
    <label className="block mb-4">
      <span className="block text-sm font-semibold mb-1 text-ac">{label}</span>
      <span className="relative block">
        <input ref={ref} type={show ? 'text' : 'password'} aria-invalid={!!error} className={cn('inp !pr-11', error && 'border-er')} {...p} />
        <button type="button" aria-label={t('show')} aria-pressed={show} onClick={() => setShow(!show)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-mu hover:text-ac">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </span>
      {error && <em className="block text-er text-sm not-italic mt-1" role="alert">{error}</em>}
    </label>
  )
})
