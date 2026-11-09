import { describe, expect, it } from 'vitest'
import { sw } from '../i18n/sw'
import { en } from '../i18n/en'
import { translate } from '../i18n'
import { effectivePayments, totals, validatePayments } from '../lib/cart'
import { tzs } from '../lib/utils'
import { mockApi } from '../api/mock'

describe('i18n', () => {
  it('has the same keys in Kiswahili and English', () => { expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort()) })
  it('translates with variables', () => { expect(translate('en', 'a_sales_ok', { d: 'D', v: 'V', r: 'R' })).toContain('Today (D)') })
  it('uses the spec translations', () => { expect(sw.nav.dash).toBe('Dashibodi'); expect(sw.nav.products).toBe('Bidhaa'); expect(sw.x_complete).toBe('Kamilisha Mauzo') })
})
describe('cart', () => {
  const items = [{ name: 'a', qty: 2, price: 3500, discount: 500 }, { name: 'b', qty: 1, price: 1000, discount: 0 }]
  it('computes totals with discounts', () => { expect(totals(items)).toEqual({ sub: 8000, discount: 500, total: 7500 }) })
  it('assigns the remainder to the first empty payment row', () => { expect(effectivePayments(7500, [{ method: 'cash', amount: '1000' }, { method: 'mm', amount: '' }])).toEqual([{ method: 'cash', amount: 1000 }, { method: 'mm', amount: 6500 }]) })
  it('validates payments', () => {
    expect(validatePayments(7500, [{ method: 'cash', amount: 7000 }], '', false)).toBe('x_short')
    expect(validatePayments(7500, [{ method: 'credit', amount: 7500 }], '', false)).toBe('x_needc')
    expect(validatePayments(7500, [{ method: 'mm', amount: 7500 }], '', true)).toBe('o_cashonly')
    expect(validatePayments(7500, [{ method: 'cash', amount: 7500 }], '', true)).toBe('')
  })
  it('formats TZS', () => { expect(tzs(50000)).toBe('TZS 50,000') })
})
describe('mock backend rules', () => {
  it('only changes stock through restock/adjust and rejects negative stock', async () => {
    const before = (await mockApi.catalog.products()).find((p) => p.id === 5)!.variants[0].stock
    await mockApi.catalog.restock(51, { qty: 24, buy: 1800, sell: 2300 })
    expect((await mockApi.catalog.products()).find((p) => p.id === 5)!.variants[0].stock).toBe(before + 24)
    await expect(mockApi.inventory.adjust({ variantId: 51, qty: -1000, reason: 'damaged' })).rejects.toThrow('NEGATIVE_STOCK')
  })
  it('de-duplicates offline retries by clientId', async () => {
    const p = { clientId: 'dup-1', type: 'pos' as const, customer: '', items: [{ variantId: 31, name: 'x', qty: 1, price: 5500, discount: 0 }], payments: [{ method: 'cash' as const, amount: 5500 }] }
    const a = await mockApi.sync.push([p]), b = await mockApi.sync.push([p])
    expect(a[0].state).toBe('synced'); expect(b[0].message).toBe(a[0].message)
  })
  it('flags a stock conflict instead of overselling', async () => {
    const r = await mockApi.sync.push([{ clientId: 'c-1', type: 'pos', customer: '', items: [{ variantId: 31, name: 'x', qty: 9999, price: 1, discount: 0 }], payments: [{ method: 'cash', amount: 9999 }] }])
    expect(r[0].state).toBe('conflict')
  })
})
