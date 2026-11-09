import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { useT } from '@/i18n'
import { shrinkImage } from '@/lib/utils'

declare global { interface Window { BarcodeDetector?: new (o?: { formats: string[] }) => { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } } }

function beep() {
  try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; g.gain.value = 0.1; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close() }, 120) } catch { /* no audio */ }
  try { navigator.vibrate?.(60) } catch { /* no vibration */ }
}

/**
 * Camera scanner. mode="barcode": continuous scanning (native BarcodeDetector, ZXing fallback), duplicate reads within 1.5 s are ignored.
 * mode="photo": live camera capture. If the camera is blocked, a file/camera-photo fallback is offered.
 */
export function Scanner({ open, mode, onClose, onCode, onPhoto, log }: {
  open: boolean; mode: 'barcode' | 'photo'; onClose: () => void; onCode?: (code: string) => string | void; onPhoto?: (dataUrl: string) => void; log?: boolean
}) {
  const { t } = useT()
  const video = useRef<HTMLVideoElement>(null)
  const [msg, setMsg] = useState(''); const [blocked, setBlocked] = useState(false); const [lines, setLines] = useState<string[]>([])
  const last = useRef({ code: '', at: 0 })
  const handle = (code: string, once = false) => {
    const n = Date.now(); if (code === last.current.code && n - last.current.at < 1500) return
    last.current = { code, at: n }; beep()
    const r = onCode?.(code); if (r) setLines((l) => [r, ...l].slice(0, 6))
    if (once) onClose()
  }
  useEffect(() => {
    if (!open) return
    let stream: MediaStream | null = null, timer = 0, reader: { reset: () => void } | null = null, dead = false
    setMsg(t('sc_loading')); setBlocked(false); setLines([])
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (dead || !video.current) { stream.getTracks().forEach((x) => x.stop()); return }
        video.current.srcObject = stream; await video.current.play()
      } catch { setMsg(t('sc_denied')); setBlocked(true); return }
      if (mode === 'photo') { setMsg(''); return }
      setMsg(t('sc_aim'))
      if (window.BarcodeDetector) {
        const d = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] })
        timer = window.setInterval(async () => { try { if (video.current) { const r = await d.detect(video.current); if (r[0]) handle(r[0].rawValue) } } catch { /* frame not ready */ } }, 250)
      } else {
        try {
          const { BrowserMultiFormatReader } = await import('@zxing/library')
          const rd = new BrowserMultiFormatReader(); reader = rd
          rd.decodeFromStream(stream, video.current!, (r) => { if (r) handle(r.getText()) })
        } catch { setMsg(t('sc_nosup')); setBlocked(true) }
      }
    })()
    return () => { dead = true; clearInterval(timer); try { reader?.reset() } catch { /* ignore */ } stream?.getTracks().forEach((x) => x.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  const capture = () => {
    const v = video.current; if (!v) return
    const r = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight)), c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * r); c.height = Math.round(v.videoHeight * r); c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    onPhoto?.(c.toDataURL('image/jpeg', 0.72)); onClose()
  }
  const fromFile = async (file?: File) => {
    if (!file) return
    if (mode === 'photo') { onPhoto?.(await shrinkImage(file)); onClose(); return }
    setMsg(t('sc_loading')); let code = ''
    try {
      if (window.BarcodeDetector) code = (await new window.BarcodeDetector().detect(await createImageBitmap(file)))[0]?.rawValue ?? ''
      else { const { BrowserMultiFormatReader } = await import('@zxing/library'); const u = URL.createObjectURL(file); code = (await new BrowserMultiFormatReader().decodeFromImageUrl(u)).getText() }
    } catch { /* not found */ }
    if (code) handle(code, true); else setMsg(t('sc_nodet'))
  }
  return (
    <Modal open={open} onClose={onClose} title={t(mode === 'photo' ? 'sc_photo' : 'sc_title')}>
      <div className="relative bg-black rounded-lg overflow-hidden aspect-[4/3]">
        <video ref={video} playsInline muted className="w-full h-full object-cover" />
        {mode === 'barcode' && !blocked && <div className="absolute left-[8%] right-[8%] top-1/2 h-0.5 bg-ac shadow-[0_0_12px_var(--ac)]" />}
      </div>
      <p className="text-mu text-sm my-2" aria-live="polite">{msg}</p>
      {log && <div className="max-h-24 overflow-auto text-sm">{lines.map((l, i) => <div key={i}>{l}</div>)}</div>}
      <div className="flex gap-2 mt-2">
        {mode === 'photo' && !blocked && <button className="btn flex-1" onClick={capture}>{t('sc_cap')}</button>}
        {blocked && <label className="btn btn-ghost flex-1 cursor-pointer">{t(mode === 'photo' ? 'sc_gal' : 'sc_fromph')}<input hidden type="file" accept="image/*" capture={mode === 'barcode' ? 'environment' : undefined} onChange={(e) => fromFile(e.target.files?.[0])} /></label>}
        <button className="btn btn-ghost" onClick={onClose}>{t('sc_close')}</button>
      </div>
    </Modal>
  )
}
