import { create } from 'zustand'
import { api } from '@/api'
import type { QueueItem, SalePayload } from '@/api/types'
import { idbGet, idbSet } from './db'
import { queryClient } from '@/lib/queryClient'

interface SyncStore {
  items: QueueItem[]; forceOffline: boolean; syncing: boolean; progress: [number, number]; lastSync: string
  hydrate: () => Promise<void>; setOffline: (o: boolean) => void
  enqueue: (p: SalePayload, ref: string) => void
  run: () => Promise<void>; discard: (clientId: string) => void; accept: (clientId: string) => void
}
const persist = (items: QueueItem[]) => idbSet('queue', items)

export const useSync = create<SyncStore>((set, get) => ({
  items: [], forceOffline: false, syncing: false, progress: [0, 0], lastSync: '',
  hydrate: async () => { const q = await idbGet<QueueItem[]>('queue'); if (q) set({ items: q }) },
  setOffline: (forceOffline) => { set({ forceOffline }); if (!forceOffline) setTimeout(() => get().run(), 300) },
  enqueue: (payload, ref) => { const items = [{ clientId: payload.clientId, payload, state: 'pending' as const, at: new Date().toISOString(), ref }, ...get().items]; set({ items }); persist(items) },
  run: async () => {
    const s = get(); if (s.syncing || isOffline()) return
    const todo = s.items.filter((i) => i.state === 'pending' || i.state === 'failed'); if (!todo.length) return
    set({ syncing: true, progress: [0, todo.length] })
    try {
      // The backend de-duplicates by clientId, so retrying is always safe.
      const results = await api.sync.push(todo.map((i) => i.payload))
      const items = get().items.map((i) => { const r = results.find((x) => x.clientId === i.clientId); return r ? { ...i, state: r.state, message: r.message } : i })
      set({ items, progress: [todo.length, todo.length] }); persist(items)
    } catch (e) {
      const items = get().items.map((i) => (todo.some((t) => t.clientId === i.clientId) ? { ...i, state: 'failed' as const, message: (e as Error).message } : i))
      set({ items }); persist(items)
    } finally { set({ syncing: false, lastSync: new Date().toLocaleTimeString() }); queryClient.invalidateQueries() }
  },
  discard: (id) => { const items = get().items.filter((i) => i.clientId !== id); set({ items }); persist(items) },
  accept: (id) => { const items = get().items.map((i) => (i.clientId === id ? { ...i, state: 'synced' as const } : i)); set({ items }); persist(items) },
}))
export const isOffline = () => useSync.getState().forceOffline || !navigator.onLine
export const useOffline = () => { const f = useSync((s) => s.forceOffline); return f || !navigator.onLine }
export function wireConnectivity() {
  addEventListener('online', () => useSync.getState().run())
  useSync.getState().hydrate()
}
