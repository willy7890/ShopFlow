export interface InvoiceHtmlInput {
  businessName: string
  storeName: string
  invoiceLabel: string
  saleNumberLabel: string
  dateLabel: string
  customerLabel: string
  walkInLabel: string
  itemLabel: string
  quantityLabel: string
  unitPriceLabel: string
  totalLabel: string
  paidLabel: string
  balanceDueLabel: string
  cashTenderedLabel: string
  changeLabel: string
  refundLabel: string
  saleNumber: string
  date: string
  customerName: string | null
  total: string
  paid: string
  balanceDue: string
  cashTendered: string
  change: string
  refund: string | null
  items: Array<{
    quantity: string
    name: string
    unitPrice: string
    lineTotal: string
  }>
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function buildInvoiceHtml(invoice: InvoiceHtmlInput): string {
  const rows = invoice.items.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="number">${escapeHtml(item.quantity)}</td>
      <td class="number">${escapeHtml(item.unitPrice)}</td>
      <td class="number">${escapeHtml(item.lineTotal)}</td>
    </tr>
  `).join('')
  const totals = [
    [invoice.totalLabel, invoice.total],
    [invoice.paidLabel, invoice.paid],
    [invoice.balanceDueLabel, invoice.balanceDue],
    ...(invoice.refund ? [[invoice.refundLabel, invoice.refund]] : []),
    [invoice.cashTenderedLabel, invoice.cashTendered],
    [invoice.changeLabel, invoice.change],
  ].map(([label, amount]) => `
    <div class="total-row"><span>${escapeHtml(label ?? '')}</span><strong>${escapeHtml(amount ?? '')}</strong></div>
  `).join('')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @page { margin: 18mm; }
      body { color: #202020; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      h1 { margin: 0 0 4px; font-size: 24px; }
      h2 { margin: 22px 0 10px; font-size: 18px; }
      p { margin: 4px 0; color: #555; }
      table { width: 100%; border-collapse: collapse; margin-top: 20px; }
      th, td { padding: 9px 5px; border-bottom: 1px solid #ddd; text-align: left; }
      th { font-size: 12px; color: #555; }
      .number { text-align: right; white-space: nowrap; }
      .totals { margin: 20px 0 0 auto; max-width: 320px; }
      .total-row { display: flex; justify-content: space-between; gap: 20px; padding: 5px 0; }
      .total-row strong { text-align: right; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(invoice.businessName)}</h1>
    <p>${escapeHtml(invoice.storeName)}</p>
    <h2>${escapeHtml(invoice.invoiceLabel)}</h2>
    <p>${escapeHtml(invoice.saleNumberLabel)}: ${escapeHtml(invoice.saleNumber)}</p>
    <p>${escapeHtml(invoice.dateLabel)}: ${escapeHtml(invoice.date)}</p>
    <p>${escapeHtml(invoice.customerLabel)}: ${escapeHtml(invoice.customerName ?? invoice.walkInLabel)}</p>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(invoice.itemLabel)}</th>
          <th class="number">${escapeHtml(invoice.quantityLabel)}</th>
          <th class="number">${escapeHtml(invoice.unitPriceLabel)}</th>
          <th class="number">${escapeHtml(invoice.totalLabel)}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="totals">${totals}</section>
  </body>
</html>`
}
