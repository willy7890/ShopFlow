from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CashbookEntryCreate(BaseModel):
    store_id: str | None = None
    entry_type: Literal[
        "opening_balance",
        "closing_balance",
        "sale_receipt",
        "customer_payment",
        "supplier_payment",
        "refund",
        "income",
        "expense",
        "adjustment",
        "transfer",
    ]
    direction: Literal["in", "out"]
    amount: Decimal = Field(gt=0)
    category: str = Field(default="general", max_length=50)
    reference_type: str | None = None
    reference_id: str | None = None
    note: str | None = None


class CashbookEntryOut(BaseModel):
    id: str
    business_id: str
    store_id: str | None
    entry_type: str
    direction: str
    amount: Decimal
    category: str
    reference_type: str | None
    reference_id: str | None
    note: str | None
    created_by: str
    reversal_of_id: str | None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CashbookBalanceOut(BaseModel):
    total_in: Decimal
    total_out: Decimal
    net_balance: Decimal
    model_config = ConfigDict(from_attributes=True)


class CashbookSummaryOut(BaseModel):
    total_in: Decimal
    total_out: Decimal
    net_balance: Decimal
    entries: list[CashbookEntryOut]
    model_config = ConfigDict(from_attributes=True)


class CashbookDailySummaryOut(BaseModel):
    day: str
    total_in: Decimal
    total_out: Decimal
    net_balance: Decimal
    model_config = ConfigDict(from_attributes=True)
