import json
from typing import Any

from sqlalchemy.orm import Session

from app.modules.audit.models import ProductAuditEvent


def record_product_event(
    db: Session,
    *,
    business_id: str,
    product_id: str,
    actor_id: str | None,
    event_type: str,
    after: dict[str, Any],
    store_id: str | None = None,
    variant_id: str | None = None,
    category_id: str | None = None,
    category_name: str = "",
    before: dict[str, Any] | None = None,
) -> None:
    db.add(ProductAuditEvent(
        business_id=business_id,
        store_id=store_id,
        product_id=product_id,
        variant_id=variant_id,
        category_id=category_id,
        category_name=category_name,
        event_type=event_type,
        before_json=json.dumps(before, ensure_ascii=False, sort_keys=True, default=str) if before is not None else None,
        after_json=json.dumps(after, ensure_ascii=False, sort_keys=True, default=str),
        actor_id=actor_id,
    ))
