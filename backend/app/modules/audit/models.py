import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProductAuditEvent(Base):
    __tablename__ = "product_audit_events"
    __table_args__ = (
        Index("ix_product_audit_scope_created", "business_id", "store_id", "category_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True, nullable=False)
    store_id: Mapped[str | None] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), index=True, nullable=True)
    product_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    variant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    category_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    category_name: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
