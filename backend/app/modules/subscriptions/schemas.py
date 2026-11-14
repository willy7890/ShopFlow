from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class SubscriptionPlanCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=40, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="TZS", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    duration_days: int = Field(ge=1, le=3660)
    trial_days: int = Field(default=0, ge=0, le=366)
    features: dict[str, bool | int | str] = Field(default_factory=dict)
    is_active: bool = True


class SubscriptionPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    duration_days: int | None = Field(default=None, ge=1, le=3660)
    trial_days: int | None = Field(default=None, ge=0, le=366)
    features: dict[str, bool | int | str] | None = None
    is_active: bool | None = None


class SubscriptionPlanOut(BaseModel):
    id: str
    slug: str
    name: str
    description: str | None = None
    price: Decimal
    currency: str
    duration_days: int
    trial_days: int = 0
    features: dict[str, bool | int | str]
    entitlement_schema_version: int = 0
    is_active: bool
    archived_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SubscriptionRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=36)


class InitialPaidPlansResult(BaseModel):
    plans: list[SubscriptionPlanOut]
    created_slugs: list[str]
    unchanged_slugs: list[str]


class CustomerPaymentSubmission(BaseModel):
    payment_method: Literal["manual", "mobile_money", "bank", "cash"]
    transaction_reference: str = Field(min_length=3, max_length=160)
    paid_at: datetime

    @field_validator("transaction_reference", mode="before")
    @classmethod
    def normalize_reference(cls, value):
        return value.strip() if isinstance(value, str) else value


class PaymentMethodSettingInput(BaseModel):
    display_name: str = Field(min_length=2, max_length=80)
    recipient_name: str = Field(min_length=2, max_length=160)
    recipient_details: str = Field(min_length=3, max_length=240)
    reference_instructions: str = Field(min_length=3, max_length=500)
    is_active: bool = True
    reason: str = Field(min_length=5, max_length=500)


class PaymentMethodSettingOut(BaseModel):
    id: str
    currency: str
    method: str
    display_name: str
    recipient_name: str
    recipient_details: str
    reference_instructions: str
    is_active: bool
    evidence_supported: bool
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaymentInstructionsOut(BaseModel):
    currency: str
    instructions: str
    configured: bool
    methods: list[PaymentMethodSettingOut] = Field(default_factory=list)


class BusinessSubscriptionOut(BaseModel):
    id: str
    business_id: str
    plan_id: str | None
    status: str
    effective_status: str | None = None
    started_at: datetime
    expires_at: datetime | None
    last_billed_at: datetime | None
    renewal_price: Decimal
    currency: str
    feature_overrides: dict[str, bool | int | str]
    entitlement_mode: Literal["legacy", "enforced"] = "enforced"
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EntitlementsOut(BaseModel):
    subscription: BusinessSubscriptionOut | None
    plan: SubscriptionPlanOut | None
    features: dict[str, bool | int | str]


class AdminSubscriptionGrant(BaseModel):
    plan_id: str = Field(min_length=1, max_length=36)
    duration_days: int | None = Field(default=None, ge=1, le=3660)
    grant_type: Literal["complimentary", "trial"] = "complimentary"
    reason: str = Field(min_length=5, max_length=500)


class AdminBusinessOut(BaseModel):
    id: str
    name: str
    business_type: str
    currency: str
    is_active: bool
    created_at: datetime
    subscription: BusinessSubscriptionOut | None


class AdminBusinessDetailOut(AdminBusinessOut):
    created_at: datetime
    owner_user_id: str | None = None
    owner_name: str | None = None
    owner_email: str | None = None
    store_count: int
    employee_count: int
    user_count: int
    product_count: int
    sales_count: int


class PlatformSubscriptionOut(BusinessSubscriptionOut):
    business_name: str


class PlatformSubscriptionUpdate(BaseModel):
    status: Literal["active", "trial", "suspended", "cancelled"] | None = None
    extend_days: int | None = Field(default=None, ge=1, le=3660)
    reason: str = Field(min_length=5, max_length=500)
    entitlement_mode: Literal["legacy", "enforced"] | None = None


class PlatformCurrencyTotals(BaseModel):
    currency: str
    sales_revenue: Decimal
    expenses: Decimal
    gross_profit: Decimal | None
    outstanding_debt: Decimal
    supplier_liabilities: Decimal
    transaction_count: int


class BusinessGrowthPoint(BaseModel):
    month: str
    businesses: int


class BusinessStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=5, max_length=500)


class PlanArchiveRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class UserStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=5, max_length=500)


class SuperAdminReconciliationRequest(BaseModel):
    existing_admin_email: EmailStr
    confirm_primary_email: EmailStr
    reason: str = Field(min_length=20, max_length=500)

    @field_validator("existing_admin_email", "confirm_primary_email", mode="before")
    @classmethod
    def normalize_emails(cls, value):
        return value.strip().casefold() if isinstance(value, str) else value


class StoreCreate(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    code: str = Field(min_length=2, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    address: str | None = Field(default=None, max_length=255)


class StoreStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=5, max_length=500)


class PlatformUserOut(BaseModel):
    id: str
    full_name: str
    email: str
    phone: str | None
    is_active: bool
    is_super_admin: bool
    is_email_verified: bool
    created_at: datetime
    last_login_at: datetime | None = None
    businesses: list[PlatformUserBusinessOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PlatformUserBusinessOut(BaseModel):
    business_id: str
    business_name: str
    business_is_active: bool
    role: str
    membership_is_active: bool
    subscription_status: str | None = None
    subscription_expires_at: datetime | None = None
    plan_id: str | None = None
    plan_name: str | None = None


class PlatformUserDetailOut(PlatformUserOut):
    audit_history: list[SubscriptionAuditOut] = Field(default_factory=list)


class SubscriptionPaymentCreate(BaseModel):
    subscription_id: str
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    payment_method: str = Field(min_length=2, max_length=40)
    transaction_reference: str | None = Field(default=None, max_length=160)
    paid_at: datetime
    confirmation_details: str | None = Field(default=None, max_length=1000)


class SubscriptionPaymentStatusUpdate(BaseModel):
    status: Literal["confirmed", "failed", "refunded"]
    details: str = Field(min_length=5, max_length=1000)
    refund_amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=2)


class SubscriptionPaymentOut(BaseModel):
    id: str
    business_id: str
    business_name: str
    subscription_id: str
    plan_id: str | None
    plan_name: str | None
    amount: Decimal
    currency: str
    payment_method: str
    transaction_reference: str | None
    paid_at: datetime
    status: str
    confirmation_user_id: str | None
    confirmed_at: datetime | None
    confirmation_details: str | None
    refund_amount: Decimal | None
    refunded_at: datetime | None
    refund_details: str | None
    created_at: datetime


class RevenuePeriodOut(BaseModel):
    period: str
    currency: str
    confirmed_amount: Decimal
    refunded_amount: Decimal


class RevenueByPlanOut(BaseModel):
    plan_id: str | None
    plan_name: str
    currency: str
    confirmed_amount: Decimal


class PlatformRevenueOut(BaseModel):
    start_date: date
    end_date: date
    daily: list[RevenuePeriodOut]
    monthly: list[RevenuePeriodOut]
    yearly: list[RevenuePeriodOut]
    by_plan: list[RevenueByPlanOut]
    pending_count: int
    pending_amount_by_currency: list[PlatformCurrencyTotals]
    failed_count: int
    refunds_by_currency: list[PlatformCurrencyTotals]
    active_paying_business_count: int
    expired_subscription_count: int


class PlatformStoreOut(BaseModel):
    id: str
    business_id: str
    name: str
    code: str
    address: str | None
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class PlatformAnalyticsOut(BaseModel):
    business_count: int
    active_business_count: int
    user_count: int
    store_count: int = 0
    employee_count: int = 0
    product_count: int = 0
    transaction_count: int = 0
    active_subscription_count: int
    pending_subscription_count: int
    confirmed_subscription_revenue: Decimal | None
    currency: str | None
    currency_totals: list[PlatformCurrencyTotals] = Field(default_factory=list)
    business_growth: list[BusinessGrowthPoint] = Field(default_factory=list)


class AdminBusinessUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    business_type: str | None = Field(default=None, min_length=2, max_length=60)
    country_code: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Z]{2}$")
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    reason: str = Field(min_length=5, max_length=500)


class GlobalReportOut(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    business_count: int
    active_business_count: int
    suspended_business_count: int
    user_count: int
    store_count: int
    product_count: int
    transaction_count: int
    currency_totals: list[PlatformCurrencyTotals]


class SubscriptionAuditOut(BaseModel):
    id: str
    business_id: str | None
    user_id: str | None
    event_type: str
    details: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
