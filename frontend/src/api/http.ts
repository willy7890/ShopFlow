import { http } from './client'
import type { Api, Report } from './api'
import type * as T from './types'
import { useAuth } from '@/store/auth'

type BackendUser = { id: string; full_name: string; email: string; phone?: string | null; is_super_admin?: boolean }
type BackendEmployee = {
  id: string
  full_name: string
  email: string
  role: string
  store_access: string[]
  permissions: string[]
  is_active: boolean
}
type BackendSession = { access_token: string; refresh_token: string; user: BackendUser }
type BusinessAccess = {
  business_id: string
  business_name: string
  currency: string
  role: string
  permissions: string[]
  stores: { id: string; name: string }[]
}
type BackendBusiness = { id: string; business_type: string; operating_mode: string }
type BackendEntitlements = {
  subscription?: { status: string; expires_at?: string | null; plan_id?: string | null } | null
  plan?: { slug: string; features: Record<string, boolean | number | string> } | null
  features: Record<string, boolean | number | string>
}
type BackendCustomer = { id: string; name: string; phone: string | null }
type BackendSupplier = { id: string; name: string; phone: string | null }
type BackendCategory = { id: string; name: string; parent_id: string | null }
type BackendProduct = { id: string; name: string; category_id: string | null; image_url: string | null }
type BackendVariant = {
  id: string; name: string; sku: string; barcode: string | null; purchase_price: number | string
  selling_price: number | string; low_stock_threshold: number | string
}
type BackendStock = { variant_id: string; quantity: number | string }
type BackendSale = {
  sale_number: string; customer_name: string | null; total_amount: number | string; paid_amount: number | string
  balance_due: number | string; created_at: string; status: string
  items: { variant_id: string; product_name: string; variant_name: string; quantity: number | string; unit_price: number | string }[]
  payments: { method: string; amount: number | string; status: string }[]
}
type BackendCashbookEntry = {
  id: string; store_id: string | null; entry_type: string; direction: 'in' | 'out'; amount: number | string
  category: string; reference_type: string | null; reference_id: string | null; note: string | null; created_at: string
}
type BackendPurchase = {
  id: string; supplier_id: string | null; reference_number: string | null; total_amount: number | string
  paid_amount: number | string; created_at: string
  items: { variant_id: string; product_name: string; variant_name: string; quantity: number | string; unit_cost: number | string }[]
}
type ReportSales = { total_sales: number | string; net_sales: number | string; total_transactions: number }
type ReportProfit = { gross_revenue: number | string; cost_of_goods_sold: number | string; gross_profit: number | string }
type ReportExpenses = { total_expenses: number | string; entries: { category: string; amount: number | string }[] }
type ReportInventory = {
  total_stock_value: number | string; total_retail_value: number | string; low_stock_items: unknown[]
  out_of_stock_variants: number
}
type ReportCustomers = {
  total_outstanding: number | string
  customers: { customer_id: string; name: string; outstanding_balance: number | string; aging: [number | string, number | string, number | string] }[]
}
type BestProduct = { product_name: string; quantity_sold: number | string; quantity_in_stock?: number | string }
type BackendDashboard = {
  sales: { total_sales: number | string }
  profit: { gross_profit: number | string; net_profit: number | string }
  inventory: { low_stock_items: { product_name: string; quantity: number | string }[]; best_selling_products: BestProduct[] }
  debtors: { total_outstanding: number | string }
  store_performance: { store_id: string; sales_total: number | string }[]
}

const g = async <R>(url: string, params?: object, headers?: Record<string, string>) =>
  (await http.get<R>(url, { params, headers })).data
const p = async <R>(url: string, body?: unknown, headers?: Record<string, string>) =>
  (await http.post<R>(url, body, { headers })).data
