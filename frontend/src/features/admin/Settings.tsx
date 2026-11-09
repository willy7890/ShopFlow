import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useUi } from '@/store/ui'
import { useT } from '@/i18n'
import { Field, PageHeader, Panel, Seg, useNotify } from '@/components/ui'
import { PasswordField } from '@/features/auth/AuthFrame'

export default function Settings() {
  const { t } = useT(); const ui = useUi(); const { me, setMe, expire } = useAuth(); const notify = useNotify(); const b = me!.business!
  const [name, setName] = useState(b.name); const [pw, setPw] = useState({ a: '', b: '', c: '' }); const [pe, setPe] = useState<Record<string, string>>({})
  const save = useMutation({ mutationFn: (d: Parameters<typeof api.business.update>[0]) => api.business.update(d), onSuccess: (m) => { setMe(m); notify(t('p_saved')) } })
  const changePw = () => {
    const e: Record<string, string> = {}; if (!pw.a) e.a = t('req'); if (pw.b.length < 8) e.b = t('minpass'); if (pw.b !== pw.c) e.c = t('ns_mis'); setPe(e)
    if (!Object.keys(e).length) { notify(t('ns_ok')); setPw({ a: '', b: '', c: '' }) }   // TODO: POST /auth/change-password
  }
  return (
    <div className="max-w-[680px]">
      <PageHeader title={t('nav').settings} />
      <Panel title={t('prof')}><Field label={t('bName')} value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn mb-3" disabled={save.isPending || !name.trim()} onClick={() => save.mutate({ name })}>{t('p_save')}</button>
        <div className="border border-bd rounded-xl bg-sf divide-y divide-bd text-sm">{[[t('cur'), b.currency], [t('tz'), b.timezone], [t('role'), t('r_' + me!.user.role)]].map(([k, v]) => <div key={k} className="flex justify-between p-3"><span className="text-mu">{k}</span><b>{v}</b></div>)}</div></Panel>
      <Panel title={t('mode')}><Seg value={b.mode} onChange={(mode) => save.mutate({ mode })} options={[['pos', t('mp')], ['quick', t('mq')]]} /><p className="text-sm text-mu mt-2">{t('mnote')}</p></Panel>
      <Panel title={t('lang')}><Seg value={ui.lang} onChange={ui.setLang} options={[['sw', 'Kiswahili'], ['en', 'English']]} /></Panel>
      <Panel title={t('theme')}><Seg value={ui.theme} onChange={ui.setTheme} options={[['light', t('light')], ['dark', t('dark')], ['system', t('auto')]]} /></Panel>
      <Panel title={t('ns_sec')}><PasswordField label={t('ns_pw0')} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} error={pe.a} /><PasswordField label={t('ns_pw1')} value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} error={pe.b} /><PasswordField label={t('ns_pw2')} value={pw.c} onChange={(e) => setPw({ ...pw, c: e.target.value })} error={pe.c} />
        <div className="flex gap-2"><button className="btn" onClick={changePw}>{t('ns_chg')}</button><button className="btn btn-ghost" onClick={expire}>{t('ns_exp')}</button></div></Panel>
      <Panel title={t('ns_links')}><div className="flex flex-wrap gap-2">{[['/sync', t('o_title')], ['/employees', t('nav').employees], ['/stores', t('nav').stores], ['/subscription', t('nav').subscription]].map(([to, l]) => <Link key={to} className="btn btn-ghost" to={to}>{l}</Link>)}</div></Panel>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2">{t('ns_del')}</p>
    </div>
  )
}
