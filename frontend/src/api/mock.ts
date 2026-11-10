/**
 * DEVELOPMENT-ONLY mock adapter (in-memory). Keep it separate from production services (api/http.ts).
 * It mirrors the business rules the real backend must enforce: stock is changed only by sales/purchases/adjustments/restocks,
 * completed sales are never edited (only voided), mobile money is "confirmed" only after the provider answers.
 */
import type { Api, CustomerRow, SupplierRow, Report, ProductInput } from './api'
import type * as T from './types'
import { daysAgo, sleep, today } from '@/lib/utils'
import { translate } from '@/i18n'

const PERMS: Record<T.Role, string[]> = (() => {
  const all = ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'ai', 'employees', 'stores', 'subscription', 'void', 'discount', 'settings']
  return {
    owner: all, manager: all.filter((p) => p !== 'subscription'),
    storemgr: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'void', 'discount', 'settings'],
    cashier: ['dash', 'pos', 'sales', 'customers', 'settings'], accountant: ['dash', 'sales', 'customers', 'finance', 'reports', 'ai', 'settings'],
    invmgr: ['dash', 'catalog', 'inventory', 'purchases', 'settings'],
  }
})()
const PLANS = {
  pro: { features: { pos: true, inventory: true, barcode: true, multistore: true, advrep: true, ai: true }, limits: { stores: 3, employees: 10 } },
  book: { features: { pos: false, inventory: false, barcode: false, multistore: false, advrep: false, ai: true }, limits: { stores: 1, employees: 2 } },
}
let plan: 'pro' | 'book' = 'pro'
let business: T.Business | null = null
let stores: T.Store[] = [{ id: 's1', name: 'Duka Kuu' }, { id: 's2', name: 'Tawi la 2' }]
let role: T.Role = 'owner'
let name = 'Mmiliki'
let userEmail = 'owner@example.com'

const me = (): T.Me => ({
  user: { id: 'u1', name, email: userEmail, role, permissions: PERMS[role], isSuperAdmin: false }, business, stores,
  entitlements: { plan, status: 'active', renew: '2026-12-01', ...PLANS[plan] },
})

