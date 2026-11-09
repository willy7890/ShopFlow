from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    address: str | None = None
    notes: str | None = None
    credit_limit: Decimal | None = Field(default=None, ge=0)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    address: str | None = None
    notes: str | None = None
    credit_limit: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class CustomerOut(BaseModel):
    id: str
    business_id: str
    name: str
    phone: str | None
    email: str | None
    address: str | None
    notes: str | None
    credit_limit: Decimal | None
    outstanding_balance: Decimal
    is_active: bool
    created_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CustomerPaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    method: Literal["cash", "mobile_money", "bank", "bank_transfer", "credit"] = "cash"
    sale_id: str | None = None
    reference: str | None = None
    note: str | None = None


class CustomerAdjustmentCreate(BaseModel):
    amount: Decimal
    reason: str = Field(min_length=2, max_length=220)
    note: str | None = None


class CustomerLedgerOut(BaseModel):
    id: str
    customer_id: str
    sale_id: str | None
    kind: str
    amount: Decimal
    description: str
    reference: str | None
    note: str | None
    created_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CustomerStatementOut(BaseModel):
    customer: CustomerOut
    total_sales: Decimal
    total_payments: Decimal
    outstanding_balance: Decimal
    ledger: list[CustomerLedgerOut]
    model_config = ConfigDict(from_attributes=True)
