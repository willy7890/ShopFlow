import { http } from './client'
import type { Api, Report } from './api'
import type * as T from './types'
import { useAuth } from '@/store/auth'

type BackendUser = { id: string; full_name: string; email: string; phone?: string | null }
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
const u = async <R>(url: string, body?: unknown) => (await http.patch<R>(url, body)).data
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
  const access = accesses.find((item) => item.business_id === preferredBusinessId) ?? accesses[0]
  if (!access) {
    return {
      user: { id: user.id, name: user.full_name, email: user.email, role: 'owner', permissions: [], businessPermissions: [] },
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
  return { token: result.access_token, me: await loadMe(result.access_token, result.user) }
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
  const { storeId } = useAuth.getState()
  const params = {
    start_date: from || undefined,
    end_date: to || undefined,
    store_id: storeId === 'all' ? undefined : storeId,
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
  const params = {
    ...range,
    store_id: storeId === 'all' ? undefined : storeId,
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

/** Real REST implementation for the FastAPI endpoints consumed by the frontend. */
export const httpApi: Api = {
  auth: {
    login,
    register: async (data) => {
      const result = await p<BackendSession>('/auth/register', {
        full_name: data.name,
        email: data.email,
        password: data.password,
        business_name: `${data.name}'s Shop`,
      })
      return { token: result.access_token, me: await loadMe(result.access_token, result.user) }
    },
    forgot: async () => { throw new Error('Password recovery is not available on the backend yet.') },
    reset: async () => { throw new Error('Password recovery is not available on the backend yet.') },
    me: async () => {
      const { token, me } = useAuth.getState()
      if (!token || !me) throw new Error('Sign in to load your account.')
      return loadMe(token, { id: me.user.id, full_name: me.user.name, email: me.user.email })
    },
  },
  business: {
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
      const updatedMe = await loadMe(token, { id: me.user.id, full_name: me.user.name, email: me.user.email }, created.id)
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
    movements: async () => { throw new Error('Inventory movement data is not available through this adapter yet.') },
    adjust: async () => { throw new Error('Inventory adjustments are not available on the backend yet.') },
  },
  sales: {
    list: async () => (await g<BackendSale[]>('/sales')).map(mapSale),
    create: (data) => p('/sales', data),
    voidSale: async () => { throw new Error('Sale voiding is not available on the backend yet.') },
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
    expenses: async () => { throw new Error('Expense entry data is not available through this adapter yet.') },
    saveExpense: async () => { throw new Error('Expense entry is not available on the backend yet.') },
    cashbook: async () => { throw new Error('Cashbook entries are not available through this adapter yet.') },
    dashboard: fetchDashboard,
    report: fetchReport,
  },
  ai: { ask: (question, lang) => p('/assistant/ask', { question, language: lang }) },
  sync: { push: async () => { throw new Error('Offline sync is not available through this adapter yet.') } },
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
}
