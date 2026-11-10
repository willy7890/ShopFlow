import type * as T from './types'

export interface ProductInput {
  id?: number; name: string; categoryId: number; brand: string; unit: string; image?: string
  variants: (Omit<T.Variant, 'id' | 'stock'> & { id?: number; stock: number })[]
}
export interface BusinessInput {
  name: string; type: string; phone: string; email?: string; address: string; region: string; currency: string; timezone: string
  mode: 'pos' | 'quick'; storeName: string; inviteEmail?: string
}
export interface CustomerRow extends T.Person { balance: number; aging: [number, number, number] }
export interface SupplierRow extends T.Person { balance: number }
export interface Report {
  revenue: number; received: number; cogs: number; grossProfit: number | null; expenses: number; operatingProfit: number; estimate: boolean
  salesByPeriod: { label: string; value: number; count: number }[]
  expensesByCategory: { label: string; value: number }[]
  debts: { total: number; aging: [number, number, number]; top: { name: string; balance: number }[] }
  inventory: { cost: number; retail: number; low: number; out: number }
  best: { name: string; qty: number }[]; slow: { name: string; stock: number }[]
}

/** The single contract between the UI and the backend. Implemented by api/http.ts (real) and api/mock.ts (development). */
export interface Api {
  auth: {
    login(email: string, password: string): Promise<{ token: string; me: T.Me }>
    register(d: { name: string; email: string; password: string }): Promise<{ token: string; me: T.Me }>
    forgot(email: string): Promise<void>
    reset(token: string, password: string): Promise<void>
    me(): Promise<T.Me>
  }
  business: { create(d: BusinessInput): Promise<T.Me>; update(d: Partial<T.Business>): Promise<T.Me> }
  catalog: {
    categories(): Promise<T.Category[]>; addCategory(name: string, parent: number): Promise<T.Category>; archiveCategory(id: number): Promise<void>
    products(): Promise<T.Product[]>; saveProduct(p: ProductInput): Promise<T.Product>; archiveProduct(id: number): Promise<void>
    restock(variantId: number, d: { qty: number; buy: number; sell: number }): Promise<void>
  }
  inventory: { movements(): Promise<T.Movement[]>; adjust(d: { variantId: number; qty: number; reason: string; note?: string }): Promise<void> }
  sales: { list(): Promise<T.Sale[]>; create(p: T.SalePayload): Promise<T.Sale>; voidSale(no: string, reason: string): Promise<void> }
  people: {
    customers(): Promise<CustomerRow[]>; addCustomer(name: string, phone: string): Promise<void>; payDebt(customer: string, amount: number, method: T.Method): Promise<void>
    suppliers(): Promise<SupplierRow[]>; addSupplier(name: string, phone: string): Promise<void>; paySupplier(name: string, amount: number, method: T.Method): Promise<void>
    purchases(): Promise<T.Purchase[]>; createPurchase(p: T.PurchasePayload): Promise<T.Purchase>
  }
  finance: {
    expenses(): Promise<T.Expense[]>; saveExpense(e: Omit<T.Expense, 'id'> & { id?: number }): Promise<T.Expense>
    cashbook(): Promise<T.CashEntry[]>
    dashboard(period: string, storeId: string): Promise<T.Dashboard>
    report(from: string, to: string, group: 'day' | 'week' | 'month' | 'year'): Promise<Report>
  }
  ai: { ask(question: string, lang: 'sw' | 'en'): Promise<T.AiAnswer> }
  sync: { push(items: T.SalePayload[]): Promise<T.SyncResult[]> }
  admin: {
    employees(): Promise<T.Employee[]>; invite(d: { email: string; role: T.Role; stores: string[]; permissions: string[] }): Promise<void>
    updateEmployee(id: string, patch: Partial<T.Employee>): Promise<void>; setPlan(plan: 'pro' | 'book'): Promise<T.Me>
  }
}
