export type Role = 'owner' | 'manager' | 'storemgr' | 'cashier' | 'accountant' | 'invmgr'
export type Method = 'cash' | 'mm' | 'bank' | 'credit'
export type SyncState = 'pending' | 'synced' | 'failed' | 'conflict'
export interface User { id: string; name: string; email: string; role: Role; permissions: string[] }
export interface Business { id: string; name: string; mode: 'pos' | 'quick'; currency: string; timezone: string; type?: string; phone?: string; address?: string; region?: string }
export interface Store { id: string; name: string }
export interface Entitlements { plan: 'pro' | 'book'; status: string; renew: string; features: Record<string, boolean>; limits: { stores: number; employees: number } }
export interface Me { user: User; business: Business | null; stores: Store[]; entitlements: Entitlements }
export interface Category { id: number; name: string; parent: number; archived?: boolean }
export interface Variant { id: number; label: string; barcode: string; sku: string; buy: number; sell: number; stock: number; min: number }
export interface Product { id: number; name: string; categoryId: number; brand: string; unit: string; image?: string; archived?: boolean; variants: Variant[] }
export interface Movement { date: string; product: string; type: 'sale' | 'purchase' | 'adjust' | 'opening' | 'return' | 'restock'; qty: number; ref: string; user: string; store: string }
export interface Person { id: string; name: string; phone: string }
export interface Payment { method: Method; amount: number; ref?: string; status: 'confirmed' | 'pending' | 'failed' | 'credit' }
export interface SaleItem { variantId?: number; name: string; qty: number; price: number; discount: number }
export interface Sale {
  no: string; date: string; type: 'pos' | 'quick'; customer: string; total: number; paid: number; due: number; initialPaid: number
  methods: Method[]; items: SaleItem[]; payments: Payment[]; voided?: boolean; voidDate?: string; sync?: SyncState; description?: string
}
export interface SalePayload { clientId: string; type: 'pos' | 'quick'; customer: string; items: SaleItem[]; payments: { method: Method; amount: number }[]; description?: string }
export interface Purchase { no: string; date: string; supplier: string; lines: { variantId: number; name: string; qty: number; cost: number }[]; total: number; paid: number }
export interface PurchasePayload { supplier: string; lines: { variantId: number; qty: number; cost: number }[]; paid: number }
export interface Expense { id: number; date: string; category: string; amount: number; method: Method; store: string; description: string; receipt?: string; edited?: boolean }
export interface Employee { id: string; name: string; email: string; role: Role; stores: string[]; status: 'active' | 'inactive' | 'invited' }
export interface AiAnswer { text: string; cards: { title: string; value: string }[]; recommendation: boolean; context: string }
export interface CashEntry { date: string; type: 'open' | 'sale' | 'collect' | 'expense' | 'refund' | 'purchase' | 'spay'; ref: string; method: string; in: number; out: number; balance: number }
export interface Dashboard { sales: number; received: number; debt: number; expenses: number; grossProfit: number | null; netProfit: number; recent: Sale[]; top: { name: string; qty: number }[]; low: { name: string; stock: number }[]; byStore: { store: string; sales: number }[]; series: { label: string; value: number }[] }
export interface SyncResult { clientId: string; state: SyncState; message?: string }
export interface QueueItem { clientId: string; payload: SalePayload; state: SyncState; message?: string; at: string; ref?: string }
