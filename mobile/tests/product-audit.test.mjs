import assert from 'node:assert/strict'
import test from 'node:test'
import { productAuditAction, productAuditDetails } from '../src/domain/productAuditPresentation.ts'

const number = (value) => new Intl.NumberFormat('en-TZ').format(value)

test('product audit details turn created product JSON into labeled values', () => {
  const details = productAuditDetails({
    eventType: 'created',
    categoryName: '',
    beforeJson: null,
    afterJson: JSON.stringify({ name: 'maji', sku: 'UNQ-9', costPriceMinor: 1500, sellPriceMinor: 2000, initialQuantity: 1, lowStockThreshold: 10 }),
  }, number)

  assert.deepEqual(details.map(({ labelKey, current }) => [labelKey, current]), [
    ['products.audit.name', 'maji'],
    ['products.audit.sku', 'UNQ-9'],
    ['products.audit.purchasePrice', 'TSh 1,500'],
    ['products.audit.sellingPrice', 'TSh 2,000'],
    ['products.audit.initialQuantity', '1'],
    ['products.audit.lowStockThreshold', '10'],
  ])
})

test('product audit details show changed values and never expose malformed JSON', () => {
  const details = productAuditDetails({
    eventType: 'updated',
    categoryName: '',
    beforeJson: JSON.stringify({ sellPriceMinor: 1000 }),
    afterJson: JSON.stringify({ sellPriceMinor: 1200 }),
  }, number)
  assert.deepEqual(details[0], {
    key: 'sellPriceMinor',
    labelKey: 'products.audit.sellingPrice',
    previous: 'TSh 1,000',
    current: 'TSh 1,200',
  })
  assert.deepEqual(productAuditDetails({ eventType: 'updated', categoryName: '', beforeJson: null, afterJson: '{broken' }, number), [])
  assert.equal(productAuditAction('future_event'), 'unknown')
})

test('stock adjustment history uses readable quantity and reason fields', () => {
  const details = productAuditDetails({
    eventType: 'stock_adjusted',
    categoryName: '',
    beforeJson: JSON.stringify({ reason: 'Damaged' }),
    afterJson: JSON.stringify({ quantityDelta: -2, reason: 'Damaged' }),
  }, number)
  assert.deepEqual(details.map(({ labelKey, current }) => [labelKey, current]), [
    ['products.audit.quantityChange', '-2'],
    ['products.audit.reason', 'Damaged'],
  ])
})

test('product audit history presents category changes as before and after values', () => {
  const details = productAuditDetails({
    eventType: 'updated',
    categoryName: 'Vinywaji',
    beforeJson: JSON.stringify({ categoryName: 'Vyakula' }),
    afterJson: JSON.stringify({ name: 'Maji' }),
  }, number)
  assert.deepEqual(details.at(-1), {
    key: 'categoryName',
    labelKey: 'products.audit.category',
    previous: 'Vyakula',
    current: 'Vinywaji',
  })
})
