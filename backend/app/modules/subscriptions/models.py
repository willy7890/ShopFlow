import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_subscription_plan_slug"),
        Index("ix_subscription_plans_active_slug", "is_active", "slug"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    slug: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="TZS", nullable=False)
    duration_days: Mapped[int] = mapped_column(default=30, nullable=False)
    trial_days: Mapped[int] = mapped_column(default=0, nullable=False)
    features: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    entitlement_schema_version: Mapped[int] = mapped_column(default=1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class BusinessSubscription(Base):
    __tablename__ = "business_subscriptions"
    __table_args__ = (Index("ix_business_subscriptions_business_created", "business_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("subscription_plans.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_billed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    renewal_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="TZS", nullable=False)
    feature_overrides: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    entitlement_mode: Mapped[str] = mapped_column(String(24), default="enforced", server_default="enforced", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class SubscriptionAuditLog(Base):
    __tablename__ = "subscription_audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id: Mapped[str | None] = mapped_column(ForeignKey("businesses.id", ondelete="SET NULL"), index=True, nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SubscriptionPayment(Base):
    __tablename__ = "subscription_payments"
    __table_args__ = (
        UniqueConstraint("transaction_reference", name="uq_subscription_payment_reference"),
        Index(
            "uq_subscription_payment_normalized_reference",
            text("lower(trim(transaction_reference))"),
            unique=True,
            sqlite_where=text("transaction_reference IS NOT NULL"),
            postgresql_where=text("transaction_reference IS NOT NULL"),
        ),
        Index("ix_subscription_payment_business_paid", "business_id", "paid_at"),
        Index("ix_subscription_payment_status_paid", "status", "paid_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"), index=True, nullable=False)
    subscription_id: Mapped[str] = mapped_column(ForeignKey("business_subscriptions.id", ondelete="RESTRICT"), index=True, nullable=False)
    plan_id: Mapped[str | None] = mapped_column(ForeignKey("subscription_plans.id", ondelete="SET NULL"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(40), nullable=False)
    transaction_reference: Mapped[str | None] = mapped_column(String(160), nullable=True)
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    confirmation_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmation_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    refund_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refund_details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class SubscriptionPaymentMethodSetting(Base):
    __tablename__ = "subscription_payment_method_settings"
    __table_args__ = (
        UniqueConstraint("currency", "method", name="uq_subscription_payment_method_currency"),
        Index("ix_subscription_payment_settings_active_currency", "currency", "is_active"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    recipient_name: Mapped[str] = mapped_column(String(160), nullable=False)
    recipient_details: Mapped[str] = mapped_column(String(240), nullable=False)
    reference_instructions: Mapped[str] = mapped_column(String(500), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    evidence_supported: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
