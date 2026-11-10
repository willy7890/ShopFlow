import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT, TFn } from '@/i18n'
import { Field } from '@/components/ui'
import { AuthFrame, PasswordField } from './AuthFrame'

const email = (t: TFn) => z.string().min(1, t('req')).email(t('bademail'))
const pass = (t: TFn) => z.string().min(1, t('req')).min(8, t('minpass'))
const err = (e: unknown) => (e as Error)?.message

export function Login() {
  const { t } = useT(); const nav = useNavigate(); const { setSession, expired } = useAuth()
  const schema = z.object({ email: email(t), password: pass(t) })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const m = useMutation({ mutationFn: (d: z.infer<typeof schema>) => api.auth.login(d.email, d.password), onSuccess: (r) => { setSession(r.token, r.me); nav(r.me.user.isSuperAdmin ? '/platform-admin' : r.me.business ? '/' : '/onboarding') } })
  return (
    <AuthFrame title={t('wb')}>
      <h1 className="text-3xl font-bold text-center mb-1">{t('login')}</h1><p className="text-mu text-center mb-6">{t('loginSub')}</p>
      {expired && <p className="text-sm border border-dashed border-bd rounded-lg p-2 mb-4" role="alert">{t('sess')}</p>}
      <form onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <Field label={t('email')} type="email" autoComplete="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <PasswordField label={t('pass')} autoComplete="current-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        <Link className="lnk text-sm" to="/forgot">{t('forgot')}</Link>
        {m.error && <p className="text-er text-sm my-2" role="alert">{err(m.error)}</p>}
        <button className="btn w-full mt-2 !rounded-full" disabled={m.isPending}>{m.isPending ? t('wait') : t('login')}</button>
      </form>
      <p className="text-center text-sm text-mu mt-5">{t('noAcc')} <Link className="lnk" to="/register">{t('reg')}</Link></p>
    </AuthFrame>
  )
}

export function Register() {
  const { t } = useT(); const nav = useNavigate(); const { setSession } = useAuth()
  const schema = z.object({ name: z.string().min(1, t('req')), email: email(t), password: pass(t) })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const m = useMutation({ mutationFn: api.auth.register, onSuccess: (r) => { setSession(r.token, r.me); nav('/onboarding') } })
  return (
    <AuthFrame title={t('wl')} reverse>
      <h1 className="text-3xl font-bold text-center mb-1">{t('reg')}</h1><p className="text-mu text-center mb-6">{t('regSub')}</p>
      <form onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <Field label={t('name')} error={f.formState.errors.name?.message} {...f.register('name')} />
        <Field label={t('email')} type="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        <PasswordField label={t('pass')} autoComplete="new-password" error={f.formState.errors.password?.message} {...f.register('password')} />
        {m.error && <p className="text-er text-sm my-2" role="alert">{err(m.error)}</p>}
        <button className="btn w-full !rounded-full" disabled={m.isPending}>{m.isPending ? t('wait') : t('create')}</button>
      </form>
      <p className="text-center text-sm text-mu mt-5">{t('haveAcc')} <Link className="lnk" to="/login">{t('login')}</Link></p>
    </AuthFrame>
  )
}

export function Forgot() {
  const { t } = useT()
  const schema = z.object({ email: email(t) })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const m = useMutation({ mutationFn: (d: z.infer<typeof schema>) => api.auth.forgot(d.email) })
  return (
    <AuthFrame title={t('wb')}>
      <h1 className="text-2xl font-bold text-center mb-1">{t('fTitle')}</h1><p className="text-mu text-center mb-6">{t('fSub')}</p>
      <form onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <Field label={t('email')} type="email" error={f.formState.errors.email?.message} {...f.register('email')} />
        {m.isSuccess && <p className="text-ok font-semibold mb-3" role="status">{t('sent')} <Link className="lnk" to="/reset?token=demo">{t('rs_open')}</Link></p>}
        {m.error && <p className="text-er text-sm my-2" role="alert">{err(m.error)}</p>}
        <button className="btn w-full !rounded-full" disabled={m.isPending}>{m.isPending ? t('wait') : t('send')}</button>
      </form>
      <p className="text-center mt-5"><Link className="lnk" to="/login">{t('back')}</Link></p>
    </AuthFrame>
  )
}

export function Reset() {
  const { t } = useT(); const nav = useNavigate(); const [q] = useSearchParams()
  const schema = z.object({ password: pass(t), password2: z.string() }).refine((d) => d.password === d.password2, { path: ['password2'], message: t('ns_mis') })
  const f = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
  const m = useMutation({ mutationFn: (d: z.infer<typeof schema>) => api.auth.reset(q.get('token') ?? '', d.password), onSuccess: () => nav('/login') })
  return (
    <AuthFrame title={t('wb')}>
      <h1 className="text-2xl font-bold text-center mb-6">{t('rs_t')}</h1>
      <form onSubmit={f.handleSubmit((d) => m.mutate(d))} noValidate>
        <PasswordField label={t('ns_pw1')} error={f.formState.errors.password?.message} {...f.register('password')} />
        <PasswordField label={t('ns_pw2')} error={f.formState.errors.password2?.message} {...f.register('password2')} />
        {m.error && <p className="text-er text-sm my-2" role="alert">{err(m.error)}</p>}
        <button className="btn w-full !rounded-full" disabled={m.isPending}>{m.isPending ? t('wait') : t('p_save')}</button>
      </form>
    </AuthFrame>
  )
}
