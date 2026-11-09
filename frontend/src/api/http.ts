import { http } from './client'
import type { Api } from './api'

/**
 * Real REST implementation. Endpoint paths below are ASSUMPTIONS (no OpenAPI spec was available when this was written).
 * Adjust the paths/shapes here only; no screen talks to axios directly.
 */
const g = async <R>(url: string, params?: object) => (await http.get<R>(url, { params })).data
const p = async <R>(url: string, body?: unknown) => (await http.post<R>(url, body)).data
const u = async <R>(url: string, body?: unknown) => (await http.patch<R>(url, body)).data

export const httpApi: Api = {
  auth: {
    login: (email, password) => p('/auth/login', { email, password }),
    register: (d) => p('/auth/register', d),
    forgot: (email) => p('/auth/forgot-password', { email }),
    reset: (token, password) => p('/auth/reset-password', { token, password }),
    me: () => g('/auth/me'),
  },
  business: { create: (d) => p('/businesses', d), update: (d) => u('/businesses/current', d) },
  catalog: {
    categories: () => g('/categories'), addCategory: (name, parent) => p('/categories', { name, parent }), archiveCategory: (id) => p(`/categories/${id}/archive`),
    products: () => g('/products'), saveProduct: (x) => (x.id ? u(`/products/${x.id}`, x) : p('/products', x)), archiveProduct: (id) => p(`/products/${id}/archive`),
    restock: (variantId, d) => p(`/inventory/variants/${variantId}/restock`, d),
  },
  inventory: { movements: () => g('/inventory/movements'), adjust: (d) => p('/inventory/adjustments', d) },
  sales: { list: () => g('/sales'), create: (x) => p('/sales', x), voidSale: (no, reason) => p(`/sales/${no}/void`, { reason }) },
  people: {
    customers: () => g('/customers'), addCustomer: (name, phone) => p('/customers', { name, phone }), payDebt: (customer, amount, method) => p('/debts/payments', { customer, amount, method }),
    suppliers: () => g('/suppliers'), addSupplier: (name, phone) => p('/suppliers', { name, phone }), paySupplier: (name, amount, method) => p('/suppliers/payments', { name, amount, method }),
    purchases: () => g('/purchases'), createPurchase: (x) => p('/purchases', x),
  },
  finance: {
    expenses: () => g('/expenses'), saveExpense: (e) => (e.id ? u(`/expenses/${e.id}`, e) : p('/expenses', e)),
    cashbook: () => g('/cashbook'), dashboard: (period, storeId) => g('/dashboard', { period, store_id: storeId }),
    report: (from, to, group) => g('/reports/summary', { from, to, group }),
  },
  ai: { ask: (question, lang) => p('/ai/ask', { question, lang }) },
  sync: { push: (items) => p('/sync/push', { items }) },
  admin: {
    employees: () => g('/employees'), invite: (d) => p('/employees/invite', d), updateEmployee: (id, patch) => u(`/employees/${id}`, patch), setPlan: (plan) => p('/subscription/plan', { plan }),
  },
}
