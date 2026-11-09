from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user
from app.modules.auth.models import User
from app.modules.businesses.models import Membership
from app.modules.sales.router import create_sale
from app.modules.sales.schemas import SaleCreate
from app.modules.sync.models import SyncDevice, SyncOperation
from app.modules.sync.schemas import SyncDeviceCreate, SyncDeviceOut, SyncOperationOut, SyncPushRequest, SyncPushResult, SyncStatusOut

router = APIRouter()


def _safe_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Invalid numeric value provided.") from exc


def _get_or_create_device(
    business_id: str,
    user_id: str,
    db: Session,
    device_name: str = "default-device",
    device_type: str = "web",
    platform: str | None = None,
) -> SyncDevice:
    device = (
        db.query(SyncDevice)
        .filter(SyncDevice.business_id == business_id, SyncDevice.user_id == user_id, SyncDevice.device_name == device_name)
        .first()
    )
    if device:
        device.device_type = device_type
        if platform:
            device.platform = platform
        return device
    device = SyncDevice(
        business_id=business_id,
        user_id=user_id,
        device_name=device_name,
        device_type=device_type,
        platform=platform,
    )
    db.add(device)
    db.flush()
    return device


def _normalize_sync_item(item: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(item, dict):
        raise HTTPException(status_code=422, detail="Each sync item must be a JSON object.")
    if "items" not in item and "payments" not in item:
        raise HTTPException(status_code=422, detail="Sync payload is missing an item list.")
    normalized = dict(item)
    normalized["client_id"] = normalized.get("client_id") or normalized.get("clientId") or normalized.get("idempotency_key")
    if not normalized["client_id"]:
        raise HTTPException(status_code=422, detail="Each sync item requires a client_id or clientId.")
    normalized["idempotency_key"] = normalized.get("idempotency_key") or normalized["client_id"]
    normalized["customer_name"] = normalized.get("customer_name") or normalized.get("customer")
    normalized["customer_phone"] = normalized.get("customer_phone")
    normalized["note"] = normalized.get("note") or normalized.get("description")
    if not normalized.get("items"):
        raise HTTPException(status_code=422, detail="Each sync sale requires at least one item.")
    normalized_items = []
    for line in normalized.get("items", []):
        if not isinstance(line, dict):
            raise HTTPException(status_code=422, detail="Each sync sale item must be an object.")
        variant_id = line.get("variant_id") or line.get("variantId")
        qty = line.get("quantity") or line.get("qty")
        unit_price = line.get("unit_price") or line.get("unitPrice") or line.get("price")
        if variant_id is None or qty is None:
            raise HTTPException(status_code=422, detail="Every sale line requires a variant_id and quantity.")
        normalized_line = {
            "variant_id": str(variant_id),
            "quantity": str(qty),
        }
        if unit_price is not None:
            normalized_line["unit_price"] = str(unit_price)
        normalized_items.append(normalized_line)
    normalized["items"] = normalized_items
    normalized_payments = []
    for payment in normalized.get("payments", []):
        if not isinstance(payment, dict):
            raise HTTPException(status_code=422, detail="Each payment must be an object.")
        method = payment.get("method")
        amount = payment.get("amount")
        if method is None or amount is None:
            raise HTTPException(status_code=422, detail="Every payment requires a method and amount.")
        normalized_payment = {"method": method, "amount": str(amount)}
        if payment.get("reference") is not None:
            normalized_payment["reference"] = str(payment["reference"])
        if payment.get("note") is not None:
            normalized_payment["note"] = str(payment["note"])
        normalized_payments.append(normalized_payment)
    normalized["payments"] = normalized_payments
    return normalized


@router.post("/devices", response_model=SyncDeviceOut, status_code=status.HTTP_201_CREATED)
def register_device(
    payload: SyncDeviceCreate,
    membership: Membership = Depends(get_business_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    device = _get_or_create_device(
        business_id=membership.business_id,
        user_id=current_user.id,
        db=db,
        device_name=payload.device_name,
        device_type=payload.device_type,
        platform=payload.platform,
    )
    db.commit()
    db.refresh(device)
    return device


@router.get("/status", response_model=SyncStatusOut)
def sync_status(
    device_name: str | None = None,
    membership: Membership = Depends(get_business_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    device_id: str | None = Header(default=None, alias="X-Device-ID"),
):
    if device_id:
        device = db.query(SyncDevice).filter(SyncDevice.id == device_id, SyncDevice.business_id == membership.business_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found.")
    else:
        device = _get_or_create_device(
            business_id=membership.business_id,
            user_id=current_user.id,
            db=db,
            device_name=device_name or "default-device",
        )
        db.commit()
    query = db.query(SyncOperation).filter(SyncOperation.business_id == membership.business_id, SyncOperation.device_id == device.id)
    pending_count = query.filter(SyncOperation.status == "pending").count()
    synced_count = query.filter(SyncOperation.status == "synced").count()
    failed_count = query.filter(SyncOperation.status == "failed").count()
    total_count = query.count()
    return SyncStatusOut(
        device_id=device.id,
        pending_count=pending_count,
        synced_count=synced_count,
        failed_count=failed_count,
        total_count=total_count,
    )


@router.post("/push")
def push_sync_items(
    payload: SyncPushRequest,
    membership: Membership = Depends(get_business_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    device_id: str | None = Header(default=None, alias="X-Device-ID"),
):
    if not payload.items:
        return []
    if device_id:
        device = db.query(SyncDevice).filter(SyncDevice.id == device_id, SyncDevice.business_id == membership.business_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found.")
    else:
        device = _get_or_create_device(
            business_id=membership.business_id,
            user_id=current_user.id,
            db=db,
            device_name="default-device",
            device_type="web",
        )
    results: list[SyncPushResult] = []
    for item in payload.items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="Each sync payload must be an object.")
        normalized = _normalize_sync_item(item)
        client_id = str(normalized["client_id"])
        duplicate = (
            db.query(SyncOperation)
            .filter(
                SyncOperation.business_id == membership.business_id,
                SyncOperation.idempotency_key == client_id,
            )
            .first()
        )
        if duplicate:
            results.append(SyncPushResult(client_id=client_id, state=duplicate.status, message=duplicate.result_message or duplicate.error_message))
            continue

        operation = SyncOperation(
            business_id=membership.business_id,
            user_id=current_user.id,
            device_id=device.id,
            entity_type="sale",
            operation_name="create_sale",
            idempotency_key=client_id,
            payload=normalized,
            status="pending",
            attempts=0,
            result_message=None,
            error_message=None,
        )
        db.add(operation)
        db.flush()

        try:
            sale_payload = SaleCreate(
                store_id=str(normalized["store_id"]),
                customer_id=normalized.get("customer_id"),
                customer_name=normalized.get("customer_name"),
                customer_phone=normalized.get("customer_phone"),
                note=normalized.get("note"),
                idempotency_key=client_id,
                items=[
                    {
                        "variant_id": line["variant_id"],
                        "quantity": _safe_decimal(line["quantity"]),
                        "unit_price": _safe_decimal(line["unit_price"]) if line.get("unit_price") is not None else None,
                    }
                    for line in normalized["items"]
                ],
                payments=[
                    {
                        "method": payment["method"],
                        "amount": _safe_decimal(payment["amount"]),
                        "reference": payment.get("reference"),
                        "note": payment.get("note"),
                    }
                    for payment in normalized["payments"]
                ],
            )
            sale = create_sale(
                payload=sale_payload,
                membership=membership,
                db=db,
                current_user=current_user,
            )
            operation.status = "synced"
            operation.result_message = sale.sale_number if hasattr(sale, "sale_number") else "synced"
            operation.error_message = None
            db.commit()
            results.append(SyncPushResult(client_id=client_id, state="synced", message=operation.result_message))
        except HTTPException as exc:
            operation.status = "failed"
            operation.error_message = exc.detail
            operation.result_message = None
            db.commit()
            results.append(SyncPushResult(client_id=client_id, state="failed", message=str(exc.detail)))
        except Exception as exc:
            operation.status = "failed"
            operation.error_message = str(exc)
            operation.result_message = None
            db.commit()
            results.append(SyncPushResult(client_id=client_id, state="failed", message=str(exc)))
    device.last_sync_at = datetime.now(timezone.utc)
    db.commit()
    return results


@router.get("/pull", response_model=list[SyncOperationOut])
def pull_sync_items(
    limit: int = 50,
    membership: Membership = Depends(get_business_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    device_id: str | None = Header(default=None, alias="X-Device-ID"),
):
    if device_id:
        device = db.query(SyncDevice).filter(SyncDevice.id == device_id, SyncDevice.business_id == membership.business_id).first()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found.")
    else:
        device = _get_or_create_device(
            business_id=membership.business_id,
            user_id=current_user.id,
            db=db,
            device_name="default-device",
        )
    operations = (
        db.query(SyncOperation)
        .filter(SyncOperation.business_id == membership.business_id, SyncOperation.device_id == device.id)
        .order_by(SyncOperation.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        SyncOperationOut(
            id=operation.id,
            entity_type=operation.entity_type,
            operation_name=operation.operation_name,
            status=operation.status,
            idempotency_key=operation.idempotency_key,
            created_at=operation.created_at.isoformat(),
            result_message=operation.result_message,
            error_message=operation.error_message,
        )
        for operation in operations
    ]


@router.post("/acknowledge")
def acknowledge_sync_operations(
    operation_ids: list[str],
    membership: Membership = Depends(get_business_membership),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not operation_ids:
        return {"acknowledged": 0}
    updated = 0
    for operation_id in operation_ids:
        operation = (
            db.query(SyncOperation)
            .filter(
                SyncOperation.id == operation_id,
                SyncOperation.business_id == membership.business_id,
                SyncOperation.user_id == current_user.id,
            )
            .first()
        )
        if not operation:
            continue
        if operation.status != "synced":
            operation.status = "synced"
        operation.is_deleted = True
        updated += 1
    db.commit()
    return {"acknowledged": updated}
