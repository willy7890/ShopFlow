export interface BackendDashboard {
  sales: {
    net_sales: string | number
    total_transactions: number
  }
  profit: {
    net_profit: string | number
  }
  inventory: {
    total_quantity: string | number
    low_stock_items: unknown[]
  }
  debtors: {
    total_outstanding: string | number
    customer_count: number
  }
  suppliers: {
    total_payables: string | number
    supplier_count: number
  }
  store_performance: Array<{
    expense_total: string | number
    net_cash: string | number
  }>
}

export interface DashboardMetrics {
  salesTotal: number
  transactionCount: number
  netProfit: number
  stockQuantity: number
  lowStockCount: number
  customerDebt: number
  customerCount: number
  supplierPayable: number
  supplierCount: number
  expenses: number
  netCash: number
}

export interface BackendRecentSale {
  id: string
  sale_number: string
  customer_name: string | null
  total_amount: string | number
  status: string
  created_at: string
}

export function dashboardMetrics(report: BackendDashboard): DashboardMetrics {
  const firstStore = report.store_performance[0]
  return {
    salesTotal: displayAmount(report.sales.net_sales),
    transactionCount: report.sales.total_transactions,
    netProfit: displayAmount(report.profit.net_profit),
    stockQuantity: displayAmount(report.inventory.total_quantity),
    lowStockCount: report.inventory.low_stock_items.length,
    customerDebt: displayAmount(report.debtors.total_outstanding),
    customerCount: report.debtors.customer_count,
    supplierPayable: displayAmount(report.suppliers.total_payables),
    supplierCount: report.suppliers.supplier_count,
    expenses: displayAmount(firstStore?.expense_total ?? 0),
    netCash: displayAmount(firstStore?.net_cash ?? 0),
  }
}

function displayAmount(value: string | number): number {
  const amount = Number(value)
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER) {
    throw new Error('The server returned an invalid dashboard amount.')
  }
  return Math.round(amount)
}
