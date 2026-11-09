import type { Sale } from '@/api/types'
import { useT } from '@/i18n'
import { Chip, Modal } from '@/components/ui'
import { tzs } from '@/lib/utils'
import { lineTotal } from '@/lib/cart'

export function Receipt({ sale, onClose, closeLabel }: { sale: Sale; onClose: () => void; closeLabel: string }) {
  const { t } = useT()
  const share = () => { const text = `${sale.no} · ${tzs(sale.total)}`; if (navigator.share) navigator.share({ title: 'ShopFlow', text }).catch(() => undefined) }
  return (
    <Modal open onClose={onClose} title={t('x_done')}>
      <div className="font-mono text-sm space-y-1">
        <p className="text-ok font-semibold">{sale.no} · {sale.date}</p>
        {(sale.items.length ? sale.items : [{ name: sale.description ?? '—', qty: 1, price: sale.total, discount: 0 }]).map((l, i) => <div key={i} className="flex justify-between gap-3"><span>{l.qty}× {l.name}</span><span>{tzs(lineTotal(l))}</span></div>)}
        <hr className="border-dashed border-bd" />
        <div className="flex justify-between"><b>{t('x_tot')}</b><b>{tzs(sale.total)}</b></div>
        <div className="flex justify-between"><span>{t('x_paid')}</span><span>{tzs(sale.paid)}</span></div>
        {sale.due > 0 && <div className="flex justify-between"><span>{t('x_due')}</span><span>{tzs(sale.due)}</span></div>}
        <div className="flex justify-between"><span>{t('x_cust')}</span><span>{sale.customer || t('walk')}</span></div>
        {sale.sync && sale.sync !== 'synced' && <div className="flex justify-between"><span>{t('o_title')}</span><Chip kind="p">{t('o_pend')}</Chip></div>}
      </div>
      <div className="flex gap-2 mt-4 print:hidden">
        <button className="btn btn-ghost flex-1" onClick={() => window.print()}>{t('x_print')}</button>
        {'share' in navigator && <button className="btn btn-ghost flex-1" onClick={share}>{t('x_share')}</button>}
        <button className="btn flex-1" onClick={onClose}>{closeLabel}</button>
      </div>
    </Modal>
  )
}
