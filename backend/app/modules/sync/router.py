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
from app.modules.customers.models import Customer, CustomerLedgerEntry
from app.modules.finance.models import CashbookEntry
from app.modules.inventory.models import Purchase, Supplier, SupplierPayment
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
    entity_type = item.get("entity_type", "sale")
    if entity_type != "sale":
        if entity_type not in {"customer", "supplier", "customer_ledger", "supplier_ledger", "cashbook_entry"}:
            raise HTTPException(status_code=422, detail=f"Unsupported sync entity type: {entity_type}.")
        normalized = dict(item)
        normalized["entity_type"] = entity_type
        normalized["client_id"] = normalized.get("client_id") or normalized.get("clientId") or normalized.get("idempotency_key")
        if not normalized["client_id"]:
            raise HTTPException(status_code=422, detail="Each sync item requires a client_id or clientId.")
        normalized["idempotency_key"] = normalized.get("idempotency_key") or normalized["client_id"]
        normalized["store_id"] = normalized.get("store_id") or normalized.get("storeId")
        if not normalized.get("store_id"):
            raise HTTPException(status_code=422, detail="Each sync item requires a store_id.")
        return normalized
    if "items" not in item and "payments" not in item:
        raise HTTPException(status_code=422, detail="Sync payload is missing an item list.")
    normalized = dict(item)
    normalized["client_id"] = normalized.get("client_id") or normalized.get("clientId") or normalized.get("idempotency_key")
    if not normalized["client_id"]:
        raise HTTPException(status_code=422, detail="Each sync item requires a client_id or clientId.")
    normalized["idempotency_key"] = normalized.get("idempotency_key") or normalized["client_id"]
    normalized["store_id"] = normalized.get("store_id") or normalized.get("storeId")
    normalized["customer_id"] = normalized.get("customer_id") or normalized.get("customerId")
    normalized["customer_name"] = normalized.get("customer_name") or normalized.get("customerName") or normalized.get("customer")
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
        amount = payment.get("amount") if payment.get("amount") is not None else payment.get("amountMinor")
        if method is None or amount is None:
            raise HTTPException(status_code=422, detail="Every payment requires a method and amount.")
        normalized_payment = {"method": method, "amount": str(amount)}
        if payment.get("reference") is not None:
            normalized_payment["reference"] = str(payment["reference"])
        if payment.get("note") is not None:
            normalized_payment["note"] = str(payment["note"])
        if _safe_decimal(amount) > 0:
            normalized_payments.append(normalized_payment)
    normalized["payments"] = normalized_payments
    normalized["entity_type"] = "sale"
    return normalized


