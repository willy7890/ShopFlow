from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SaleLineCreate(BaseModel):
    variant_id: str
    quantity: Decimal = Field(gt=0)
    unit_price: Decimal | None = None


class SalePaymentCreate(BaseModel):
    method: Literal["cash", "mobile_money", "bank", "credit", "refund"]
    amount: Decimal = Field(gt=0)
    reference: str | None = None
    note: str | None = None


class SaleCreate(BaseModel):
    store_id: str
    customer_id: str | None = None
    customer_name: str | None = None
    customer_phone: str | None = None
    note: str | None = None
    idempotency_key: str | None = None
    items: list[SaleLineCreate] = Field(min_length=1)
    payments: list[SalePaymentCreate] = Field(default_factory=list)


class SaleRefundItem(BaseModel):
    variant_id: str
    quantity: Decimal = Field(gt=0)


class SaleRefundCreate(BaseModel):
    reason: str = Field(min_length=2, max_length=220)
    note: str | None = None
    amount: Decimal | None = Field(default=None, gt=0)
    items: list[SaleRefundItem] = Field(default_factory=list)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)


class SaleItemOut(BaseModel):
    id: str
    sale_id: str
    variant_id: str
    product_name: str
    variant_name: str
    sku: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    model_config = ConfigDict(from_attributes=True)


class SalePaymentOut(BaseModel):
    id: str
    sale_id: str
    method: str
    amount: Decimal
    reference: str | None
    status: str
    note: str | None
    model_config = ConfigDict(from_attributes=True)


class SaleOut(BaseModel):
    id: str
    business_id: str
    store_id: str
    customer_id: str | None
    sale_number: str
    customer_name: str | None
    customer_phone: str | None
    status: str
    subtotal: Decimal
    discount: Decimal
    total_amount: Decimal
    paid_amount: Decimal
    balance_due: Decimal
    idempotency_key: str | None
    note: str | None
    created_by: str
    created_at: datetime
    items: list[SaleItemOut]
    payments: list[SalePaymentOut]
    model_config = ConfigDict(from_attributes=True)


class RefundOut(BaseModel):
    sale_id: str
    refund_amount: Decimal
    remaining_balance: Decimal
    status: str
    note: str | None
    model_config = ConfigDict(from_attributes=True)