const u = async <R>(url: string, body?: unknown, headers?: Record<string, string>) => (await http.patch<R>(url, body, { headers })).data
const amount = (value: number | string | null | undefined) => Number(value ?? 0)
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const categoryIds = new Map<number, string>()
const productIds = new Map<number, string>()
const variantIds = new Map<number, string>()
const reverseIds = (remoteId: string, ids: Map<number, string>) => {
  const found = [...ids].find(([, id]) => id === remoteId)?.[0]
  if (found !== undefined) return found
  const next = Math.max(0, ...ids.keys()) + 1
  ids.set(next, remoteId)
  return next
}
const apiRole = (role: string): T.Role => ({
  business_manager: 'manager',
  store_manager: 'storemgr',
  inventory_manager: 'invmgr',
}[role] as T.Role | undefined) ?? (role as T.Role)
const backendRole = (role: T.Role): string => ({
  storemgr: 'store_manager',
  invmgr: 'inventory_manager',
} as Partial<Record<T.Role, string>>)[role] ?? role
const rolePermissions: Record<T.Role, string[]> = {
  owner: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'ai', 'employees', 'stores', 'subscription', 'void', 'discount', 'settings'],
  manager: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'ai', 'employees', 'stores', 'void', 'discount', 'settings'],
  storemgr: ['dash', 'pos', 'catalog', 'inventory', 'purchases', 'sales', 'customers', 'finance', 'reports', 'void', 'discount', 'settings'],
  cashier: ['dash', 'pos', 'sales', 'customers', 'settings'],
  accountant: ['dash', 'sales', 'customers', 'finance', 'reports', 'ai', 'settings'],
  invmgr: ['dash', 'catalog', 'inventory', 'purchases', 'settings'],
}
const backendPermissionMap: Record<string, string[]> = {
  manage_business: ['settings'],
  manage_stores: ['stores'],
  manage_employees: ['employees'],
  manage_products: ['catalog'],
  manage_inventory: ['inventory', 'purchases'],
  manage_sales: ['pos', 'sales', 'customers'],
  manage_orders: ['sales'],
  manage_finance: ['finance'],
  manage_customers: ['customers'],
  manage_suppliers: ['customers'],
  view_reports: ['reports'],
  view_dashboard: ['dash'],
  manage_sync: ['settings'],
}
const uiPermissions = (role: T.Role, granted: string[]) => {
  if (role === 'owner') return rolePermissions[role]
  return [...new Set(granted.flatMap((permission) => backendPermissionMap[permission] ?? []).concat('settings'))]
}
const mapEntitlements = (data?: BackendEntitlements): T.Entitlements => {
  const features = data?.features ?? data?.plan?.features ?? {}
  const num = (key: string, fallback: number) => Number(features[key] ?? fallback)
  return {
    plan: data?.plan?.slug === 'book' ? 'book' : 'pro',
    status: data?.subscription?.status ?? 'active',
    renew: data?.subscription?.expires_at?.slice(0, 10) ?? '',
    features: Object.fromEntries(Object.entries(features).map(([key, value]) => [
      key,
      value === true || value === 1 || value === 'true',
    ])),
    limits: { stores: num('stores', 1), employees: num('employees', 1) },
  }
}

async function loadMe(token: string, user: BackendUser, preferredBusinessId?: string): Promise<T.Me> {
  const headers = { Authorization: `Bearer ${token}` }
  const accesses = await g<BusinessAccess[]>('/businesses/access', undefined, headers)
  const access = user.is_super_admin
    ? preferredBusinessId ? accesses.find((item) => item.business_id === preferredBusinessId) : undefined
    : preferredBusinessId ? accesses.find((item) => item.business_id === preferredBusinessId) ?? accesses[0] : accesses[0]
  if (user.is_super_admin && preferredBusinessId && !access) {
    throw new Error('The selected business is no longer available to the Super Admin account.')
  }
  if (!access) {
    return {
      user: { id: user.id, name: user.full_name, email: user.email, role: 'owner', permissions: [], businessPermissions: [], isSuperAdmin: user.is_super_admin ?? false },
      business: null,
      stores: [],
      entitlements: mapEntitlements(),
    }
  }
  const businesses = await g<BackendBusiness[]>('/businesses', undefined, headers)
  const business = businesses.find((item) => item.id === access.business_id)
  if (!business) throw new Error('The active business is not available to the current account.')
  const businessHeaders = { ...headers, 'X-Business-ID': access.business_id }
  const entitlement = await g<BackendEntitlements>('/subscriptions/entitlements', undefined, businessHeaders)
  return {
    user: {
      id: user.id,
      name: user.full_name,
      email: user.email,
      role: apiRole(access.role),
      permissions: uiPermissions(apiRole(access.role), access.permissions),
      businessPermissions: access.permissions,
      isSuperAdmin: user.is_super_admin ?? false,
    },
    business: {
      id: access.business_id,
      name: access.business_name,
      mode: business.operating_mode === 'quick_sales' ? 'quick' : 'pos',
      currency: access.currency,
      timezone: 'Africa/Dar_es_Salaam',
      type: business.business_type,
    },
    stores: access.stores.map(({ id, name }) => ({ id, name })),
    entitlements: mapEntitlements(entitlement),
  }
}

async function login(email: string, password: string) {
  const result = await p<BackendSession>('/auth/login', { email, password })
  return { token: result.access_token, refreshToken: result.refresh_token, me: await loadMe(result.access_token, result.user) }
}

async function fetchCustomers() {
  const [customers, report] = await Promise.all([
    g<BackendCustomer[]>('/customers'),
    g<ReportCustomers>('/reports/customers'),
  ])
  const balances = new Map(report.customers.map((row) => [row.customer_id, row]))
  return customers.map((customer) => {
    const row = balances.get(customer.id)
    if (!row) throw new Error(`Missing debtor report data for customer ${customer.name}.`)
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? '',
      balance: amount(row?.outstanding_balance),
      aging: (row?.aging ?? [0, 0, 0]).map(amount) as [number, number, number],
    }
  })
}

