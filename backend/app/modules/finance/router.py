from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership, Store
from app.modules.finance.models import CashbookEntry
from app.modules.finance.schemas import (
    CashbookBalanceOut,
    CashbookDailySummaryOut,
    CashbookEntryCreate,
    CashbookEntryOut,
    CashbookSummaryOut,
)

router = APIRouter()


def _validate_store(membership: Membership, store_id: str | None, db: Session) -> None:
    if not store_id:
        return
    store = (
        db.query(Store)
        .filter(Store.id == store_id, Store.business_id == membership.business_id, Store.is_active.is_(True))
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found in this business.")
    if membership.role != "owner" and store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this store.")


def _filtered_query(membership: Membership, db: Session, store_id: str | None, start_date: date | None, end_date: date | None, entry_type: str | None):
    query = db.query(CashbookEntry).filter(CashbookEntry.business_id == membership.business_id, CashbookEntry.reversal_of_id.is_(None))
    if store_id:
        _validate_store(membership, store_id, db)
        query = query.filter(CashbookEntry.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(CashbookEntry.store_id.in_(membership.store_access or []))
    if start_date:
        query = query.filter(func.date(CashbookEntry.created_at) >= start_date.isoformat())
    if end_date:
        query = query.filter(func.date(CashbookEntry.created_at) <= end_date.isoformat())
    if entry_type:
        query = query.filter(CashbookEntry.entry_type == entry_type)
    return query.order_by(CashbookEntry.created_at.desc())


@router.post("/entries", response_model=CashbookEntryOut, status_code=201)
def create_cashbook_entry(
    payload: CashbookEntryCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "store_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_store(membership, payload.store_id, db)
    if payload.direction not in {"in", "out"}:
        raise HTTPException(status_code=422, detail="Direction must be 'in' or 'out'.")
    entry = CashbookEntry(
        business_id=membership.business_id,
        store_id=payload.store_id,
        entry_type=payload.entry_type,
        direction=payload.direction,
        amount=Decimal(str(payload.amount)),
        category=payload.category,
        reference_type=payload.reference_type,
        reference_id=payload.reference_id,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/entries", response_model=list[CashbookEntryOut])
def list_cashbook_entries(
    store_id: str | None = Query(default=None),
    entry_type: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return _filtered_query(membership, db, store_id, start_date, end_date, entry_type).all()


@router.get("/balance", response_model=CashbookBalanceOut)
def get_cashbook_balance(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    query = _filtered_query(membership, db, store_id, start_date, end_date, None)
    entries = query.all()
    total_in = sum((entry.amount for entry in entries if entry.direction == "in"), Decimal("0"))
    total_out = sum((entry.amount for entry in entries if entry.direction == "out"), Decimal("0"))
    return CashbookBalanceOut(total_in=total_in, total_out=total_out, net_balance=total_in - total_out)


@router.get("/summary", response_model=CashbookSummaryOut)
def get_cashbook_summary(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    query = _filtered_query(membership, db, store_id, start_date, end_date, None)
    entries = query.all()
    total_in = sum((entry.amount for entry in entries if entry.direction == "in"), Decimal("0"))
    total_out = sum((entry.amount for entry in entries if entry.direction == "out"), Decimal("0"))
    return CashbookSummaryOut(total_in=total_in, total_out=total_out, net_balance=total_in - total_out, entries=entries)


@router.get("/daily-summary", response_model=list[CashbookDailySummaryOut])
def get_daily_summary(
    store_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    query = _filtered_query(membership, db, store_id, start_date, end_date, None)
    rows = (
        query.with_entities(
            func.date(CashbookEntry.created_at).label("day"),
            func.sum(func.case((CashbookEntry.direction == "in", CashbookEntry.amount), else_=Decimal("0"))).label("total_in"),
            func.sum(func.case((CashbookEntry.direction == "out", CashbookEntry.amount), else_=Decimal("0"))).label("total_out"),
        )
        .group_by(func.date(CashbookEntry.created_at))
        .order_by(func.date(CashbookEntry.created_at).desc())
        .all()
    )
    return [
        CashbookDailySummaryOut(
            day=row.day,
            total_in=Decimal(str(row.total_in or 0)),
            total_out=Decimal(str(row.total_out or 0)),
            net_balance=Decimal(str(row.total_in or 0)) - Decimal(str(row.total_out or 0)),
        )
        for row in rows
    ]


@router.post("/entries/{entry_id}/reverse", response_model=CashbookEntryOut, status_code=201)
def reverse_cashbook_entry(
    entry_id: str,
    membership: Membership = Depends(require_roles("owner", "business_manager", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    source = (
        db.query(CashbookEntry)
        .filter(CashbookEntry.id == entry_id, CashbookEntry.business_id == membership.business_id)
        .first()
    )
    if not source:
        raise HTTPException(status_code=404, detail="Cashbook entry not found.")
    if source.reversal_of_id:
        raise HTTPException(status_code=409, detail="This cashbook entry has already been reversed.")

    reversal = CashbookEntry(
        business_id=membership.business_id,
        store_id=source.store_id,
        entry_type=f"{source.entry_type}_reversal",
        direction="out" if source.direction == "in" else "in",
        amount=source.amount,
        category=source.category,
        reference_type=source.reference_type,
        reference_id=source.reference_id,
        note=f"Reversal of {source.id}",
        created_by=current_user.id,
        reversal_of_id=source.id,
    )
    db.add(reversal)
    db.flush()
    source.reversal_of_id = reversal.id
    db.commit()
    db.refresh(reversal)
    return reversal