let cats: T.Category[] = [{ id: 1, name: 'Vinywaji', parent: 0 }, { id: 2, name: 'Soda', parent: 1 }, { id: 3, name: 'Maji', parent: 1 }, { id: 4, name: 'Vyakula', parent: 0 }, { id: 5, name: 'Usafi', parent: 0 }]
const v = (id: number, label: string, barcode: string, sku: string, buy: number, sell: number, stock: number, min: number): T.Variant => ({ id, label, barcode, sku, buy, sell, stock, min })
let prods: T.Product[] = [
  { id: 1, name: 'Pepsi', categoryId: 2, brand: 'Pepsi', unit: 'chupa', variants: [v(11, '300ml', '6001234500011', 'PEP-300', 400, 600, 48, 12), v(12, '500ml', '6001234500028', 'PEP-500', 600, 1000, 36, 12), v(13, '1.25L', '6001234500035', 'PEP-125', 1100, 1500, 10, 12), v(14, '2L', '6001234500042', 'PEP-2L', 1500, 2000, 0, 6)] },
  { id: 2, name: 'Sukari 1kg', categoryId: 4, brand: '', unit: 'kg', variants: [v(21, '', '6009876500011', 'SUK-1', 3200, 3500, 6, 10)] },
  { id: 3, name: 'Mafuta ya alizeti 1L', categoryId: 4, brand: '', unit: 'l', variants: [v(31, '', '6009876500028', 'MAF-1', 4800, 5500, 24, 8)] },
  { id: 4, name: 'Maji 1.5L', categoryId: 3, brand: '', unit: 'chupa', variants: [v(41, '', '6009876500035', 'MAJ-15', 700, 1000, 3, 10)] },
  { id: 5, name: 'Sabuni ya unga', categoryId: 5, brand: '', unit: 'pc', variants: [v(51, '', '', 'SAB-1', 1800, 2300, 0, 6)] },
]
let moves: T.Movement[] = [
  { date: '2026-11-07', product: 'Sukari 1kg', type: 'sale', qty: -4, ref: 'INV-0141', user: 'Cashier', store: 's1' },
  { date: '2026-11-06', product: 'Maji 1.5L', type: 'purchase', qty: 24, ref: 'PUR-0031', user: 'Owner', store: 's1' },
]
const it = (variantId: number, nm: string, qty: number, price: number): T.SaleItem => ({ variantId, name: nm, qty, price, discount: 0 })
const mk = (no: string, date: string, type: 'pos' | 'quick', customer: string, items: T.SaleItem[], paid: number, methods: T.Method[]): T.Sale => {
  const total = items.reduce((a, l) => a + l.price * l.qty, 0)
  return { no, date, type, customer, total, paid, initialPaid: paid, due: total - paid, methods, items, payments: paid > 0 ? [{ method: methods[0], amount: paid, status: 'confirmed' }] : [] }
}
let sales: T.Sale[] = [
  mk('INV-0148', '2026-11-08', 'pos', '', [it(21, 'Sukari 1kg', 2, 3500), it(31, 'Mafuta ya alizeti 1L', 1, 5500), it(12, 'Pepsi 500ml', 6, 1000)], 18500, ['cash']),
  mk('INV-0147', '2026-11-08', 'pos', 'Mama Neema', [it(21, 'Sukari 1kg', 6, 3500), it(31, 'Mafuta ya alizeti 1L', 2, 5500), it(12, 'Pepsi 500ml', 10, 1000)], 0, ['credit']),
  mk('INV-0146', '2026-11-07', 'pos', '', [it(14, 'Pepsi 2L', 1, 2000), it(31, 'Mafuta ya alizeti 1L', 1, 5500)], 7500, ['mm']),
  mk('INV-0131', '2026-10-20', 'pos', 'Bi Zawadi', [it(51, 'Sabuni ya unga', 10, 2500)], 0, ['credit']),
  mk('INV-0120', '2026-10-02', 'pos', 'Duka la Juma', [it(21, 'Sukari 1kg', 20, 3500), it(12, 'Pepsi 500ml', 10, 1000)], 30000, ['cash', 'credit']),
]
let customers: T.Person[] = [{ id: 'c1', name: 'Mama Neema', phone: '0713 111 222' }, { id: 'c2', name: 'Duka la Juma', phone: '0754 333 444' }, { id: 'c3', name: 'Bi Zawadi', phone: '0622 555 666' }]
let suppliers: T.Person[] = [{ id: 'v1', name: 'Kariakoo Wholesale', phone: '0765 000 222' }, { id: 'v2', name: 'Bakhresa Distributors', phone: '0712 000 111' }]
let purchases: T.Purchase[] = [{ no: 'PUR-0031', date: '2026-11-06', supplier: 'Kariakoo Wholesale', lines: [{ variantId: 41, name: 'Maji 1.5L', qty: 24, cost: 700 }], total: 16800, paid: 10000 }]
let supPays: { supplier: string; amount: number; method: T.Method; date: string }[] = []
let debtPays: { customer: string; amount: number; method: T.Method; date: string }[] = []
let expenses: T.Expense[] = [
  { id: 1, date: '2026-11-05', category: 'rent', amount: 150000, method: 'bank', store: 's1', description: 'Kodi ya duka' },
  { id: 2, date: '2026-11-07', category: 'transport', amount: 12000, method: 'cash', store: 's1', description: 'Usafiri wa mizigo' },
  { id: 3, date: '2026-11-03', category: 'electricity', amount: 35000, method: 'mm', store: 's1', description: 'LUKU' },
]
let employees: T.Employee[] = [
  { id: 'e1', name: 'Neema Joseph', email: 'neema@example.com', role: 'cashier', stores: ['s1'], permissions: ['manage_sales', 'view_dashboard'], status: 'active' },
  { id: 'e2', name: 'Juma Salim', email: 'juma@example.com', role: 'storemgr', stores: ['s1', 's2'], permissions: ['manage_products', 'manage_inventory', 'manage_sales', 'manage_orders', 'view_reports', 'view_dashboard'], status: 'active' },
]
const seenClient = new Map<string, T.Sale>()   // idempotency for offline retries
let sn = 148, pn = 31, rn = 0, an = 7