async function fetchSuppliers() {
  const [suppliers, report] = await Promise.all([
    g<BackendSupplier[]>('/inventory/suppliers'),
    g<{ suppliers: { supplier_id: string; payable_balance: number | string }[] }>('/reports/suppliers'),
  ])
  const balances = new Map(report.suppliers.map((row) => [row.supplier_id, amount(row.payable_balance)]))
  return suppliers.map((supplier) => {
    const balance = balances.get(supplier.id)
    if (balance === undefined) throw new Error(`Missing creditor report data for supplier ${supplier.name}.`)
    return { id: supplier.id, name: supplier.name, phone: supplier.phone ?? '', balance }
  })
}

async function fetchCategories() {
  const categories = await g<BackendCategory[]>('/catalog/categories')
  return categories.map((category) => ({
    id: reverseIds(category.id, categoryIds),
    name: category.name,
    parent: category.parent_id ? reverseIds(category.parent_id, categoryIds) : 0,
  }))
}

async function fetchProducts() {
  const [products, stores] = await Promise.all([
    g<BackendProduct[]>('/catalog/products'),
    Promise.resolve(useAuth.getState().me?.stores ?? []),
  ])
  await fetchCategories()
  const selectedStore = useAuth.getState().storeId
  const storeId = stores.some((store) => store.id === selectedStore) ? selectedStore : stores[0]?.id
  const stock = storeId ? await g<BackendStock[]>('/inventory/stock', { store_id: storeId }) : []
  const quantities = new Map(stock.map((row) => [row.variant_id, amount(row.quantity)]))
  return Promise.all(products.map(async (product) => {
    const variants = await g<BackendVariant[]>(`/catalog/products/${product.id}/variants`)
    return {
      id: reverseIds(product.id, productIds),
      name: product.name,
      categoryId: product.category_id ? reverseIds(product.category_id, categoryIds) : 0,
      brand: '',
      unit: '',
      image: product.image_url ?? undefined,
      variants: variants.map((variant) => ({
        id: reverseIds(variant.id, variantIds),
        label: variant.name,
        barcode: variant.barcode ?? '',
        sku: variant.sku,
        buy: amount(variant.purchase_price),
        sell: amount(variant.selling_price),
        stock: quantities.get(variant.id) ?? 0,
        min: amount(variant.low_stock_threshold),
      })),
    }
  }))
}

function reportPeriod(date: string, group: 'day' | 'week' | 'month' | 'year') {
  if (group === 'day') return date
  const day = new Date(`${date}T00:00:00`)
  if (group === 'year') return date.slice(0, 4)
  if (group === 'month') return date.slice(0, 7)
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  return dateKey(day)
}

function mapSale(sale: BackendSale): T.Sale {
  const methods = [...new Set(sale.payments.map((payment) => (
    payment.method === 'mobile_money' ? 'mm' : payment.method
  ) as T.Method))]
  const paid = amount(sale.paid_amount)
  return {
    no: sale.sale_number,
    date: sale.created_at.slice(0, 10),
    type: 'pos',
    customer: sale.customer_name ?? '',
    total: amount(sale.total_amount),
    paid,
    due: amount(sale.balance_due),
    initialPaid: paid,
    methods,
    items: sale.items.map((item) => ({
      name: `${item.product_name} ${item.variant_name}`.trim(),
      qty: amount(item.quantity),
      price: amount(item.unit_price),
      discount: 0,
    })),
    payments: sale.payments.map((payment) => ({
      method: (payment.method === 'mobile_money' ? 'mm' : payment.method) as T.Method,
      amount: amount(payment.amount),
      status: payment.status === 'confirmed' ? 'confirmed' : 'pending',
    })),
  }
}

function dashboardRange(period: string) {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'today') return { start_date: dateKey(day), end_date: dateKey(day) }
  if (period === 'yest') {
    day.setDate(day.getDate() - 1)
    const date = dateKey(day)
    return { start_date: date, end_date: date }
  }
  if (period === 'week') day.setDate(day.getDate() - ((day.getDay() + 6) % 7))
  else if (period === 'month') day.setDate(1)
  else if (period === 'year') day.setMonth(0, 1)
  else return { start_date: undefined, end_date: undefined }
  return { start_date: dateKey(day), end_date: dateKey(now) }
}

