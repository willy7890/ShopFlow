from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, EmailStr
from decimal import Decimal

class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    phone: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    notes: str | None = None

class SupplierOut(BaseModel):
    id: str; business_id: str; name: str; phone: str | None; email: str | None; address: str | None
    model_config = ConfigDict(from_attributes=True)


class SupplierPaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    method: str = Field(default="bank")
    purchase_id: str | None = None
    reference: str | None = None
    note: str | None = None


class SupplierPaymentOut(BaseModel):
    id: str
    business_id: str
    store_id: str | None
    supplier_id: str
    purchase_id: str | None
    amount: Decimal
    method: str
    reference: str | None
    note: str | None
    status: str
    reversal_of_id: str | None
    created_by: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class SupplierStatementOut(BaseModel):
    supplier: SupplierOut
    total_purchases: Decimal
    total_payments: Decimal
    outstanding_balance: Decimal
    payments: list[SupplierPaymentOut]
    model_config = ConfigDict(from_attributes=True)


class PurchaseLineCreate(BaseModel):
    variant_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    conversion_factor: Decimal = Field(default=Decimal("1"), gt=0)

class PurchaseCreate(BaseModel):
    store_id: str
    supplier_id: str | None = None
    reference_number: str | None = None
    note: str | None = None
    items: list[PurchaseLineCreate] = Field(min_length=1)

class PurchaseOut(BaseModel):
    id: str; business_id: str; store_id: str; supplier_id: str | None; reference_number: str | None
    status: str; total_amount: Decimal; note: str | None
    model_config = ConfigDict(from_attributes=True)

class BalanceOut(BaseModel):
    variant_id: str; store_id: str; quantity: Decimal; average_cost: Decimal
    model_config = ConfigDict(from_attributes=True)

class StockMovementOut(BaseModel):
    id: str; store_id: str; variant_id: str; movement_type: str
    quantity_delta: Decimal; unit_cost: Decimal; reference_type: str | None; reference_id: str | None
    note: str | None
    model_config = ConfigDict(from_attributes=True)
