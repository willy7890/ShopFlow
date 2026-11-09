import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { Chip, PageHeader, Table } from '@/components/ui'

/** Store list comes from the backend (`me.stores`). Per-store stock/sales comparison and stock transfers need backend endpoints. */
export default function Stores() {
  const { t } = useT(); const { me, storeId, setStore } = useAuth()
  return (
    <div className="max-w-[720px]">
      <PageHeader title={t('stn_title')} />
      <Table head={[t('stn_name'), t('em_status'), '']}>{me?.stores.map((s) => <tr key={s.id}><td className="td"><b>{s.name}</b></td><td className="td"><Chip>{t('em_active')}</Chip></td><td className="td">{storeId === s.id ? <Chip kind="p">✓</Chip> : <button className="lnk" onClick={() => setStore(s.id)}>{t('store')}</button>}</td></tr>)}</Table>
      <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mt-4">{t('stn_note')}</p>
    </div>
  )
}
