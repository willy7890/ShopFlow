import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Kpis, PageHeader, Panel, Seg, Table, useNotify } from '@/components/ui'

/** Feature availability is whatever the backend returns in `entitlements`. Nothing is hardcoded per screen. */
export default function Subscription() {
  const { t } = useT(); const { me, setMe } = useAuth(); const notify = useNotify(); const e = me!.entitlements
  const emp = useQuery({ queryKey: ['employees'], queryFn: api.admin.employees }), prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products })
  const plan = useMutation({ mutationFn: api.admin.setPlan, onSuccess: (m) => { setMe(m); notify(t('p_saved')) } })
  return (
    <div className="max-w-[760px]">
      <PageHeader title={t('sb_title')} />
      <Kpis items={[[t('sb_cur'), e.plan === 'pro' ? 'Business Pro' : 'Sales Book'], [t('sb_stat'), t('sb_active')], [t('sb_renew'), e.renew]]} />
      <Panel title={t('sb_usage')}><Table head={['', t('sb_usage')]}>
        <tr><td className="td">{t('nav').stores}</td><td className="td">{me!.stores.length} / {e.limits.stores}</td></tr>
        <tr><td className="td">{t('nav').employees}</td><td className="td">{emp.data?.length ?? '…'} / {e.limits.employees}</td></tr>
        <tr><td className="td">{t('nav').products}</td><td className="td">{prods.data?.length ?? '…'} / ∞</td></tr></Table></Panel>
      <Panel title={t('sb_feat')}><Table head={['', '']}>{Object.entries(e.features).map(([k, on]) => <tr key={k}><td className="td">{t('f_' + k)}</td><td className="td">{on ? <span className="text-ok">✓</span> : '—'}</td></tr>)}</Table></Panel>
      <Seg value={e.plan} onChange={(p) => plan.mutate(p)} options={[['pro', 'Business Pro'], ['book', 'Sales Book']]} />
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('sb_up')}</p>
    </div>
  )
}