async function fetchReport(from: string, to: string, group: 'day' | 'week' | 'month' | 'year'): Promise<Report> {
  const { storeId, me } = useAuth.getState()
  const activeStoreId = me?.stores.some((store) => store.id === storeId) ? storeId : 'all'
  const params = {
    start_date: from || undefined,
    end_date: to || undefined,
    store_id: activeStoreId === 'all' ? undefined : activeStoreId,
  }
  const [salesReport, profit, expenses, inventory, debtors, sales, best, slow] = await Promise.all([
    g<ReportSales>('/reports/sales', params),
    g<ReportProfit>('/reports/profit', params),
    g<ReportExpenses>('/reports/expenses', params),
    g<ReportInventory>('/reports/inventory', { store_id: params.store_id }),
    g<ReportCustomers>('/reports/customers'),
    g<BackendSale[]>('/sales', { store_id: params.store_id }),
    g<BestProduct[]>('/reports/products/best-selling', { store_id: params.store_id, limit: 10 }),
    g<BestProduct[]>('/reports/products/slow-moving', { store_id: params.store_id, limit: 10 }),
  ])
  const periodSales = sales.filter((sale) => {
    const date = sale.created_at.slice(0, 10)
    return (!from || date >= from) && (!to || date <= to)
  })
  const grouped = new Map<string, { value: number; count: number }>()
  for (const sale of periodSales) {
    const label = reportPeriod(sale.created_at.slice(0, 10), group)
    const row = grouped.get(label) ?? { value: 0, count: 0 }
    row.value += amount(sale.total_amount)
    row.count++
    grouped.set(label, row)
  }
  const aging = [0, 0, 0] as [number, number, number]
  for (const customer of debtors.customers) customer.aging.forEach((value, index) => { aging[index] += amount(value) })
  const topDebtors = debtors.customers
    .map((customer) => ({ name: customer.name, balance: amount(customer.outstanding_balance) }))
    .filter((customer) => customer.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10)
  return {
    revenue: amount(salesReport.total_sales),
    received: periodSales.reduce((sum, sale) => sum + amount(sale.paid_amount), 0),
    cogs: amount(profit.cost_of_goods_sold),
    grossProfit: amount(profit.gross_profit),
    expenses: amount(expenses.total_expenses),
    operatingProfit: amount(profit.gross_profit) - amount(expenses.total_expenses),
    estimate: false,
    salesByPeriod: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([label, row]) => ({ label, ...row })),
    expensesByCategory: expenses.entries.map((entry) => ({ label: entry.category, value: amount(entry.amount) })),
    debts: { total: amount(debtors.total_outstanding), aging, top: topDebtors },
    inventory: {
      cost: amount(inventory.total_stock_value),
      retail: amount(inventory.total_retail_value),
      low: inventory.low_stock_items.length,
      out: inventory.out_of_stock_variants,
    },
    best: best.map((product) => ({ name: product.product_name, qty: amount(product.quantity_sold) })),
    slow: slow.map((product) => ({ name: product.product_name, stock: amount(product.quantity_in_stock) })),
  }
}

async function fetchDashboard(period: string, storeId: string): Promise<T.Dashboard> {
  const range = dashboardRange(period)
  const activeStoreId = useAuth.getState().me?.stores.some((store) => store.id === storeId) ? storeId : 'all'
  const params = {
    ...range,
    store_id: activeStoreId === 'all' ? undefined : activeStoreId,
  }
  const [data, sales, expenses] = await Promise.all([
    g<BackendDashboard>('/reports/dashboard', params),
    g<BackendSale[]>('/sales', { store_id: params.store_id }),
    g<ReportExpenses>('/reports/expenses', params),
  ])
  const filteredSales = sales.filter((sale) => {
    const date = sale.created_at.slice(0, 10)
    return (!range.start_date || date >= range.start_date) && (!range.end_date || date <= range.end_date)
  })
  const seriesMap = new Map<string, number>()
  for (const sale of filteredSales) {
    const date = sale.created_at.slice(0, 10)
    seriesMap.set(date, (seriesMap.get(date) ?? 0) + amount(sale.total_amount))
  }
  return {
    sales: amount(data.sales.total_sales),
    received: filteredSales.reduce((sum, sale) => sum + amount(sale.paid_amount), 0),
    debt: amount(data.debtors.total_outstanding),
    expenses: amount(expenses.total_expenses),
    grossProfit: amount(data.profit.gross_profit),
    netProfit: amount(data.profit.net_profit) - amount(expenses.total_expenses),
    recent: filteredSales.slice(0, 8).map(mapSale),
    top: data.inventory.best_selling_products.map((item) => ({ name: item.product_name, qty: amount(item.quantity_sold) })),
    low: data.inventory.low_stock_items.map((item) => ({ name: item.product_name, stock: amount(item.quantity) })),
    byStore: data.store_performance.map((store) => ({ store: store.store_id, sales: amount(store.sales_total) })),
    series: [...seriesMap].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })),
  }
}

function cashbookType(entryType: string): T.CashEntry['type'] {
  if (entryType === 'sale_receipt') return 'sale'
  if (entryType === 'customer_payment') return 'collect'
  if (entryType === 'supplier_payment') return 'spay'
  if (entryType === 'refund') return 'refund'
  if (entryType === 'expense') return 'expense'
  if (entryType === 'opening_balance') return 'open'
  return 'purchase'
}

async function fetchCashbook(): Promise<T.CashEntry[]> {
  const entries = await g<BackendCashbookEntry[]>('/finance/entries')
  let balance = 0
  return entries.slice().reverse().map((entry) => {
    const value = amount(entry.amount)
    const incoming = entry.direction === 'in' ? value : 0
    const outgoing = entry.direction === 'out' ? value : 0
    balance += incoming - outgoing
    return {
      date: entry.created_at.slice(0, 10), type: cashbookType(entry.entry_type),
      ref: entry.category || entry.reference_id || entry.note || entry.id,
      method: entry.reference_type?.startsWith('method:') ? entry.reference_type.slice(7) : '',
      in: incoming, out: outgoing, balance,
    }
  })
}

