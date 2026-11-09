import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/api'
import type { AiAnswer } from '@/api/types'
import { useT } from '@/i18n'
import { Chip, PageHeader } from '@/components/ui'
import { cn } from '@/lib/utils'

interface Msg { role: 'u' | 'a'; text: string; answer?: AiAnswer }
interface Chat { id: number; title: string; msgs: Msg[] }

/** Read-only advisor. It can never change stock, prices, payments or sales (the backend must enforce this too). */
export default function Assistant() {
  const { t, lang } = useT(); const [chats, setChats] = useState<Chat[]>([{ id: 1, title: '', msgs: [] }]); const [cur, setCur] = useState(1); const [draft, setDraft] = useState(''); const [last, setLast] = useState(''); const end = useRef<HTMLDivElement>(null)
  const chat = chats.find((c) => c.id === cur)!
  const patch = (fn: (c: Chat) => Chat) => setChats((cs) => cs.map((c) => (c.id === cur ? fn(c) : c)))
  const ask = useMutation({
    mutationFn: (q: string) => api.ai.ask(q, lang),
    onSuccess: (a) => { patch((c) => ({ ...c, msgs: [...c.msgs, { role: 'a', text: a.text, answer: a }] })); setLast(''); setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth' }), 50) },
    onError: (_e, q) => setLast(q),
  })
  const send = (q: string, retry = false) => { q = q.trim(); if (!q || ask.isPending) return; if (!retry) patch((c) => ({ ...c, title: c.title || q.slice(0, 28), msgs: [...c.msgs, { role: 'u', text: q }] })); setDraft(''); ask.mutate(q) }
  const sg = [1, 2, 3, 4, 5, 6].map((i) => t('a_q' + i) as string)
  return (
    <>
      <PageHeader title={t('nav').ai} />
      <div className="grid md:grid-cols-[220px_1fr] gap-5 items-start">
        <div className="flex md:flex-col gap-1 overflow-x-auto">
          <button className="btn btn-ghost !min-h-[40px] whitespace-nowrap" onClick={() => { const id = Date.now(); setChats([{ id, title: '', msgs: [] }, ...chats]); setCur(id) }}>+ {t('a_new')}</button>
          {chats.map((c) => <button key={c.id} onClick={() => setCur(c.id)} className={cn('text-left px-3 min-h-[36px] rounded-lg text-sm font-semibold truncate max-w-[200px]', cur === c.id ? 'bg-ac/15 text-tx' : 'text-mu')}>{c.title || t('a_new')}</button>)}
        </div>
        <div>
          <p className="text-sm text-mu border border-dashed border-bd rounded-lg p-2 mb-3">{t('a_disc')}<br />{t('a_demo')}</p>
          <div className="flex flex-col gap-2.5 min-h-[260px] max-h-[calc(100vh-340px)] overflow-auto" aria-live="polite">
            {!chat.msgs.length && <><p className="text-mu">{t('a_empty')}</p><div className="flex flex-wrap gap-2">{sg.map((s) => <button key={s} className="border border-bd bg-sf rounded-lg px-3 py-2 text-sm text-left hover:border-ac" onClick={() => send(s)}>{s}</button>)}</div></>}
            {chat.msgs.map((m, i) => m.role === 'u'
              ? <div key={i} className="self-end bg-ac text-on rounded-xl px-3.5 py-2.5 max-w-[88%]">{m.text}</div>
              : <div key={i} className="self-start bg-sf border border-bd rounded-xl px-3.5 py-2.5 max-w-[88%]">
                {m.text.split('\n').map((l, j) => <p key={j} className="mb-1">{l}</p>)}
                {!!m.answer?.cards.length && <div className="flex gap-2 flex-wrap my-2">{m.answer.cards.map((c) => <div key={c.title} className="border border-bd rounded-lg px-3 py-2 bg-bg"><small className="block text-mu">{c.title}</small><b>{c.value}</b></div>)}</div>}
                <small className="block text-mu">{t('a_per')}: {m.answer?.context}</small>{m.answer?.recommendation && <Chip kind="p">{t('a_rec')}</Chip>}</div>)}
            {ask.isPending && <div className="self-start bg-sf border border-bd rounded-xl px-3.5 py-2.5 text-sm text-mu">{t('a_think')}</div>}
            {last && <div className="self-start border border-er rounded-xl px-3.5 py-2.5 text-sm"><span className="text-er">{t('a_err')}</span> <button className="lnk" onClick={() => send(last, true)}>{t('a_retry')}</button></div>}
            <div ref={end} />
          </div>
          <div className="flex gap-2 mt-3"><input className="inp" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send(draft)} placeholder={t('a_ph')} aria-label={t('a_ph')} /><button className="btn" disabled={ask.isPending} onClick={() => send(draft)}>{t('a_send')}</button></div>
        </div>
      </div>
    </>
  )
}
