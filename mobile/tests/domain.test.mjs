import assert from 'node:assert/strict'
import test from 'node:test'
import { cartTotal, formatTzs, multiplyMoney, parseTzsAmount } from '../src/domain/money.ts'
import { cashSaleInput, productInput, workspaceInput } from '../src/domain/validation.ts'
import {
  defaultApiBaseUrl,
  normalizeApiBaseUrl,
  PRODUCTION_API_BASE_URL,
} from '../src/domain/apiUrl.ts'
import { buildInvoiceHtml } from '../src/domain/invoiceHtml.ts'
import { dashboardMetrics } from '../src/domain/dashboard.ts'
import { buildProductQrHtml, generateProductQr } from '../src/domain/productQr.ts'
import { isPlatformAdmin, postLoginRoute } from '../src/domain/platformAdmin.ts'
import { firstAuthIssue, validateEmailAddress, validateOnlineLogin, validateOnlineRegistration } from '../src/domain/authValidation.ts'
import { passwordVisibilityState, togglePasswordVisibility } from '../src/domain/passwordVisibility.ts'

test('maps backend dashboard amounts and counts without losing report fields', () => {
  assert.deepEqual(dashboardMetrics({
    sales: { net_sales: '1240.50', total_transactions: 4 },
    profit: { net_profit: '500.25' },
    inventory: { total_quantity: '19', low_stock_items: [{}, {}] },
    debtors: { total_outstanding: '350', customer_count: 2 },
    suppliers: { total_payables: '120', supplier_count: 3 },
    store_performance: [{ expense_total: '60', net_cash: '90' }],
  }), {
    salesTotal: 1241,
    transactionCount: 4,
    netProfit: 500,
    stockQuantity: 19,
    lowStockCount: 2,
    customerDebt: 350,
    customerCount: 2,
    supplierPayable: 120,
    supplierCount: 3,
    expenses: 60,
    netCash: 90,
  })

  test('generates a local QR matrix from SKU and safely formats a printable label', () => {
    const qr = generateProductQr('TEA-250')
    assert.ok(qr.size > 0)
    assert.equal(qr.modules.length, qr.size * qr.size)
    assert.throws(() => generateProductQr('  '), /SKU is required/)
    const html = buildProductQrHtml({
      title: 'QR code',
      productName: '<Tea & Co>',
      sku: 'TEA-250',
      qr,
    })
    assert.ok(html.includes('<svg'))
    assert.ok(html.includes('<path d="'))
    assert.ok(html.includes('&lt;Tea &amp; Co&gt;'))
    assert.ok(html.includes('TEA-250'))
  })
  assert.throws(() => dashboardMetrics({
    sales: { net_sales: 'NaN', total_transactions: 0 },
    profit: { net_profit: 0 },
    inventory: { total_quantity: 0, low_stock_items: [] },
    debtors: { total_outstanding: 0, customer_count: 0 },
    suppliers: { total_payables: 0, supplier_count: 0 },
    store_performance: [],
  }), /invalid dashboard amount/)
})

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

test('cart total omits removed zero-quantity lines while keeping money validation strict', () => {
  assert.equal(cartTotal([
    { unitAmount: 1200, quantity: 2 },
    { unitAmount: 700, quantity: 0 },
  ]), 2400)
  assert.equal(cartTotal([{ unitAmount: 700, quantity: 0 }]), 0)
  assert.throws(() => cartTotal([{ unitAmount: 700, quantity: -1 }]), /positive whole number/)
  assert.throws(() => multiplyMoney(700, 0), /positive whole number/)
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
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1:8000'), 'http://127.0.0.1:8000/api/v1')
  assert.throws(() => normalizeApiBaseUrl('http://api.example.com'), /Use HTTPS/)
  assert.throws(() => normalizeApiBaseUrl('https://user:password@api.example.com'), /cannot contain credentials/)
})

