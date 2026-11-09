import { useQuery } from '@tanstack/react-query'
import { api } from '@/api'
import { useT } from '@/i18n'
import { Chip, Kpis, PageHeader, Table } from '@/components/ui'
import { idbDel } from '@/offline/db'
import { useOffline, useSync } from '@/offline/sync'
import { useNotify } from '@/components/ui'

export default function SyncPage() {
  const { t } = useT(); const s = useSync(); const offline = useOffline(); const notify = useNotify(); const prods = useQuery({ queryKey: ['products'], queryFn: api.catalog.products })
  const pending = s.items.filter((i) => i.state !== 'synced').length, variants = (prods.data ?? []).reduce((a, p) => a + p.variants.length, 0)
  return (
    <div className="max-w-[860px]">
      <PageHeader title={t('o_title')} />
      <Kpis items={[[t(offline ? 'o_off' : 'o_on'), '● ' + t(offline ? 'o_off' : 'o_on')], [t('o_pend'), String(pending)], [t('o_last'), s.lastSync || t('o_never')]]} />
      <p className="text-mu mb-3">{t('o_cache', { p: prods.data?.length ?? 0, v: variants })}</p>
      <label className="flex gap-2 items-center mb-3"><input type="checkbox" checked={s.forceOffline} onChange={(e) => s.setOffline(e.target.checked)} /> {t('o_sim')}</label>
      <div className="flex gap-3 items-center mb-4"><button className="btn" disabled={offline || s.syncing || !pending} onClick={s.run}>{t('o_sync')}</button>{s.syncing && <progress max={s.progress[1]} value={s.progress[0]} className="w-48" />}</div>
      <h3 className="font-semibold mb-2">{t('o_q')}</h3>
      <Table empty={s.items.length ? undefined : t('o_empty')} head={[t('i_date'), t('s_no'), t('s_type'), t('pm_st'), '']}>
        {s.items.map((i) => <tr key={i.clientId}><td className="td">{new Date(i.at).toLocaleString()}</td><td className="td">{i.ref}</td><td className="td">{t(i.payload.type === 'pos' ? 's_pos' : 's_quick')}</td>
          <td className="td"><Chip kind={i.state === 'synced' ? 'ok' : i.state === 'pending' ? 'p' : 'e'}>{t('o_' + (i.state === 'pending' ? 'pend' : i.state))}</Chip>{i.message && <><br /><small className="text-er">{i.message}</small></>}</td>
          <td className="td whitespace-nowrap">{i.state === 'failed' && <button className="lnk" onClick={s.run}>{t('o_retry')}</button>}{i.state === 'conflict' && <><button className="lnk" onClick={() => s.accept(i.clientId)}>{t('o_accept')}</button><button className="lnk" onClick={() => s.discard(i.clientId)}>{t('o_discard')}</button></>}</td></tr>)}</Table>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-3">{t('o_idb')}</p>
      <button className="btn btn-ghost mt-3" onClick={() => idbDel('queue').then(() => notify(t('sc_rd')))}>{t('sc_reset')}</button>
    </div>
  )
}