def _sync_datetime(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail="Sync timestamps must be ISO-8601 strings.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Sync timestamp is invalid.") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _apply_sync_record(
    entity_type: str,
    item: dict[str, Any],
    membership: Membership,
    current_user: User,
    db: Session,
) -> str:
    from app.modules.businesses.models import Store

    store = (
        db.query(Store)
        .filter(
            Store.id == str(item["store_id"]),
            Store.business_id == membership.business_id,
            Store.is_active.is_(True),
        )
        .first()
    )
    if not store or (membership.role != "owner" and store.id not in (membership.store_access or [])):
        raise HTTPException(status_code=403, detail="You do not have access to this sync item's store.")
    created_at = _sync_datetime(item.get("createdAt") or item.get("created_at"))
    entity_id = str(item.get("entryId") or item.get("id") or "")

    if entity_type == "customer":
        if membership.role not in {"owner", "business_manager", "sales_manager", "cashier", "accountant"}:
            raise HTTPException(status_code=403, detail="You do not have permission to sync customers.")
        name = str(item.get("name") or "").strip()
        phone = str(item.get("phone") or "").strip() or None
        if not entity_id or not 1 <= len(name) <= 180 or (phone and len(phone) > 32):
            raise HTTPException(status_code=422, detail="Customer sync details are invalid.")
        if db.query(Customer).filter(Customer.id == entity_id, Customer.business_id == membership.business_id).first():
            return "Customer already exists."
        customer = Customer(
            id=entity_id,
            business_id=membership.business_id,
            name=name,
            phone=phone,
            created_by=current_user.id,
            created_at=created_at,
        )
        db.add(customer)
        db.flush()
        return "Customer synced."

    if entity_type == "supplier":
        if membership.role not in {"owner", "business_manager", "inventory_manager"}:
            raise HTTPException(status_code=403, detail="You do not have permission to sync suppliers.")
        name = str(item.get("name") or "").strip()
        phone = str(item.get("phone") or "").strip() or None
        if not entity_id or not 1 <= len(name) <= 180 or (phone and len(phone) > 32):
            raise HTTPException(status_code=422, detail="Supplier sync details are invalid.")
        if db.query(Supplier).filter(Supplier.id == entity_id, Supplier.business_id == membership.business_id).first():
            return "Supplier already exists."
        db.add(Supplier(
            id=entity_id,
            business_id=membership.business_id,
            name=name,
            phone=phone,
            created_at=created_at,
        ))
        db.flush()
        return "Supplier synced."

    if entity_type == "customer_ledger":
        if membership.role not in {"owner", "business_manager", "sales_manager", "cashier", "accountant"}:
            raise HTTPException(status_code=403, detail="You do not have permission to sync customer payments.")
        customer_id = str(item.get("customerId") or item.get("customer_id") or "")
        customer = db.query(Customer).filter(
            Customer.id == customer_id,
            Customer.business_id == membership.business_id,
            Customer.is_active.is_(True),
        ).first()
        amount = _safe_decimal(item.get("amountMinor"))
        if not entity_id or not customer or amount <= 0:
            raise HTTPException(status_code=422, detail="Customer payment sync details are invalid.")
        if db.query(CustomerLedgerEntry).filter(CustomerLedgerEntry.id == entity_id).first():
            return "Customer ledger entry already exists."
        db.add(CustomerLedgerEntry(
            id=entity_id,
            business_id=membership.business_id,
            customer_id=customer.id,
            kind="payment",
            amount=-amount,
            description="Offline customer payment",
            reference=entity_id,
            note=str(item.get("note") or "")[:500] or None,
            created_by=current_user.id,
            created_at=created_at,
        ))
        db.flush()
        return "Customer payment synced."

    if entity_type == "supplier_ledger":
        if membership.role not in {"owner", "business_manager", "store_manager", "inventory_manager", "accountant"}:
            raise HTTPException(status_code=403, detail="You do not have permission to sync supplier accounts.")
        supplier_id = str(item.get("supplierId") or item.get("supplier_id") or "")
        supplier = db.query(Supplier).filter(
            Supplier.id == supplier_id,
            Supplier.business_id == membership.business_id,
        ).first()
        amount = _safe_decimal(item.get("amountMinor"))
        entry_type = item.get("entryType")
        if not entity_id or not supplier or amount <= 0 or entry_type not in {"bill", "payment"}:
            raise HTTPException(status_code=422, detail="Supplier ledger sync details are invalid.")
        if entry_type == "bill":
            if db.query(Purchase).filter(Purchase.id == entity_id, Purchase.business_id == membership.business_id).first():
                return "Supplier bill already exists."
            db.add(Purchase(
                id=entity_id,
                business_id=membership.business_id,
                store_id=store.id,
                supplier_id=supplier.id,
                reference_number=entity_id,
                status="draft",
                total_amount=amount,
                note=str(item.get("note") or "Offline supplier bill")[:500],
                created_by=current_user.id,
                created_at=created_at,
            ))
            db.flush()
            return "Supplier bill synced without receiving stock."
        if db.query(SupplierPayment).filter(SupplierPayment.id == entity_id, SupplierPayment.business_id == membership.business_id).first():
            return "Supplier payment already exists."
        db.add(SupplierPayment(
            id=entity_id,
            business_id=membership.business_id,
            store_id=store.id,
            supplier_id=supplier.id,
            amount=amount,
            method="cash",
            note=str(item.get("note") or "")[:500] or None,
            status="posted",
            created_by=current_user.id,
            created_at=created_at,
        ))
        db.flush()
        return "Supplier payment synced."

    if entity_type == "cashbook_entry":
        if membership.role not in {"owner", "business_manager", "store_manager", "sales_manager", "cashier", "accountant"}:
            raise HTTPException(status_code=403, detail="You do not have permission to sync cashbook entries.")
        direction = item.get("entryType")
        amount = _safe_decimal(item.get("amountMinor"))
        if not entity_id or direction not in {"income", "expense"} or amount <= 0:
            raise HTTPException(status_code=422, detail="Cashbook sync details are invalid.")
        if db.query(CashbookEntry).filter(CashbookEntry.id == entity_id, CashbookEntry.business_id == membership.business_id).first():
            return "Cashbook entry already exists."
        source = item.get("source")
        entry_type = {
            "sale": "sale_receipt",
            "customer_collection": "customer_payment",
            "supplier_payment": "supplier_payment",
        }.get(source, direction)
        db.add(CashbookEntry(
            id=entity_id,
            business_id=membership.business_id,
            store_id=store.id,
            entry_type=entry_type,
            direction="in" if direction == "income" else "out",
            amount=amount,
            category=str(item.get("category") or "general")[:50],
            reference_type=str(source or "offline")[:40],
            reference_id=str(item.get("referenceId") or entity_id)[:36],
            note=str(item.get("note") or "")[:500] or None,
            created_by=current_user.id,
            created_at=created_at,
        ))
        db.flush()
        return "Cashbook entry synced."

    raise HTTPException(status_code=422, detail=f"Unsupported sync entity type: {entity_type}.")


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
        entity_type = str(normalized.get("entity_type", "sale"))
        duplicate = (
            db.query(SyncOperation)
            .filter(
                SyncOperation.business_id == membership.business_id,
                SyncOperation.idempotency_key == client_id,
            )
            .first()
        )
        if duplicate and duplicate.status != "failed":
            results.append(SyncPushResult(client_id=client_id, state=duplicate.status, message=duplicate.result_message or duplicate.error_message))
            continue

        if duplicate:
            operation = duplicate
            operation.status = "pending"
            operation.error_message = None
            operation.attempts += 1
        else:
            operation = SyncOperation(
                business_id=membership.business_id,
                user_id=current_user.id,
                device_id=device.id,
                entity_type=entity_type,
                operation_name=f"create_{entity_type}",
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
            if entity_type == "sale":
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
                message = sale.sale_number if hasattr(sale, "sale_number") else "synced"
            else:
                message = _apply_sync_record(entity_type, normalized, membership, current_user, db)
            operation.status = "synced"
            operation.result_message = message
            operation.error_message = None
            db.commit()
            results.append(SyncPushResult(client_id=client_id, state="synced", message=operation.result_message))
        except HTTPException as exc:
            db.rollback()
            operation = (
                db.query(SyncOperation)
                .filter(
                    SyncOperation.business_id == membership.business_id,
                    SyncOperation.idempotency_key == client_id,
                )
                .first()
            )
            if operation is None:
                operation = SyncOperation(
                    business_id=membership.business_id,
                    user_id=current_user.id,
                    device_id=device.id,
                    entity_type=entity_type,
                    operation_name=f"create_{entity_type}",
                    idempotency_key=client_id,
                    payload=normalized,
                    attempts=1,
                )
                db.add(operation)
            operation.status = "failed"
            operation.error_message = exc.detail
            operation.result_message = None
            db.commit()
            results.append(SyncPushResult(client_id=client_id, state="failed", message=str(exc.detail)))
        except Exception as exc:
            db.rollback()
            operation = (
                db.query(SyncOperation)
                .filter(
                    SyncOperation.business_id == membership.business_id,
                    SyncOperation.idempotency_key == client_id,
                )
                .first()
            )
            if operation is None:
                operation = SyncOperation(
                    business_id=membership.business_id,
                    user_id=current_user.id,
                    device_id=device.id,
                    entity_type=entity_type,
                    operation_name=f"create_{entity_type}",
                    idempotency_key=client_id,
                    payload=normalized,
                    attempts=1,
                )
                db.add(operation)
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
