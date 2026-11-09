export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')
export const tzs = (n: number) => 'TZS ' + Math.round(n).toLocaleString('en-US')
export const today = () => new Date().toISOString().slice(0, 10)
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const daysAgo = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5)
export function shrinkImage(file: Blob, max = 480): Promise<string> {
  return new Promise((res) => {
    const url = URL.createObjectURL(file), im = new Image()
    im.onload = () => {
      const r = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas')
      c.width = Math.round(im.width * r); c.height = Math.round(im.height * r)
      c.getContext('2d')?.drawImage(im, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72))
    }
    im.onerror = () => res('')
    im.src = url
  })
}
