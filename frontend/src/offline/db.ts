/** Tiny IndexedDB key-value wrapper. Used for the offline sale queue and cached catalog. Safe to call where IndexedDB is unavailable. */
function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('shopflow', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('kv')
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
    } catch { res(null) }
  })
}
export async function idbGet<R>(key: string): Promise<R | undefined> {
  const db = await open(); if (!db) return undefined
  return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result as R); q.onerror = () => res(undefined) })
}
export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await open(); if (!db) return
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key); tx.oncomplete = () => res(); tx.onerror = () => res() })
}
export async function idbDel(key: string): Promise<void> {
  const db = await open(); if (!db) return
  return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => res(); tx.onerror = () => res() })
}