const flat = () => prods.filter((p) => !p.archived).flatMap((p) => p.variants.map((x) => ({ p, x, name: `${p.name} ${x.label}`.trim() })))
const lookup = (vid: number) => { for (const p of prods) for (const x of p.variants) if (x.id === vid) return { p, x, name: `${p.name} ${x.label}`.trim() }; return undefined }
const bal = (c: string) => sales.filter((s) => !s.voided && s.customer === c).reduce((a, s) => a + s.due, 0)
const aging = (c: string): [number, number, number] => {
  const b: [number, number, number] = [0, 0, 0]
  sales.filter((s) => !s.voided && s.customer === c && s.due > 0).forEach((s) => { const a = daysAgo(s.date); b[a <= 7 ? 0 : a <= 30 ? 1 : 2] += s.due })
  return b
}
const supBal = (n: string) => purchases.filter((p) => p.supplier === n).reduce((a, p) => a + p.total - p.paid, 0) - supPays.filter((p) => p.supplier === n).reduce((a, p) => a + p.amount, 0)
const lat = () => sleep(250)
const fail = (m: string) => { throw new Error(m) }

function applySale(p: T.SalePayload): T.Sale {
  const total = p.items.reduce((a, l) => a + l.price * l.qty - Math.min(l.discount, l.price * l.qty), 0)
  const sum = p.payments.reduce((a, x) => a + x.amount, 0)
  if (Math.round(sum) !== Math.round(total)) fail('Payments do not match the total')
  const credit = p.payments.filter((x) => x.method === 'credit').reduce((a, x) => a + x.amount, 0)
  if (credit > 0 && !p.customer) fail('Select a customer for credit sales')
  if (p.type === 'pos') for (const l of p.items) { const r = l.variantId ? lookup(l.variantId) : undefined; if (r && r.x.stock < l.qty) fail('STOCK_CONFLICT') }
  sn++
  const no = (p.type === 'pos' ? 'INV-' : 'QS-') + String(sn).padStart(4, '0')
  const date = today()
  if (p.type === 'pos') for (const l of p.items) { const r = l.variantId ? lookup(l.variantId) : undefined; if (r) { r.x.stock -= l.qty; moves.unshift({ date, product: r.name, type: 'sale', qty: -l.qty, ref: no, user: name, store: 's1' }) } }
  const sale: T.Sale = {
    no, date, type: p.type, customer: p.customer, total, paid: total - credit, initialPaid: total - credit, due: credit,
    methods: [...new Set(p.payments.filter((x) => x.amount > 0).map((x) => x.method))], items: p.items, description: p.description,
    payments: p.payments.filter((x) => x.amount > 0).map((x) => ({ method: x.method, amount: x.amount, status: x.method === 'credit' ? 'credit' : 'confirmed', ref: x.method === 'mm' ? 'MM' + Math.floor(Math.random() * 9e7 + 1e7) : x.method === 'bank' ? 'BK' + Math.floor(Math.random() * 9e7 + 1e7) : undefined })),
  }
  sales.unshift(sale); return sale
}