async function fetchExpenses(): Promise<T.Expense[]> {
  const entries = await g<BackendCashbookEntry[]>('/finance/entries', { entry_type: 'expense' })
  return entries.map((entry) => ({
    id: entry.id, date: entry.created_at.slice(0, 10), category: entry.category,
    amount: amount(entry.amount), method: 'cash', store: entry.store_id ?? '',
    description: entry.note ?? '',
  }))
}

async function fetchInventoryMovements(): Promise<T.Movement[]> {
  const storeId = useAuth.getState().storeId
  if (!storeId || storeId === 'all') throw new Error('Select a store to view its stock movements.')
  const [movements, products] = await Promise.all([
    g<{ id: string; variant_id: string; movement_type: string; quantity_delta: number | string; reference_id: string | null; store_id: string }[]>('/inventory/movements', { store_id: storeId }),
    fetchProducts(),
  ])
  const variants = new Map(products.flatMap((product) => product.variants.map((variant) => [String(variantIds.get(variant.id)), `${product.name} ${variant.label}`.trim()])))
  return movements.map((movement) => ({
    date: '', product: variants.get(movement.variant_id) ?? movement.variant_id,
    type: movement.movement_type === 'sale' ? 'sale' : movement.movement_type === 'purchase' ? 'purchase' : movement.movement_type === 'refund' ? 'return' : 'adjust',
    qty: amount(movement.quantity_delta), ref: movement.reference_id ?? movement.id,
    user: '', store: movement.store_id,
  }))
}

async function pushSales(payloads: T.SalePayload[]): Promise<T.SyncResult[]> {
  const { me, storeId } = useAuth.getState()
  const activeStore = me?.stores.some((store) => store.id === storeId) ? storeId : me?.stores[0]?.id
  if (!activeStore) throw new Error('Create or select a store before syncing sales.')
  const response = await p<{ client_id: string; state: string; message?: string }[]>('/sync/push', {
    items: payloads.map((sale) => ({
      ...sale, clientId: sale.clientId, store_id: activeStore,
      items: sale.items.map((item) => {
        const variantId = item.variantId === undefined ? undefined : variantIds.get(item.variantId)
        if (!variantId) throw new Error(`The selected variant for ${item.name} is unavailable. Reload the product list.`)
        return { variant_id: variantId, quantity: item.qty, unit_price: item.price }
      }),
      payments: sale.payments.map((payment) => ({ ...payment, method: payment.method === 'mm' ? 'mobile_money' : payment.method })),
    })),
  })
  return response.map((result) => ({
    clientId: result.client_id,
    state: result.state === 'synced' ? 'synced' : result.state === 'conflict' ? 'conflict' : 'failed',
    message: result.message,
  }))
}

