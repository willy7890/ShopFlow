from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SubscriptionPlanCreate(BaseModel):
    slug: str = Field(min_length=2, max_length=40, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=2, max_length=80)
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="TZS", min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    duration_days: int = Field(ge=1, le=3660)
    features: dict[str, bool | int | str] = Field(default_factory=dict)
    is_active: bool = True


class SubscriptionPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    duration_days: int | None = Field(default=None, ge=1, le=3660)
    features: dict[str, bool | int | str] | None = None
    is_active: bool | None = None


class SubscriptionPlanOut(BaseModel):
    id: str
    slug: str
    name: str
    price: Decimal
    currency: str
    duration_days: int
    features: dict[str, bool | int | str]
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class SubscriptionRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=36)


class BusinessSubscriptionOut(BaseModel):
    id: str
    business_id: str
    plan_id: str | None
    status: str
    started_at: datetime
    expires_at: datetime | None
    last_billed_at: datetime | None
    renewal_price: Decimal
    currency: str
    feature_overrides: dict[str, bool | int | str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EntitlementsOut(BaseModel):
    subscription: BusinessSubscriptionOut | None
    plan: SubscriptionPlanOut | None
    features: dict[str, bool | int | str]


class AdminSubscriptionGrant(BaseModel):
    plan_id: str = Field(min_length=1, max_length=36)
    duration_days: int | None = Field(default=None, ge=1, le=3660)
    reason: str = Field(min_length=5, max_length=500)


class AdminBusinessOut(BaseModel):
    id: str
    name: str
    business_type: str
    currency: str
    is_active: bool
    subscription: BusinessSubscriptionOut | None


class BusinessStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=5, max_length=500)


class UserStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=5, max_length=500)


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
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    active_subscription_count: int
    pending_subscription_count: int
    confirmed_subscription_revenue: Decimal | None
    currency: str | None


class SubscriptionAuditOut(BaseModel):
    id: str
    business_id: str | None
    user_id: str | None
    event_type: str
    details: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