function cashbook(): T.CashEntry[] {
  const E: Omit<T.CashEntry, 'balance'>[] = [{ date: '2026-10-01', type: 'open', ref: '—', method: '', in: 500000, out: 0 }]
  sales.forEach((s) => {
    if (s.initialPaid > 0) E.push({ date: s.date, type: 'sale', ref: s.no, method: s.methods.filter((m) => m !== 'credit').join(', '), in: s.initialPaid, out: 0 })
    if (s.voided && s.paid > 0) E.push({ date: s.voidDate ?? s.date, type: 'refund', ref: s.no, method: '', in: 0, out: s.paid })
  })
  debtPays.forEach((x) => E.push({ date: x.date, type: 'collect', ref: x.customer, method: x.method, in: x.amount, out: 0 }))
  expenses.forEach((x) => E.push({ date: x.date, type: 'expense', ref: x.category, method: x.method, in: 0, out: x.amount }))
  purchases.forEach((x) => { if (x.paid > 0) E.push({ date: x.date, type: 'purchase', ref: x.no, method: '', in: 0, out: x.paid }) })
  supPays.forEach((x) => E.push({ date: x.date, type: 'spay', ref: x.supplier, method: x.method, in: 0, out: x.amount }))
  E.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let b = 0
  return E.map((e) => ({ ...e, balance: (b += e.in - e.out) }))
}

const range = (period: string): [string, string] => {
  const t = today(), d = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
  if (period === 'today') return [t, t]
  if (period === 'yest') return [d(1), d(1)]
  if (period === 'week') return [d(6), t]
  if (period === 'month') return [t.slice(0, 7) + '-01', t]
  if (period === 'year') return [t.slice(0, 4) + '-01-01', t]
  return ['0000-01-01', '9999-12-31']
}
const SF: Record<string, number> = { all: 1, s1: 0.62, s2: 0.38 }
function grossOf(list: T.Sale[]) {
  let rev = 0, cogs = 0
  list.filter((s) => s.type === 'pos').forEach((s) => s.items.forEach((l) => { const r = l.variantId ? lookup(l.variantId) : undefined; if (r) { rev += l.price * l.qty - l.discount; cogs += r.x.buy * l.qty } }))
  return { rev, cogs }
}

