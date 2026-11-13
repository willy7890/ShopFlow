import QRCode from 'qrcode'

export interface ProductQr {
  size: number
  modules: Uint8Array
}

export function generateProductQr(sku: string): ProductQr {
  const code = sku.trim()
  if (!code) throw new Error('A product SKU is required to generate its QR code.')
  const qr = QRCode.create(code, {
    errorCorrectionLevel: 'M',
  })
  return { size: qr.modules.size, modules: qr.modules.data }
}

export function buildProductQrHtml(input: {
  title: string
  productName: string
  sku: string
  qr: ProductQr
}): string {
  const svg = buildProductQrSvg(input.qr, input.title)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta charset="utf-8">
    <style>
      body { align-items: center; color: #17191c; display: flex; flex-direction: column; font-family: Arial, sans-serif; justify-content: center; min-height: 90vh; text-align: center; }
      img { height: 280px; width: 280px; }
      h1 { font-size: 24px; margin: 16px 0 8px; }
      p { color: #667085; font-size: 16px; }
    </style>
  </head>
  <body>
    ${svg}
    <h1>${escapeHtml(input.productName)}</h1>
    <p>${escapeHtml(input.sku)}</p>
  </body>
</html>`
}

function buildProductQrSvg(qr: ProductQr, title: string): string {
  const commands: string[] = []
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (qr.modules[y * qr.size + x]) commands.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="-2 -2 ${qr.size + 4} ${qr.size + 4}" role="img" aria-label="${escapeHtml(title)}"><rect x="-2" y="-2" width="${qr.size + 4}" height="${qr.size + 4}" fill="white"/><path d="${commands.join('')}" fill="#17191c"/></svg>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