test('selects a safe production API URL and keeps localhost development support', () => {
  assert.equal(defaultApiBaseUrl(true), 'http://127.0.0.1:8000/api/v1')
  assert.equal(defaultApiBaseUrl(true, 'http://10.0.2.2:8000'), 'http://10.0.2.2:8000/api/v1')
  assert.equal(defaultApiBaseUrl(false), PRODUCTION_API_BASE_URL)
  assert.equal(defaultApiBaseUrl(false, PRODUCTION_API_BASE_URL), PRODUCTION_API_BASE_URL)
  assert.throws(() => defaultApiBaseUrl(false, 'http://127.0.0.1:8000'), /ShopFlow production API/)
  assert.throws(() => defaultApiBaseUrl(false, 'https://api.example.com'), /ShopFlow production API/)
})

test('routes only the backend-confirmed super admin to platform administration', () => {
  assert.equal(isPlatformAdmin({ is_super_admin: true }), true)
  assert.equal(postLoginRoute({ is_super_admin: true }), '/platform-admin')
  assert.equal(isPlatformAdmin({ is_super_admin: false }), false)
  assert.equal(postLoginRoute({ is_super_admin: false }), '/businesses')
  assert.equal(isPlatformAdmin(null), false)
  assert.equal(isPlatformAdmin({ is_super_admin: 'true' }), false)
})

test('validates online login and registration using backend field limits', () => {
  assert.equal(validateEmailAddress('  wilbardmagaso777@gmail.com  '), null)
  assert.equal(validateEmailAddress('   '), 'errors.emailRequired')
  assert.equal(validateEmailAddress('not-an-email'), 'errors.emailInvalid')
  assert.deepEqual(validateOnlineLogin('', ''), [
    { field: 'email', message: 'errors.emailRequired' },
    { field: 'password', message: 'errors.onlinePasswordRequired' },
  ])
  assert.deepEqual(validateOnlineLogin('invalid', 'password123'), [
    { field: 'email', message: 'errors.emailInvalid' },
  ])

  const valid = {
    fullName: 'Asha Mushi',
    email: 'asha@example.com',
    phone: '+255700000000',
    businessName: 'Asha Shop',
    password: 'Secure-Password123',
    confirmPassword: 'Secure-Password123',
  }
  assert.deepEqual(validateOnlineRegistration(valid), [])
  assert.deepEqual(validateOnlineRegistration({ ...valid, confirmPassword: 'different' }), [
    { field: 'confirmPassword', message: 'errors.passwordMismatch' },
  ])
  assert.deepEqual(validateOnlineRegistration({ ...valid, password: 'short', confirmPassword: 'short' }), [
    { field: 'password', message: 'errors.onlinePasswordLength' },
  ])
  assert.deepEqual(validateOnlineRegistration({
    ...valid,
    fullName: 'A',
    email: 'bad',
    phone: '1'.repeat(33),
    businessName: 'B',
    password: 'x'.repeat(129),
    confirmPassword: 'x'.repeat(129),
  }), [
    { field: 'fullName', message: 'errors.onlineFullName' },
    { field: 'email', message: 'errors.emailInvalid' },
    { field: 'phone', message: 'errors.phoneMax' },
    { field: 'businessName', message: 'errors.onlineBusinessName' },
    { field: 'password', message: 'errors.passwordMax' },
  ])
  assert.deepEqual(firstAuthIssue([
    { field: 'email', message: 'errors.emailRequired' },
    { field: 'email', message: 'errors.emailInvalid' },
  ]), { email: 'errors.emailRequired' })
})

test('password visibility toggles independently between hidden and visible states', () => {
  assert.deepEqual(passwordVisibilityState(false), {
    secureTextEntry: true,
    accessibilityLabel: 'auth.showPassword',
  })
  const visible = togglePasswordVisibility(false)
  assert.equal(visible, true)
  assert.deepEqual(passwordVisibilityState(visible), {
    secureTextEntry: false,
    accessibilityLabel: 'auth.hidePassword',
  })
  assert.equal(togglePasswordVisibility(visible), false)
  assert.deepEqual(passwordVisibilityState(false), {
    secureTextEntry: true,
    accessibilityLabel: 'auth.showPassword',
  })
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
