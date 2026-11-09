from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class OrderItemCreate(BaseModel):
    variant_id: str
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal | None = None


class OrderCreate(BaseModel):
    store_id: str
    customer_id: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    note: str | None = None
    items: list[OrderItemCreate] = Field(min_length=1)


class OrderItemOut(BaseModel):
    id: str
    order_id: str
    variant_id: str
    product_name: str
    variant_name: str
    sku: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    model_config = ConfigDict(from_attributes=True)


class OrderOut(BaseModel):
    id: str
    business_id: str
    store_id: str
    customer_id: str | None
    order_number: str
    customer_name: str | None
    customer_phone: str | None
    status: str
    subtotal: Decimal
    discount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    balance_due: Decimal
    note: str | None
    converted_sale_id: str | None
    created_by: str
    created_at: datetime
    updated_at: datetime
    items: list[OrderItemOut]
    model_config = ConfigDict(from_attributes=True)


class InvoiceOut(BaseModel):
    id: str
    business_id: str
    order_id: str
    invoice_number: str
    total_amount: Decimal
    status: str
    issued_at: datetime
    model_config = ConfigDict(from_attributes=True)