export const mockApi: Api = {
  auth: {
    async login(email, password) {
      await lat(); if (password.length < 8) fail('Invalid credentials')
      const r = (['owner', 'manager', 'storemgr', 'cashier', 'accountant', 'invmgr'] as T.Role[]).find((x) => email.toLowerCase().startsWith(x + '@'))
      role = r ?? 'owner'; userEmail = email; business = business ?? { id: 'b1', name: 'Duka Langu', mode: 'pos', currency: 'TZS', timezone: 'Africa/Dar_es_Salaam' }
      return { token: 'mock-token', me: me() }
    },
    async register(d) { await lat(); role = 'owner'; name = d.name; userEmail = d.email; business = null; return { token: 'mock-token', me: me() } },
    async forgot() { await lat() }, async reset() { await lat() }, async me() { await lat(); return me() },
  },
  business: {
    async create(d) { await lat(); business = { id: 'b1', name: d.name, mode: d.mode, currency: d.currency, timezone: d.timezone, type: d.type, phone: d.phone, address: d.address, region: d.region }; stores[0].name = d.storeName; plan = d.mode === 'quick' ? 'book' : 'pro'; return me() },
    async update(d) { await lat(); if (business) business = { ...business, ...d }; if (d.mode) plan = d.mode === 'quick' ? 'book' : 'pro'; return me() },
  },
  catalog: {
    async categories() { await lat(); return cats.filter((c) => !c.archived) },
    async addCategory(n, parent) {
      await lat(); if (cats.some((c) => !c.archived && c.parent === parent && c.name.toLowerCase() === n.toLowerCase())) fail('DUPLICATE')
      const c = { id: Date.now(), name: n, parent }; cats.push(c); return c
    },
    async archiveCategory(id) { await lat(); if (prods.some((p) => !p.archived && p.categoryId === id)) fail('CATEGORY_HAS_PRODUCTS'); const c = cats.find((x) => x.id === id); if (c) c.archived = true },
    async products() { await lat(); return prods.filter((p) => !p.archived) },
    async saveProduct(x: ProductInput) {
      await lat()
      const codes = prods.filter((p) => p.id !== x.id).flatMap((p) => p.variants.map((q) => q.barcode)).filter(Boolean)
      if (x.variants.some((q) => q.barcode && codes.includes(q.barcode))) fail('DUPLICATE_BARCODE')
      const existing = prods.find((p) => p.id === x.id)
      const variants: T.Variant[] = x.variants.map((q, i) => {
        const old = existing?.variants.find((o) => o.id === q.id)
        if (old) return { ...old, label: q.label, barcode: q.barcode, sku: q.sku, buy: q.buy, sell: q.sell, min: q.min }   // stock is never edited here
        const nv = { ...q, id: Date.now() + i, stock: q.stock || 0 }
        if (nv.stock > 0) moves.unshift({ date: today(), product: `${x.name} ${q.label}`.trim(), type: 'opening', qty: nv.stock, ref: 'OPEN', user: name, store: 's1' })
        return nv
      })
      const rec: T.Product = { id: x.id ?? Date.now(), name: x.name, categoryId: x.categoryId, brand: x.brand, unit: x.unit, image: x.image, variants }
      prods = existing ? prods.map((p) => (p.id === rec.id ? rec : p)) : [...prods, rec]
      return rec
    },
    async archiveProduct(id) { await lat(); const p = prods.find((x) => x.id === id); if (p) p.archived = true },
    async restock(variantId, d) {
      await lat(); const r = lookup(variantId); if (!r || d.qty <= 0 || d.sell <= 0) fail('INVALID')
      r!.x.stock += d.qty; r!.x.buy = d.buy; r!.x.sell = d.sell; rn++
      moves.unshift({ date: today(), product: r!.name, type: 'restock', qty: d.qty, ref: 'RST-' + String(rn).padStart(4, '0'), user: name, store: 's1' })
    },
  },
  inventory: {
    async movements() { await lat(); return moves },
    async adjust(d) {
      await lat(); const r = lookup(d.variantId); if (!r || !d.qty) fail('INVALID'); if (r!.x.stock + d.qty < 0) fail('NEGATIVE_STOCK')
      r!.x.stock += d.qty; an++; moves.unshift({ date: today(), product: r!.name, type: 'adjust', qty: d.qty, ref: 'ADJ-' + String(an).padStart(4, '0'), user: name, store: 's1' })
    },
  },
  sales: {
    async list() { await lat(); return sales },
    async create(p) {
      await sleep(p.payments.some((x) => x.method === 'mm') ? 1200 : 300)       // provider confirmation
      const seen = seenClient.get(p.clientId); if (seen) return seen
      const s = applySale(p); seenClient.set(p.clientId, s); return s
    },
    async voidSale(no, reason) {
      await lat(); const s = sales.find((x) => x.no === no); if (!s || s.voided) fail('INVALID'); if (!reason.trim()) fail('REASON_REQUIRED')
      s!.voided = true; s!.voidDate = today()
      s!.items.forEach((l) => { const r = l.variantId ? lookup(l.variantId) : undefined; if (r && s!.type === 'pos') { r.x.stock += l.qty; moves.unshift({ date: today(), product: r.name, type: 'return', qty: l.qty, ref: no, user: name, store: 's1' }) } })
    },
  },
  people: {
    async customers(): Promise<CustomerRow[]> { await lat(); return customers.map((c) => ({ ...c, balance: bal(c.name), aging: aging(c.name) })) },
    async addCustomer(n, ph) { await lat(); if (customers.some((c) => c.name.toLowerCase() === n.toLowerCase())) fail('DUPLICATE'); customers.push({ id: 'c' + Date.now(), name: n, phone: ph }) },
    async payDebt(c, amount, method) {
      await lat(); if (amount <= 0 || amount > bal(c)) fail('INVALID_AMOUNT')
      let left = amount
      sales.filter((s) => !s.voided && s.customer === c && s.due > 0).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((s) => { const k = Math.min(left, s.due); s.due -= k; s.paid += k; left -= k })
      debtPays.push({ customer: c, amount, method, date: today() })
    },
    async suppliers(): Promise<SupplierRow[]> { await lat(); return suppliers.map((s) => ({ ...s, balance: supBal(s.name) })) },
    async addSupplier(n, ph) { await lat(); if (suppliers.some((s) => s.name.toLowerCase() === n.toLowerCase())) fail('DUPLICATE'); suppliers.push({ id: 'v' + Date.now(), name: n, phone: ph }) },
    async paySupplier(n, amount, method) { await lat(); if (amount <= 0 || amount > supBal(n)) fail('INVALID_AMOUNT'); supPays.push({ supplier: n, amount, method, date: today() }) },
    async purchases() { await lat(); return purchases },
    async createPurchase(p) {
      await lat(); pn++
      const no = 'PUR-' + String(pn + 1).padStart(4, '0'), lines = p.lines.map((l) => { const r = lookup(l.variantId)!; r.x.stock += l.qty; moves.unshift({ date: today(), product: r.name, type: 'purchase', qty: l.qty, ref: no, user: name, store: 's1' }); return { variantId: l.variantId, name: r.name, qty: l.qty, cost: l.cost } })
      const rec = { no, date: today(), supplier: p.supplier, lines, total: lines.reduce((a, l) => a + l.qty * l.cost, 0), paid: p.paid }
      purchases.unshift(rec); return rec
    },
  },
  finance: {
    async expenses() { await lat(); return expenses },
    async saveExpense(e) {
      await lat(); if (e.id) { const i = expenses.findIndex((x) => x.id === e.id); expenses[i] = { ...expenses[i], ...e, edited: true } as T.Expense; return expenses[i] }
      const x = { ...e, id: Date.now() } as T.Expense; expenses.push(x); return x
    },
    async cashbook() { await lat(); return cashbook() },
    async dashboard(period, storeId): Promise<T.Dashboard> {
      await lat(); const [a, b] = range(period), f = SF[storeId] ?? 1
      const list = sales.filter((s) => !s.voided && s.date >= a && s.date <= b), tot = list.reduce((x, s) => x + s.total, 0), rec = list.reduce((x, s) => x + s.initialPaid, 0)
      const ex = expenses.filter((e) => e.date >= a && e.date <= b).reduce((x, e) => x + e.amount, 0)
      const gp = business?.mode === 'quick' ? null : (() => { const g = grossOf(list); return g.rev - g.cogs })()
      const qty: Record<string, number> = {}; list.forEach((s) => s.items.forEach((l) => { qty[l.name] = (qty[l.name] ?? 0) + l.qty }))
      const series = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return { label: d.slice(5), value: sales.filter((s) => !s.voided && s.date === d).reduce((x, s) => x + s.total, 0) } })
      return {
        sales: tot * f, received: rec * f, debt: (tot - rec) * f, expenses: ex * f, grossProfit: gp === null ? null : gp * f, netProfit: ((gp ?? rec) - ex) * f,
        recent: sales.slice(0, 5), top: Object.entries(qty).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([n, q]) => ({ name: n, qty: q })),
        low: flat().filter((r) => r.x.stock <= r.x.min).map((r) => ({ name: r.name, stock: r.x.stock })).slice(0, 4),
        byStore: [{ store: 's1', sales: tot * SF.s1 }, { store: 's2', sales: tot * SF.s2 }], series,
      }
    },
    async report(from, to, group): Promise<Report> {
      await lat(); const list = sales.filter((s) => !s.voided && (!from || s.date >= from) && (!to || s.date <= to))
      const key = (d: string) => group === 'day' ? d : group === 'month' ? d.slice(0, 7) : group === 'year' ? d.slice(0, 4) : (() => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) })()
      const g: Record<string, { value: number; count: number }> = {}; list.forEach((s) => { const k = key(s.date); g[k] ??= { value: 0, count: 0 }; g[k].value += s.total; g[k].count++ })
      const ex = expenses.filter((e) => (!from || e.date >= from) && (!to || e.date <= to)), exT = ex.reduce((a, e) => a + e.amount, 0)
      const gr = grossOf(list), gp = business?.mode === 'quick' ? null : gr.rev - gr.cogs
      const sold: Record<string, number> = {}; list.forEach((s) => s.items.forEach((l) => { sold[l.name] = (sold[l.name] ?? 0) + l.qty }))
      const debtors = customers.filter((c) => bal(c.name) > 0), ag = [0, 1, 2].map((i) => debtors.reduce((a, c) => a + aging(c.name)[i], 0)) as [number, number, number]
      const rows = flat()
      return {
        revenue: list.reduce((a, s) => a + s.total, 0), received: list.reduce((a, s) => a + s.initialPaid, 0), cogs: gr.cogs, grossProfit: gp, expenses: exT,
        operatingProfit: (gp ?? list.reduce((a, s) => a + s.initialPaid, 0)) - exT, estimate: true,
        salesByPeriod: Object.keys(g).sort().map((k) => ({ label: k, ...g[k] })),
        expensesByCategory: [...new Set(ex.map((e) => e.category))].map((c) => ({ label: c, value: ex.filter((e) => e.category === c).reduce((a, e) => a + e.amount, 0) })),
        debts: { total: ag[0] + ag[1] + ag[2], aging: ag, top: debtors.map((c) => ({ name: c.name, balance: bal(c.name) })).sort((a, b) => b.balance - a.balance).slice(0, 5) },
        inventory: { cost: rows.reduce((a, r) => a + r.x.stock * r.x.buy, 0), retail: rows.reduce((a, r) => a + r.x.stock * r.x.sell, 0), low: rows.filter((r) => r.x.stock > 0 && r.x.stock <= r.x.min).length, out: rows.filter((r) => r.x.stock <= 0).length },
        best: Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, q]) => ({ name: n, qty: q })),
        slow: rows.filter((r) => r.x.stock > 0 && !sold[r.name]).map((r) => ({ name: r.name, stock: r.x.stock })),
      }
    },
  },
  ai: {
    /** Rule-based stand-in for the real AI endpoint. It is read-only: it can never change stock, prices, payments or sales. */
    async ask(q, lang) {
      await sleep(700); const x = q.toLowerCase(), t = (k: string, v?: Record<string, string | number>) => translate(lang, k, v), m = (n: number) => 'TZS ' + Math.round(n).toLocaleString('en-US')
      const month = today().slice(0, 7), ctx = month
      if (/badilisha|change price|futa|delete|sasisha|update stock|refund|rudisha/.test(x)) return { text: t('a_act'), cards: [], recommendation: false, context: ctx }
      if (/madeni|deni|debt|owe/.test(x)) {
        const d = customers.filter((c) => bal(c.name) > 0).sort((a, b) => bal(b.name) - bal(a.name)), tt = d.reduce((a, c) => a + bal(c.name), 0)
        return { text: d.length ? t('a_debt', { v: m(tt) }) + '\n' + d.slice(0, 3).map((c) => `• ${c.name} — ${m(bal(c.name))}`).join('\n') : t('a_debt0'), cards: d.length ? [{ title: t('c_bal'), value: m(tt) }] : [], recommendation: false, context: ctx }
      }
      if (/kuisha|stoo|stock|low|running low/.test(x)) {
        const lo = flat().filter((r) => r.x.stock <= r.x.min)
        return { text: lo.length ? t('a_low') + '\n' + lo.map((r) => `• ${r.name} — ${r.x.stock} ${t('left')}`).join('\n') : t('a_low0'), cards: [], recommendation: false, context: ctx }
      }
      if (/zinazouzwa|best|top|selling|sell the most/.test(x)) {
        const s: Record<string, number> = {}; sales.filter((z) => !z.voided).forEach((z) => z.items.forEach((l) => { s[l.name] = (s[l.name] ?? 0) + l.qty }))
        const top = Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 5)
        return { text: top.length ? t('a_best') + '\n' + top.map(([n, c]) => `• ${n} — ${c} ${t('units')}`).join('\n') : t('a_none'), cards: [], recommendation: false, context: ctx }
      }
      if (/compare|linganisha|last month|uliopita/.test(x)) {
        const prev = new Date(); prev.setUTCDate(1); prev.setUTCMonth(prev.getUTCMonth() - 1); const m0 = prev.toISOString().slice(0, 7)
        const sm = (k: string) => sales.filter((s) => !s.voided && s.date.startsWith(k)).reduce((a, s) => a + s.total, 0), v1 = sm(month), v0 = sm(m0)
        const ch = v0 ? (v1 >= v0 ? t('a_up', { p: Math.round(((v1 - v0) / v0) * 100) }) : t('a_down', { p: Math.round(((v0 - v1) / v0) * 100) })) : t('a_nopr')
        return { text: t('a_cmp', { m1: month, v1: m(v1), m0, v0: m(v0), ch }), cards: [{ title: month, value: m(v1) }, { title: m0, value: m(v0) }], recommendation: false, context: `${m0} → ${month}` }
      }
      if (/improve|boost|kuongeza|nifanyeje|how can/.test(x)) {
        const L: string[] = [], lo = flat().filter((r) => r.x.stock <= r.x.min), old = customers.reduce((a, c) => a + aging(c.name)[2], 0)
        if (lo.length) L.push(t('a_imp1', { n: lo.length, e: lo[0].name })); if (old > 0) L.push(t('a_imp2', { v: m(old) }))
        return { text: L.length ? t('a_imp') + '\n' + L.map((s) => '• ' + s).join('\n') : t('a_imp0'), cards: [], recommendation: true, context: ctx }
      }
      if (/leo|today|mauzo|sold|sales|nimeuza/.test(x)) {
        let day = today(), l = sales.filter((s) => !s.voided && s.date === day)
        if (!l.length) { day = sales.filter((s) => !s.voided).map((s) => s.date).sort().pop() ?? day; l = sales.filter((s) => !s.voided && s.date === day) }
        const v1 = l.reduce((a, s) => a + s.total, 0), r = l.reduce((a, s) => a + s.initialPaid, 0)
        return { text: day === today() ? t('a_sales_ok', { d: day, v: m(v1), r: m(r) }) : t('a_sales_old', { d: day, v: m(v1) }), cards: [{ title: t('k_sales'), value: m(v1) }, { title: t('x_paid'), value: m(r) }], recommendation: false, context: day }
      }
      return { text: t('a_unk'), cards: [], recommendation: false, context: ctx }
    },
  },
  sync: {
    async push(items) {
      await sleep(500)
      return items.map((p): T.SyncResult => {
        try { const s = seenClient.get(p.clientId) ?? (() => { const r = applySale(p); seenClient.set(p.clientId, r); return r })(); return { clientId: p.clientId, state: 'synced', message: s.no } }
        catch (e) { const msg = (e as Error).message; return { clientId: p.clientId, state: msg === 'STOCK_CONFLICT' ? 'conflict' : 'failed', message: msg } }
      })
    },
  },
  admin: {
    async employees() { await lat(); return employees },
    async invite(d) {
      await lat(); if (employees.some((e) => e.email.toLowerCase() === d.email.toLowerCase())) fail('DUPLICATE')
      if (employees.length >= PLANS[plan].limits.employees) fail('PLAN_LIMIT'); employees.push({ id: 'e' + Date.now(), name: d.email, ...d, status: 'invited' })
    },
    async updateEmployee(id, patch) { await lat(); employees = employees.map((e) => (e.id === id ? { ...e, ...patch } : e)) },
    async setPlan(p) { await lat(); plan = p; if (business) business.mode = p === 'book' ? 'quick' : 'pos'; return me() },
  },
  platformAdmin: {
    async analytics() { await lat(); return { business_count: 0, active_business_count: 0, user_count: 0, active_subscription_count: 0, pending_subscription_count: 0, confirmed_subscription_revenue: null, currency: null } },
    async businesses() { await lat(); return [] },
    async users() { await lat(); return [] },
    async plans() { await lat(); return [] },
    async audit() { await lat(); return [] },
    async createPlan() { await lat() },
    async setBusinessStatus() { await lat() },
    async setUserStatus() { await lat() },
    async grantPlan() { await lat() },
  },
}
