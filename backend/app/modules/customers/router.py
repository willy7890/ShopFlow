from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership
from app.modules.customers.models import Customer, CustomerLedgerEntry
from app.modules.customers.schemas import (
    CustomerAdjustmentCreate,
    CustomerCreate,
    CustomerLedgerOut,
    CustomerOut,
    CustomerPaymentCreate,
    CustomerStatementOut,
    CustomerUpdate,
)

router = APIRouter()


def _customer_for_business(customer_id: str, membership: Membership, db: Session) -> Customer:
    customer = (
        db.query(Customer)
        .filter(Customer.id == customer_id, Customer.business_id == membership.business_id, Customer.is_active.is_(True))
        .first()
    )
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found in this business.")
    return customer


def _customer_balance(customer_id: str, db: Session) -> Decimal:
    balance = (
        db.query(func.coalesce(func.sum(CustomerLedgerEntry.amount), Decimal("0")))
        .filter(CustomerLedgerEntry.customer_id == customer_id)
        .scalar()
    )
    return Decimal(str(balance)) if balance is not None else Decimal("0")


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(
    payload: CustomerCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "sales_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.phone:
        existing = (
            db.query(Customer)
            .filter(Customer.business_id == membership.business_id, Customer.phone == payload.phone, Customer.is_active.is_(True))
            .first()
        )
        if existing:
            raise HTTPException(status_code=409, detail="Customer with this phone number already exists in this business.")

    customer = Customer(
        business_id=membership.business_id,
        name=payload.name.strip(),
        phone=payload.phone.strip() if payload.phone else None,
        email=payload.email.lower() if payload.email else None,
        address=payload.address.strip() if payload.address else None,
        notes=payload.notes.strip() if payload.notes else None,
        credit_limit=payload.credit_limit,
        outstanding_balance=Decimal("0"),
        created_by=current_user.id,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("", response_model=list[CustomerOut])
def list_customers(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return (
        db.query(Customer)
        .filter(Customer.business_id == membership.business_id, Customer.is_active.is_(True))
        .order_by(Customer.name.asc())
        .all()
    )


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    customer = _customer_for_business(customer_id, membership, db)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    return customer


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: str,
    payload: CustomerUpdate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "sales_manager", "accountant")),
    db: Session = Depends(get_db),
):
    customer = _customer_for_business(customer_id, membership, db)
    if payload.name is not None:
        customer.name = payload.name.strip()
    if payload.phone is not None:
        customer.phone = payload.phone.strip() or None
    if payload.email is not None:
        customer.email = payload.email.lower()
    if payload.address is not None:
        customer.address = payload.address.strip() or None
    if payload.notes is not None:
        customer.notes = payload.notes.strip() or None
    if payload.credit_limit is not None:
        customer.credit_limit = payload.credit_limit
    if payload.is_active is not None:
        customer.is_active = payload.is_active
    db.commit()
    db.refresh(customer)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    return customer


@router.post("/{customer_id}/payments", response_model=CustomerLedgerOut, status_code=201)
def record_customer_payment(
    customer_id: str,
    payload: CustomerPaymentCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "sales_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = _customer_for_business(customer_id, membership, db)
    if payload.method == "mobile_money":
        raise HTTPException(
            status_code=409,
            detail="Mobile-money collections are unavailable until the Vodacom Tanzania provider is integrated.",
        )
    outstanding = _customer_balance(customer.id, db)
    if payload.amount > outstanding + Decimal("0.01"):
        raise HTTPException(status_code=422, detail="Payment amount exceeds the current customer balance.")

    entry = CustomerLedgerEntry(
        business_id=membership.business_id,
        customer_id=customer.id,
        sale_id=payload.sale_id,
        kind="payment",
        amount=-Decimal(str(payload.amount)),
        description="Customer payment received",
        reference=payload.reference,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(entry)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{customer_id}/adjustments", response_model=CustomerLedgerOut, status_code=201)
def record_customer_adjustment(
    customer_id: str,
    payload: CustomerAdjustmentCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "sales_manager", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = _customer_for_business(customer_id, membership, db)
    if payload.amount == 0:
        raise HTTPException(status_code=422, detail="Adjustment amount cannot be zero.")

    entry = CustomerLedgerEntry(
        business_id=membership.business_id,
        customer_id=customer.id,
        kind="adjustment",
        amount=Decimal(str(payload.amount)),
        description=f"Manual adjustment: {payload.reason}",
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(entry)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{customer_id}/history", response_model=list[CustomerLedgerOut])
def get_customer_history(
    customer_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    _customer_for_business(customer_id, membership, db)
    return (
        db.query(CustomerLedgerEntry)
        .filter(CustomerLedgerEntry.customer_id == customer_id, CustomerLedgerEntry.business_id == membership.business_id)
        .order_by(CustomerLedgerEntry.created_at.desc())
        .all()
    )


@router.get("/{customer_id}/statement", response_model=CustomerStatementOut)
def get_customer_statement(
    customer_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    customer = _customer_for_business(customer_id, membership, db)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    ledger = (
        db.query(CustomerLedgerEntry)
        .filter(CustomerLedgerEntry.customer_id == customer.id, CustomerLedgerEntry.business_id == membership.business_id)
        .order_by(CustomerLedgerEntry.created_at.desc())
        .all()
    )
    total_sales = sum((entry.amount for entry in ledger if entry.amount > 0), Decimal("0"))
    total_payments = sum((abs(entry.amount) for entry in ledger if entry.amount < 0), Decimal("0"))
    return CustomerStatementOut(
        customer=customer,
        total_sales=total_sales,
        total_payments=total_payments,
        outstanding_balance=customer.outstanding_balance,
        ledger=ledger,
    )


@router.post("/{customer_id}/payments/{entry_id}/reverse", response_model=CustomerLedgerOut, status_code=201)
def reverse_customer_payment(
    customer_id: str,
    entry_id: str,
    membership: Membership = Depends(require_roles("owner", "business_manager", "sales_manager", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = _customer_for_business(customer_id, membership, db)
    entry = (
        db.query(CustomerLedgerEntry)
        .filter(
            CustomerLedgerEntry.id == entry_id,
            CustomerLedgerEntry.customer_id == customer.id,
            CustomerLedgerEntry.business_id == membership.business_id,
            CustomerLedgerEntry.kind == "payment",
        )
        .first()
    )
    if not entry:
        raise HTTPException(status_code=404, detail="Customer payment record not found.")

    reversal = CustomerLedgerEntry(
        business_id=membership.business_id,
        customer_id=customer.id,
        sale_id=entry.sale_id,
        kind="reversal",
        amount=abs(entry.amount),
        description="Payment reversal",
        reference=f"REV-{entry.id[:8]}",
        note="Reversed customer payment entry.",
        created_by=current_user.id,
    )
    db.add(reversal)
    customer.outstanding_balance = _customer_balance(customer.id, db)
    db.commit()
    db.refresh(reversal)
    return reversal
