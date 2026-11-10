import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTzs, multiplyMoney, parseTzsAmount } from '../src/domain/money.ts'
import { cashSaleInput, productInput, workspaceInput } from '../src/domain/validation.ts'
import { normalizeApiBaseUrl } from '../src/domain/apiUrl.ts'
import { buildInvoiceHtml } from '../src/domain/invoiceHtml.ts'

test('parses only safe whole-TZS amounts', () => {
  assert.equal(parseTzsAmount('1,250'), 1250)
  assert.equal(parseTzsAmount('0'), 0)
  assert.equal(parseTzsAmount('12.50'), null)
  assert.equal(parseTzsAmount('-1'), null)
  assert.equal(parseTzsAmount(String(Number.MAX_SAFE_INTEGER + 1)), null)
})

test('multiplies money using safe integer arithmetic', () => {
  assert.equal(multiplyMoney(1200, 3), 3600)
  assert.throws(() => multiplyMoney(1200, 0), /positive whole number/)
  assert.throws(() => multiplyMoney(Number.MAX_SAFE_INTEGER, 2), /too large/)
})

test('formats TZS without fractional values', () => {
  assert.match(formatTzs(1250), /1,250/)
  assert.match(formatTzs(1250, 'sw'), /1,250/)
  assert.throws(() => formatTzs(-1), /non-negative/)
})

test('printable invoice escapes user-entered text and includes monetary summary', () => {
  const html = buildInvoiceHtml({
    businessName: '<Shop & Co>',
    storeName: 'Main Store',
    invoiceLabel: 'Invoice',
    saleNumberLabel: 'Sale',
    dateLabel: 'Date',
    customerLabel: 'Customer',
    walkInLabel: 'Walk-in',
    itemLabel: 'Item',
    quantityLabel: 'Qty',
    unitPriceLabel: 'Unit price',
    totalLabel: 'Total',
    paidLabel: 'Paid',
    balanceDueLabel: 'Balance due',
    cashTenderedLabel: 'Cash received',
    changeLabel: 'Change',
    refundLabel: 'Refund',
    saleNumber: 'S-100',
    date: 'Nov 10, 2026',
    customerName: '<script>alert(1)</script>',
    total: 'TZS 1,000',
    paid: 'TZS 1,000',
    balanceDue: 'TZS 0',
    cashTendered: 'TZS 1,000',
    change: 'TZS 0',
    refund: null,
    items: [{ quantity: '2', name: 'Tea <strong>', unitPrice: 'TZS 500', lineTotal: 'TZS 1,000' }],
  })
  assert.ok(html.includes('&lt;Shop &amp; Co&gt;'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('Tea &lt;strong&gt;'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('TZS 1,000'))
})

test('normalizes API URLs and rejects insecure non-local servers', () => {
  assert.equal(normalizeApiBaseUrl('https://api.example.com'), 'https://api.example.com/api/v1')
  assert.equal(normalizeApiBaseUrl('https://api.example.com/api/v1/'), 'https://api.example.com/api/v1')
  assert.equal(normalizeApiBaseUrl('http://10.0.2.2:8000'), 'http://10.0.2.2:8000/api/v1')
  assert.throws(() => normalizeApiBaseUrl('http://api.example.com'), /Use HTTPS/)
  assert.throws(() => normalizeApiBaseUrl('https://user:password@api.example.com'), /cannot contain credentials/)
})

test('validates workspace, product and unique sale lines', () => {
  assert.equal(workspaceInput.safeParse({ ownerName: 'A', businessName: 'Shop', storeName: 'Main' }).success, false)
  assert.equal(workspaceInput.safeParse({
    ownerName: 'Asha Mushi',
    ownerUsername: 'asha',
    ownerPassword: 'a-secure-local-password',
    businessName: 'Shop',
    storeName: 'Main',
  }).success, true)
  assert.equal(productInput.safeParse({
    name: 'Tea',
    sku: 'TEA-1',
    unitCode: 'pcs',
    costPriceMinor: 100,
    sellPriceMinor: 150,
    initialQuantity: 3,
    lowStockThreshold: 1,
  }).success, true)

  const variantId = 'c3127499-f139-4ffb-800e-5514f0457913'
  assert.equal(cashSaleInput.safeParse({
    items: [{ variantId, quantity: 1 }, { variantId, quantity: 2 }],
    cashTenderedMinor: 1000,
  }).success, false)
})
