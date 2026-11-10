from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SalesReportOut(BaseModel):
    total_sales: Decimal = Field(default=Decimal("0"))
    total_refunds: Decimal = Field(default=Decimal("0"))
    net_sales: Decimal = Field(default=Decimal("0"))
    total_transactions: int = 0
    average_transaction_value: Decimal = Field(default=Decimal("0"))
    total_items_sold: Decimal = Field(default=Decimal("0"))
    start_date: date | None = None
    end_date: date | None = None
    model_config = ConfigDict(from_attributes=True)


class ProfitReportOut(BaseModel):
    gross_revenue: Decimal = Field(default=Decimal("0"))
    cost_of_goods_sold: Decimal = Field(default=Decimal("0"))
    gross_profit: Decimal = Field(default=Decimal("0"))
    total_refunds: Decimal = Field(default=Decimal("0"))
    net_profit: Decimal = Field(default=Decimal("0"))
    start_date: date | None = None
    end_date: date | None = None
    model_config = ConfigDict(from_attributes=True)


class InventoryAlertItemOut(BaseModel):
    variant_id: str
    product_name: str
    sku: str
    quantity: Decimal
    reorder_level: Decimal
    stock_value: Decimal
    model_config = ConfigDict(from_attributes=True)


class InventoryReportOut(BaseModel):
    total_variants: int = 0
    total_quantity: Decimal = Field(default=Decimal("0"))
    total_stock_value: Decimal = Field(default=Decimal("0"))
    total_retail_value: Decimal = Field(default=Decimal("0"))
    out_of_stock_variants: int = 0
    low_stock_items: list[InventoryAlertItemOut] = Field(default_factory=list)
    best_selling_products: list[dict] = Field(default_factory=list)
    slow_moving_products: list[dict] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class DebtorReportOut(BaseModel):
    customer_count: int = 0
    total_outstanding: Decimal = Field(default=Decimal("0"))
    overdue_customers: int = 0
    customers: list[dict] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class SupplierReportOut(BaseModel):
    supplier_count: int = 0
    total_payables: Decimal = Field(default=Decimal("0"))
    suppliers: list[dict] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class StorePerformanceOut(BaseModel):
    store_id: str
    store_name: str
    sales_total: Decimal = Field(default=Decimal("0"))
    expense_total: Decimal = Field(default=Decimal("0"))
    net_cash: Decimal = Field(default=Decimal("0"))
    transaction_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class DashboardReportOut(BaseModel):
    sales: SalesReportOut
    profit: ProfitReportOut
    inventory: InventoryReportOut
    debtors: DebtorReportOut
    suppliers: SupplierReportOut
    store_performance: list[StorePerformanceOut]
    model_config = ConfigDict(from_attributes=True)
