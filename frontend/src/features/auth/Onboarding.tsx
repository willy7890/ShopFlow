import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Navigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api'
import type { BusinessInput } from '@/api/api'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'
import { Field, SelectField, Seg } from '@/components/ui'
import { cn } from '@/lib/utils'

export default function Onboarding() {
  const { t } = useT(); const nav = useNavigate(); const { me, setMe } = useAuth(); const ui = useUi()
  const [step, setStep] = useState(1)
  const S = z.object({
    name: z.string().min(1, t('req')), type: z.string(), phone: z.string().min(1, t('req')), email: z.string().email(t('bademail')).optional().or(z.literal('')),
    address: z.string().min(1, t('req')), region: z.string().min(1, t('req')), currency: z.string().min(1), timezone: z.string().min(1),
    mode: z.enum(['pos', 'quick']), storeName: z.string().min(1, t('req')), inviteEmail: z.string().email(t('bademail')).optional().or(z.literal('')),
  })
  const f = useForm<z.infer<typeof S>>({ resolver: zodResolver(S), defaultValues: { type: 'duka', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', region: 'Dar es Salaam', mode: 'pos' } })
  const m = useMutation({ mutationFn: (d: BusinessInput) => api.business.create(d), onSuccess: (r) => { setMe(r); nav('/') } })
  if (me?.business) return <Navigate to="/" replace />
  const fields: Record<number, (keyof z.infer<typeof S>)[]> = { 1: ['name', 'phone', 'email', 'address', 'region', 'currency', 'timezone'], 3: ['storeName'], 5: ['inviteEmail'] }
  const e = f.formState.errors, r = f.register, v = f.watch()
  const next = async () => { if (!fields[step] || (await f.trigger(fields[step]))) setStep((s) => s + 1) }
  const types = t('types') as Record<string, string>, steps = t('s') as string[]
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <div className="w-[min(600px,100%)]">
        <div className="flex gap-1.5 mb-5" aria-hidden>{[1, 2, 3, 4, 5, 6].map((i) => <i key={i} className={cn('flex-1 h-1 rounded', i <= step ? 'bg-ac' : 'bg-bd')} />)}</div>
        <p className="text-mu text-sm mb-1">{step}/6 · {steps[step - 1]}</p>
        <form onSubmit={f.handleSubmit((d) => m.mutate(d as BusinessInput))} noValidate>
          {step === 1 && <>
            <Field label={t('bName')} error={e.name?.message} {...r('name')} />
            <SelectField label={t('bType')} {...r('type')}>{Object.entries(types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
            <div className="grid sm:grid-cols-2 gap-x-3"><Field label={t('phone')} type="tel" error={e.phone?.message} {...r('phone')} /><Field label={t('emailOpt')} type="email" error={e.email?.message} {...r('email')} /></div>
            <Field label={t('addr')} error={e.address?.message} {...r('address')} />
            <div className="grid sm:grid-cols-3 gap-x-3"><Field label={t('region')} error={e.region?.message} {...r('region')} /><Field label={t('cur')} {...r('currency')} /><Field label={t('tz')} {...r('timezone')} /></div></>}
          {step === 2 && <div className="grid sm:grid-cols-2 gap-3">{([['pos', 'm1'], ['quick', 'm2']] as const).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={v.mode === k} onClick={() => f.setValue('mode', k)} className={cn('text-left rounded-xl border-[1.5px] p-4 bg-sf', v.mode === k ? 'border-ac bg-ac/10' : 'border-bd')}><b className="block mb-1">{t(l)}</b><small className="text-mu">{t(l + 'd')}</small></button>))}</div>}
          {step === 3 && <Field label={t('sName')} error={e.storeName?.message} {...r('storeName')} />}
          {step === 4 && <div className="space-y-4"><div><p className="text-sm text-mu mb-1">{t('lang')}</p><Seg value={ui.lang} onChange={ui.setLang} options={[['sw', 'Kiswahili'], ['en', 'English']]} /></div>
            <div><p className="text-sm text-mu mb-1">{t('theme')}</p><Seg value={ui.theme} onChange={ui.setTheme} options={[['light', t('light')], ['dark', t('dark')], ['system', t('auto')]]} /></div></div>}
          {step === 5 && <><Field label={t('inv')} type="email" error={e.inviteEmail?.message} {...r('inviteEmail')} /><p className="text-mu text-sm">{t('invH')}</p></>}
          {step === 6 && <div className="border border-bd rounded-xl bg-sf divide-y divide-bd mb-4">{[[t('bName'), v.name], [t('mode'), t(v.mode === 'pos' ? 'm1' : 'm2')], [t('store'), v.storeName], [t('cur'), v.currency]].map(([a, b]) => <div key={a} className="flex justify-between gap-3 p-3 text-sm"><span className="text-mu">{a}</span><b>{b}</b></div>)}</div>}
          {m.error && <p className="text-er text-sm mb-2" role="alert">{(m.error as Error).message}</p>}
          <div className="flex gap-3 mt-2">
            {step > 1 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>{t('back')}</button>}
            {step < 6 ? <button type="button" className="btn flex-1" onClick={next}>{t('next')}</button> : <button className="btn flex-1" disabled={m.isPending}>{m.isPending ? t('wait') : t('go')}</button>}
          </div>
        </form>
      </div>
    </div>
  )
}