/** Real REST implementation for the FastAPI endpoints consumed by the frontend. */
export const httpApi: Api = {
  auth: {
    login,
    register: async (data) => {
      return p('/auth/register', {
        full_name: data.name,
        email: data.email,
        password: data.password,
        business_name: `${data.name}'s Shop`,
      })
    },
    resendVerification: async (email) => { await p('/auth/resend-verification', { email }) },
    forgot: async (email) => { await p('/auth/password-reset/request', { email }) },
    reset: async (token, password) => { await p('/auth/password-reset/confirm', { token, new_password: password }) },
    me: async (businessId) => {
      const { token, me } = useAuth.getState()
      if (!token || !me) throw new Error('Sign in to load your account.')
      const currentUser = await g<BackendUser>('/auth/me')
      return loadMe(token, currentUser, businessId ?? me.business?.id)
    },
  },
  business: {
    access: async () => {
      const accesses = await g<BusinessAccess[]>('/businesses/access')
      return accesses.map(({ business_id, business_name }) => ({ id: business_id, name: business_name }))
    },
    create: async (data) => {
      const created = await p<{ id: string }>('/businesses', {
        name: data.name,
        business_type: data.type,
        operating_mode: data.mode === 'quick' ? 'quick_sales' : 'smart_inventory',
        country_code: 'TZ',
        currency: data.currency,
      })
      const { token, me } = useAuth.getState()
      if (!token || !me) throw new Error('Sign in to create a business.')
      const updatedMe = await loadMe(token, {
        id: me.user.id,
        full_name: me.user.name,
        email: me.user.email,
        is_super_admin: me.user.isSuperAdmin,
      }, created.id)
      return {
        ...updatedMe,
        business: { ...updatedMe.business!, mode: data.mode, timezone: data.timezone },
      }
    },
    update: async () => { throw new Error('Business updates are not available on the backend yet.') },
  },
  catalog: {
    categories: fetchCategories,
    addCategory: async (name, parent) => {
      const created = await p<BackendCategory>('/catalog/categories', {
        name,
        parent_id: parent ? categoryIds.get(parent) ?? null : null,
      })
      return {
        id: reverseIds(created.id, categoryIds),
        name: created.name,
        parent: created.parent_id ? reverseIds(created.parent_id, categoryIds) : 0,
      }
    },
    archiveCategory: async () => { throw new Error('Category archiving is not available on the backend yet.') },
    products: fetchProducts,
    saveProduct: async () => { throw new Error('Product updates are not available through this adapter yet.') },
    archiveProduct: async () => { throw new Error('Product archiving is not available on the backend yet.') },
    restock: async () => { throw new Error('Restocking is not available on the backend yet.') },
  },
  inventory: {
    movements: fetchInventoryMovements,
    adjust: async () => { throw new Error('Inventory adjustments are not available on the backend yet.') },
  },
  sales: {
    list: async () => (await g<BackendSale[]>('/sales')).map(mapSale),
    create: (data) => p('/sales', data),
    voidSale: async () => { throw new Error('Sale voiding is not available on the backend yet.') },
  },
  orders: {
    list: (options = {}) => g<T.Order[]>('/orders', { search: options.search || undefined, status: options.status, store_id: options.storeId, offset: options.offset ?? 0, limit: options.limit ?? 50 }),
    get: (id) => g<T.Order>(`/orders/${id}`),
    create: (input) => p<T.Order>('/orders', {
      store_id: input.storeId, customer_name: input.customerName || undefined,
      customer_phone: input.customerPhone || undefined, note: input.note || undefined,
      items: input.items.map((item) => {
        const variantId = variantIds.get(item.variantId)
        if (!variantId) throw new Error('The selected variant is unavailable. Reload the product list.')
        return { variant_id: variantId, quantity: item.quantity, unit_price: item.unitPrice }
      }),
    }),
    confirm: (id) => p<T.Order>(`/orders/${id}/confirm`),
    prepare: (id) => p<T.Order>(`/orders/${id}/prepare`),
    complete: (id) => p<T.Order>(`/orders/${id}/complete`),
    cancel: (id) => p<T.Order>(`/orders/${id}/cancel`),
    convertToSale: (id) => p<T.Order>(`/orders/${id}/convert-to-sale`),
  },
  people: {
    customers: fetchCustomers,
    addCustomer: async (name, phone) => { await p('/customers', { name, phone: phone || undefined }) },
    payDebt: async (name, value, method) => {
      const customer = (await g<BackendCustomer[]>('/customers')).find((row) => row.name === name)
      if (!customer) throw new Error('Customer not found.')
      await p(`/customers/${customer.id}/payments`, {
        amount: value,
        method: method === 'mm' ? 'mobile_money' : method,
      })
    },
    suppliers: fetchSuppliers,
    addSupplier: async (name, phone) => { await p('/inventory/suppliers', { name, phone: phone || undefined }) },
    paySupplier: async (name, value, method) => {
      const supplier = (await g<BackendSupplier[]>('/inventory/suppliers')).find((row) => row.name === name)
      if (!supplier) throw new Error('Supplier not found.')
      await p(`/inventory/suppliers/${supplier.id}/payments`, {
        amount: value,
        method: method === 'mm' ? 'mobile_money' : method,
      })
    },
    purchases: async () => {
      const [purchases, suppliers] = await Promise.all([
        g<BackendPurchase[]>('/inventory/purchases'),
        g<BackendSupplier[]>('/inventory/suppliers'),
      ])
      const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
      return purchases.map((purchase) => ({
        no: purchase.reference_number || purchase.id,
        date: purchase.created_at.slice(0, 10),
        supplier: purchase.supplier_id ? supplierNames.get(purchase.supplier_id) ?? '' : '',
        lines: purchase.items.map((item) => ({
          variantId: item.variant_id,
          name: `${item.product_name} ${item.variant_name}`.trim(),
          qty: amount(item.quantity),
          cost: amount(item.unit_cost),
        })),
        total: amount(purchase.total_amount),
        paid: amount(purchase.paid_amount),
      }))
    },
    createPurchase: async (data) => {
      const supplier = (await g<BackendSupplier[]>('/inventory/suppliers')).find((row) => row.name === data.supplier)
      if (!supplier) throw new Error('Supplier not found.')
      const items = data.lines.map((line) => {
        const variantId = variantIds.get(line.variantId)
        if (!variantId) throw new Error('The selected product variant is no longer available. Reload the product list.')
        return {
          variant_id: variantId,
          quantity: line.qty,
          unit_cost: line.cost,
          conversion_factor: 1,
        }
      })
      const { me, storeId: selectedStore } = useAuth.getState()
      const storeId = me?.stores.some((store) => store.id === selectedStore)
        ? selectedStore
        : me?.stores[0]?.id
      if (!storeId) throw new Error('Create or select a store before recording a purchase.')
      const purchase = await p<{ id: string }>('/inventory/purchases', {
        store_id: storeId,
        supplier_id: supplier.id,
        items,
      })
      const received = await p<{
        id: string; total_amount: number | string; supplier_id: string | null
      }>(`/inventory/purchases/${purchase.id}/receive`)
      if (data.paid > 0) {
        await p(`/inventory/suppliers/${supplier.id}/payments`, {
          amount: data.paid,
          method: 'bank',
          purchase_id: purchase.id,
        })
      }
      return {
        no: purchase.id,
        date: new Date().toISOString().slice(0, 10),
        supplier: data.supplier,
        lines: data.lines.map((line) => ({ variantId: line.variantId, name: '', qty: line.qty, cost: line.cost })),
        total: amount(received.total_amount),
        paid: data.paid,
      }
    },
  },
  finance: {
    expenses: fetchExpenses,
    saveExpense: async (expense) => {
      const storeId = expense.store || useAuth.getState().me?.stores[0]?.id
      if (!storeId) throw new Error('Create or select a store before recording an expense.')
      await p('/finance/entries', {
        store_id: storeId, entry_type: 'expense', direction: 'out', amount: expense.amount,
        category: expense.category, reference_type: `method:${expense.method}`,
        note: expense.description || undefined,
      })
      return { ...expense, id: expense.id ?? `expense-${Date.now()}` }
    },
    cashbook: fetchCashbook,
    dashboard: fetchDashboard,
    report: fetchReport,
  },
  ai: { ask: (question, lang) => p('/assistant/ask', { question, language: lang }) },
  sync: { push: pushSales },
  admin: {
    employees: async () => (await g<BackendEmployee[]>('/employees')).map((employee): T.Employee => ({
      id: employee.id,
      name: employee.full_name,
      email: employee.email,
      role: apiRole(employee.role),
      stores: employee.store_access,
      permissions: employee.permissions,
      status: employee.is_active ? 'active' : 'inactive',
    })),
    invite: async (data) => {
      await p('/employees/invite', {
        email: data.email,
        role: backendRole(data.role),
        store_ids: data.stores,
        permissions: data.permissions,
      })
    },
    updateEmployee: async (id, patch) => {
      await u(`/employees/${id}`, {
        ...(patch.role ? { role: backendRole(patch.role) } : {}),
        ...(patch.stores ? { store_ids: patch.stores } : {}),
        ...(patch.permissions ? { permissions: patch.permissions } : {}),
        ...(patch.status ? { is_active: patch.status === 'active' } : {}),
      })
    },
    setPlan: async () => { throw new Error('Plan changes are not available through this adapter yet.') },
  },
  subscription: {
    plans: () => g<T.AdminPlan[]>('/subscriptions/plans'),
    current: () => g<T.BusinessSubscription | null>('/subscriptions/current'),
    history: () => g<T.BusinessSubscription[]>('/subscriptions/history'),
    payments: () => g<T.SubscriptionPayment[]>('/subscriptions/payments/mine'),
    paymentInstructions: () => g<T.SubscriptionPaymentInstructions>('/subscriptions/payment-instructions'),
    requestPlan: (plan_id) => p<T.BusinessSubscription>('/subscriptions/request', { plan_id }),
    submitPayment: (input) => p<T.SubscriptionPayment>('/subscriptions/payments/submit', input),
  },
  platformAdmin: {
    analytics: () => g<T.PlatformAnalytics>('/subscriptions/admin/analytics'),
    businesses: (options = {}) => g<T.AdminBusiness[]>('/subscriptions/admin/businesses', {
      offset: options.offset ?? 0, limit: options.limit ?? 100, search: options.search,
      is_active: options.isActive, plan_id: options.planId, subscription_status: options.subscriptionStatus,
      registered_from: options.registeredFrom, registered_to: options.registeredTo,
    }),
    business: (id) => g<T.AdminBusinessDetail>(`/subscriptions/admin/businesses/${id}`),
    businessStores: (id) => g<T.PlatformStore[]>(`/subscriptions/admin/businesses/${id}/stores`),
    createStore: async (id, input) => { await p(`/subscriptions/admin/businesses/${id}/stores`, input) },
    setStoreStatus: async (id, is_active, reason) => { await u(`/subscriptions/admin/stores/${id}/status`, { is_active, reason }) },
    businessReport: async (id, start, end) => {
      const headers = { 'X-Business-ID': id }
      const params = { start_date: start, end_date: end }
      const [report, expenses, transactions, cashbook, cashbook_balance, stores, suppliers] = await Promise.all([
        g<T.PlatformBusinessReport>('/reports/mobile-dashboard', params, headers),
        g<{ total_expenses: string; entries: { category: string; amount: string }[] }>('/reports/expenses', params, headers),
        g<T.PlatformReportSale[]>('/reports/transactions', { ...params, limit: 100 }, headers),
        g<T.PlatformCashbookEntry[]>('/finance/entries', params, headers),
        g<T.PlatformBusinessReport['cashbook_balance']>('/finance/balance', params, headers),
        g<{ id: string; name: string }[]>(`/businesses/${id}/stores`, {}, headers),
        g<{ id: string; name: string }[]>('/inventory/suppliers', undefined, headers),
      ])
      const [movementGroups, paymentGroups] = await Promise.all([
        Promise.all(stores.map((store) => g<T.PlatformStockMovement[]>('/inventory/movements', { store_id: store.id, ...params }, headers))),
        Promise.all(suppliers.map((supplier) => g<{ payments: Omit<T.PlatformSupplierPayment, 'supplier_name'>[] }>(`/inventory/suppliers/${supplier.id}/statement`, undefined, headers))),
      ])
      const inRange = (value: string) => value.slice(0, 10) >= start && value.slice(0, 10) <= end
      return {
        ...report, expenses: expenses.total_expenses, expense_categories: expenses.entries, transactions, cashbook, cashbook_balance,
        stock_movements: movementGroups.flat().filter((movement) => inRange(movement.created_at)).map((movement) => ({ ...movement, store_name: stores.find((store) => store.id === movement.store_id)?.name })),
        supplier_payments: paymentGroups.flatMap((statement, index) => statement.payments.filter((payment) => inRange(payment.created_at)).map((payment) => ({ ...payment, supplier_name: suppliers[index].name }))),
      }
    },
    users: (options = {}) => g<T.PlatformUser[]>('/subscriptions/admin/users', {
      offset: options.offset ?? 0,
      limit: options.limit ?? 50,
      search: options.search,
      business_id: options.businessId,
      role: options.role,
      is_active: options.isActive,
      is_verified: options.isVerified,
      registered_from: options.registeredFrom,
      registered_to: options.registeredTo,
    }),
    user: (id) => g<T.PlatformUserDetail>(`/subscriptions/admin/users/${id}`),
    plans: () => g<T.AdminPlan[]>('/subscriptions/plans', { active_only: false }),
    ensureInitialPlans: (reason) => p<T.InitialPlanSetup>('/subscriptions/admin/plans/ensure-initial-tzs', { reason }),
    planBusinesses: (id) => g<T.AdminBusiness[]>(`/subscriptions/admin/plans/${id}/businesses`),
    subscriptions: (status) => g<T.AdminSubscription[]>('/subscriptions/admin/subscriptions', { offset: 0, limit: 100, status }),
    payments: (options = {}) => g<T.SubscriptionPayment[]>('/subscriptions/admin/payments', {
      status: options.status, business_id: options.businessId, offset: options.offset ?? 0, limit: options.limit ?? 50,
    }),
    paymentSettings: () => g<T.SubscriptionPaymentMethodSetting[]>('/subscriptions/admin/payment-settings'),
    updatePaymentSetting: (currency, method, input) => u<T.SubscriptionPaymentMethodSetting>(`/subscriptions/admin/payment-settings/${currency}/${method}`, input),
    recordPayment: async (input) => { await p('/subscriptions/admin/payments', input) },
    updatePayment: async (id, input) => { await u(`/subscriptions/admin/payments/${id}`, input) },
    refundPayment: async (id, input) => { await p(`/subscriptions/admin/payments/${id}/refund`, { status: 'refunded', ...input }) },
    revenue: (start, end) => g<T.PlatformRevenue>('/subscriptions/admin/revenue', { start_date: start, end_date: end }),
    audit: (options = {}) => g<T.PlatformAudit[]>('/subscriptions/admin/audit-logs', { offset: 0, limit: 100, business_id: options.businessId }),
    globalReports: (start, end) => g<T.PlatformGlobalReport>('/subscriptions/admin/global-reports', { start_date: start, end_date: end }),
    health: () => g<{ status: string; service: string }>('/subscriptions/admin/health'),
    createPlan: async (input) => { await p('/subscriptions/admin/plans', input) },
    updatePlan: async (id, input) => { await u(`/subscriptions/admin/plans/${id}`, input) },
    archivePlan: async (id, reason) => { await p(`/subscriptions/admin/plans/${id}/archive`, { reason }) },
    updateBusiness: async (id, input) => { await u(`/subscriptions/admin/businesses/${id}`, input) },
    setBusinessStatus: async (id, is_active, reason) => { await u(`/subscriptions/admin/businesses/${id}/status`, { is_active, reason }) },
    setUserStatus: async (id, is_active, reason) => { await u(`/subscriptions/admin/users/${id}/status`, { is_active, reason }) },
    grantPlan: async (businessId, plan_id, duration_days, reason, grant_type = 'complimentary') => {
      await p(`/subscriptions/admin/businesses/${businessId}/grant`, { plan_id, duration_days, grant_type, reason })
    },
    updateSubscription: async (id, input) => { await u(`/subscriptions/admin/subscriptions/${id}`, input) },
    exportBusinessReport: async (id, start, end, format) => {
      const response = await http.get<Blob>(`/reports/export/${format}`, {
        params: { start_date: start, end_date: end },
        headers: { 'X-Business-ID': id },
        responseType: 'blob',
      })
      const blobUrl = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `shopflow-${id}-report.${format}`
      link.click()
      URL.revokeObjectURL(blobUrl)
    },
  },
}
