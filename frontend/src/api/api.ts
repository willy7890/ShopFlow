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

/** The single UI contract. Production uses FastAPI; mock.ts is reserved for isolated tests. */
export interface Api {
  auth: {
    login(email: string, password: string): Promise<{ token: string; refreshToken?: string; me: T.Me }>
    register(d: { name: string; email: string; password: string }): Promise<{ full_name: string; email: string; verification_required: boolean; email_sent: boolean; delivery_configured: boolean; message: string }>
    resendVerification(email: string): Promise<void>
    forgot(email: string): Promise<void>
    reset(token: string, password: string): Promise<void>
    me(businessId?: string): Promise<T.Me>
  }
  business: { access(): Promise<{ id: string; name: string }[]>; create(d: BusinessInput): Promise<T.Me>; update(d: Partial<T.Business>): Promise<T.Me> }
  catalog: {
    categories(): Promise<T.Category[]>; addCategory(name: string, parent: number): Promise<T.Category>; archiveCategory(id: number): Promise<void>
    products(): Promise<T.Product[]>; saveProduct(p: ProductInput): Promise<T.Product>; archiveProduct(id: number): Promise<void>
    restock(variantId: number, d: { qty: number; buy: number; sell: number }): Promise<void>
  }
  inventory: { movements(): Promise<T.Movement[]>; adjust(d: { variantId: number; qty: number; reason: string; note?: string }): Promise<void> }
  sales: { list(): Promise<T.Sale[]>; create(p: T.SalePayload): Promise<T.Sale>; voidSale(no: string, reason: string): Promise<void> }
  orders: {
    list(options?: T.OrderListOptions): Promise<T.Order[]>
    get(id: string): Promise<T.Order>
    create(input: { storeId: string; customerName?: string; customerPhone?: string; note?: string; items: { variantId: number; quantity: number; unitPrice?: number }[] }): Promise<T.Order>
    confirm(id: string): Promise<T.Order>; prepare(id: string): Promise<T.Order>; complete(id: string): Promise<T.Order>
    cancel(id: string): Promise<T.Order>; convertToSale(id: string): Promise<T.Order>
  }
  people: {
    customers(): Promise<CustomerRow[]>; addCustomer(name: string, phone: string): Promise<void>; payDebt(customer: string, amount: number, method: T.Method): Promise<void>
    suppliers(): Promise<SupplierRow[]>; addSupplier(name: string, phone: string): Promise<void>; paySupplier(name: string, amount: number, method: T.Method): Promise<void>
    purchases(): Promise<T.Purchase[]>; createPurchase(p: T.PurchasePayload): Promise<T.Purchase>
  }
  finance: {
    expenses(): Promise<T.Expense[]>; saveExpense(e: Omit<T.Expense, 'id'> & { id?: string | number }): Promise<T.Expense>
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
  subscription: {
    plans(): Promise<T.AdminPlan[]>
    current(): Promise<T.BusinessSubscription | null>
    history(): Promise<T.BusinessSubscription[]>
    payments(): Promise<T.SubscriptionPayment[]>
    paymentInstructions(): Promise<T.SubscriptionPaymentInstructions>
    requestPlan(planId: string): Promise<T.BusinessSubscription>
    submitPayment(input: { payment_method: 'manual' | 'mobile_money' | 'bank' | 'cash'; transaction_reference: string; paid_at: string }): Promise<T.SubscriptionPayment>
  }
  platformAdmin: {
    analytics(): Promise<T.PlatformAnalytics>
    businesses(options?: { search?: string; isActive?: boolean; planId?: string; subscriptionStatus?: string; registeredFrom?: string; registeredTo?: string; offset?: number; limit?: number }): Promise<T.AdminBusiness[]>
    business(id: string): Promise<T.AdminBusinessDetail>
    businessReport(id: string, start: string, end: string): Promise<T.PlatformBusinessReport>
    businessStores(id: string): Promise<T.PlatformStore[]>
    createStore(id: string, input: { name: string; code: string; address?: string }): Promise<void>
    setStoreStatus(id: string, isActive: boolean, reason: string): Promise<void>
    users(options?: { offset?: number; limit?: number; search?: string; businessId?: string; role?: string; isActive?: boolean; isVerified?: boolean; registeredFrom?: string; registeredTo?: string }): Promise<T.PlatformUser[]>
    user(id: string): Promise<T.PlatformUserDetail>
    plans(): Promise<T.AdminPlan[]>
    ensureInitialPlans(reason: string): Promise<T.InitialPlanSetup>
    planBusinesses(id: string): Promise<T.AdminBusiness[]>
    subscriptions(status?: string): Promise<T.AdminSubscription[]>
    payments(options?: { status?: string; businessId?: string; offset?: number; limit?: number }): Promise<T.SubscriptionPayment[]>
    paymentSettings(): Promise<T.SubscriptionPaymentMethodSetting[]>
    updatePaymentSetting(currency: string, method: T.SubscriptionPaymentMethodSetting['method'], input: { display_name: string; recipient_name: string; recipient_details: string; reference_instructions: string; is_active: boolean; reason: string }): Promise<T.SubscriptionPaymentMethodSetting>
    recordPayment(input: { subscription_id: string; amount: string; payment_method: string; transaction_reference?: string; paid_at: string; confirmation_details?: string }): Promise<void>
    updatePayment(id: string, input: { status: 'confirmed' | 'failed'; details: string }): Promise<void>
    refundPayment(id: string, input: { details: string; refund_amount: string }): Promise<void>
    revenue(start: string, end: string): Promise<T.PlatformRevenue>
    audit(options?: { businessId?: string }): Promise<T.PlatformAudit[]>
    globalReports(start: string, end: string): Promise<T.PlatformGlobalReport>
    health(): Promise<{ status: string; service: string }>
    createPlan(input: { slug: string; name: string; description?: string; price: string; currency: string; duration_days: number; trial_days: number; is_active: boolean; features: Record<string, boolean | number | string> }): Promise<void>
    updatePlan(id: string, input: { name: string; description: string; price: string; currency: string; duration_days: number; trial_days: number; features: Record<string, boolean | number | string>; is_active: boolean }): Promise<void>
    archivePlan(id: string, reason: string): Promise<void>
    updateBusiness(id: string, input: { name: string; business_type: string; currency: string; reason: string }): Promise<void>
    setBusinessStatus(id: string, isActive: boolean, reason: string): Promise<void>
    setUserStatus(id: string, isActive: boolean, reason: string): Promise<void>
    grantPlan(businessId: string, planId: string, durationDays: number | undefined, reason: string, grantType?: 'complimentary' | 'trial'): Promise<void>
    updateSubscription(id: string, input: { status?: 'active' | 'trial' | 'suspended' | 'cancelled'; extend_days?: number; entitlement_mode?: 'legacy' | 'enforced'; reason: string }): Promise<void>
    exportBusinessReport(id: string, start: string, end: string, format: 'csv' | 'pdf'): Promise<void>
  }
}
