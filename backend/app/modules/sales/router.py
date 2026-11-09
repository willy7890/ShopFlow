from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership, Store
from app.modules.catalog.models import Product, ProductVariant
from app.modules.customers.models import Customer, CustomerLedgerEntry
from app.modules.inventory.models import InventoryBalance, StockMovement
from app.modules.sales.models import Sale, SaleItem, SalePayment, SaleRefund
from app.modules.sales.schemas import (
    RefundOut,
    SaleCreate,
    SaleOut,
    SalePaymentCreate,
    SaleRefundCreate,
)

router = APIRouter()

VALID_PAYMENT_METHODS = {"cash", "bank", "credit", "refund"}


def _normalize_sale_status(total_amount: Decimal, paid_amount: Decimal) -> str:
    if total_amount <= 0:
        return "completed"
    if paid_amount >= total_amount:
        return "completed"
    if paid_amount > 0:
        return "partial"
    return "credit"


def _safe_decimal(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid numeric value provided.")


def _ensure_store_access(member: Membership, store_id: str, db: Session) -> Store:
    store = (
        db.query(Store)
        .filter(Store.id == store_id, Store.business_id == member.business_id, Store.is_active.is_(True))
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found in this business.")
    if member.role != "owner" and store_id not in (member.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this store.")
    return store


def _sale_for_business(sale_id: str, membership: Membership, db: Session) -> Sale:
    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.business_id == membership.business_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found.")
    if membership.role != "owner" and sale.store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this sale's store.")
    return sale


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(
    payload: SaleCreate,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant", "inventory_manager")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_store_access(membership, payload.store_id, db)
    if not payload.items:
        raise HTTPException(status_code=422, detail="A sale must include at least one item.")

    if payload.idempotency_key:
        duplicate = (
            db.query(Sale)
            .filter(
                Sale.business_id == membership.business_id,
                Sale.idempotency_key == payload.idempotency_key,
            )
            .first()
        )
        if duplicate:
            db.refresh(duplicate)
            return duplicate

    if any(payment.method == "mobile_money" for payment in payload.payments):
        raise HTTPException(
            status_code=409,
            detail="Mobile-money payments are unavailable until the Vodacom Tanzania provider is integrated.",
        )

    sale_lines: list[tuple[ProductVariant, Decimal]] = []
    subtotal = Decimal("0")
    for line in payload.items:
        variant = (
            db.query(ProductVariant)
            .filter(
                ProductVariant.id == line.variant_id,
                ProductVariant.business_id == membership.business_id,
                ProductVariant.is_active.is_(True),
            )
            .first()
        )
        if not variant:
            raise HTTPException(status_code=404, detail=f"Variant {line.variant_id} not found in this business.")
        product = db.query(Product).filter(Product.id == variant.product_id, Product.business_id == membership.business_id, Product.is_active.is_(True)).first()
        if not product:
            raise HTTPException(status_code=404, detail="The product for this variant is no longer active.")
        unit_price = line.unit_price if line.unit_price is not None else variant.selling_price
        if unit_price < Decimal("0"):
            raise HTTPException(status_code=422, detail="Item price cannot be negative.")
        if variant.track_stock:
            balance = (
                db.query(InventoryBalance)
                .filter(
                    InventoryBalance.business_id == membership.business_id,
                    InventoryBalance.store_id == payload.store_id,
                    InventoryBalance.variant_id == variant.id,
                )
                .with_for_update()
                .first()
            )
            available = Decimal(str(balance.quantity)) if balance else Decimal("0")
            if available < line.quantity:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name}. Available {available}.")
        line_total = unit_price * line.quantity
        subtotal += line_total
        sale_lines.append((variant, line.quantity))

    payment_total = sum((_safe_decimal(payment.amount) for payment in payload.payments), Decimal("0"))
    if payment_total > subtotal + Decimal("0.01"):
        raise HTTPException(status_code=422, detail="Payment total cannot exceed the sale total.")

    customer: Customer | None = None
    if payload.customer_id:
        customer = (
            db.query(Customer)
            .filter(Customer.id == payload.customer_id, Customer.business_id == membership.business_id, Customer.is_active.is_(True))
            .first()
        )
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found in this business.")

    sale_number = f"S-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{str(abs(hash(f'{membership.business_id}:{payload.store_id}:{datetime.now(timezone.utc).timestamp()}')))[:8].upper()}"
    sale = Sale(
        business_id=membership.business_id,
        store_id=payload.store_id,
        customer_id=customer.id if customer else None,
        sale_number=sale_number,
        customer_name=(payload.customer_name.strip() if payload.customer_name else customer.name if customer else None),
        customer_phone=(payload.customer_phone.strip() if payload.customer_phone else customer.phone if customer else None),
        status=_normalize_sale_status(subtotal, payment_total),
        subtotal=subtotal,
        discount=Decimal("0"),
        total_amount=subtotal,
        paid_amount=payment_total,
        balance_due=subtotal - payment_total,
        idempotency_key=payload.idempotency_key,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(sale)
    db.flush()

    for line in payload.items:
        variant = db.query(ProductVariant).filter(ProductVariant.id == line.variant_id, ProductVariant.business_id == membership.business_id).first()
        if not variant:
            raise HTTPException(status_code=404, detail=f"Variant {line.variant_id} is no longer available.")
        product = db.query(Product).filter(Product.id == variant.product_id, Product.business_id == membership.business_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product for {line.variant_id} not found.")
        unit_price = line.unit_price if line.unit_price is not None else variant.selling_price
        line_total = unit_price * line.quantity
        db.add(
            SaleItem(
                sale_id=sale.id,
                variant_id=variant.id,
                product_name=product.name,
                variant_name=variant.name,
                sku=variant.sku,
                quantity=line.quantity,
                unit_price=unit_price,
                line_total=line_total,
            )
        )
        if variant.track_stock:
            balance = (
                db.query(InventoryBalance)
                .filter(
                    InventoryBalance.business_id == membership.business_id,
                    InventoryBalance.store_id == payload.store_id,
                    InventoryBalance.variant_id == variant.id,
                )
                .with_for_update()
                .first()
            )
            if balance is None:
                balance = InventoryBalance(
                    business_id=membership.business_id,
                    store_id=payload.store_id,
                    variant_id=variant.id,
                    quantity=Decimal("0"),
                    average_cost=variant.purchase_price,
                )
                db.add(balance)
                db.flush()
            balance.quantity = Decimal(str(balance.quantity)) - line.quantity
            balance.updated_at = datetime.now(timezone.utc)
            db.add(
                StockMovement(
                    business_id=membership.business_id,
                    store_id=payload.store_id,
                    variant_id=variant.id,
                    movement_type="sale",
                    quantity_delta=-line.quantity,
                    unit_cost=variant.purchase_price,
                    reference_type="sale",
                    reference_id=sale.id,
                    note="Point-of-sale sale",
                    created_by=current_user.id,
                )
            )

    for payment in payload.payments:
        if payment.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=422, detail=f"Unsupported payment method: {payment.method}")
        db.add(
            SalePayment(
                sale_id=sale.id,
                method=payment.method,
                amount=_safe_decimal(payment.amount),
                reference=payment.reference,
                status="confirmed" if payment.method != "credit" else "pending",
                note=payment.note,
            )
        )
        if sale.customer_id:
            db.add(
                CustomerLedgerEntry(
                    business_id=membership.business_id,
                    customer_id=sale.customer_id,
                    sale_id=sale.id,
                    kind="payment",
                    amount=-_safe_decimal(payment.amount),
                    description=f"Payment recorded for sale {sale.sale_number}",
                    reference=payment.reference,
                    note=payment.note,
                    created_by=current_user.id,
                )
            )

    if not payload.payments and sale.balance_due > 0 and sale.customer_id:
        db.add(
            SalePayment(
                sale_id=sale.id,
                method="credit",
                amount=Decimal("0"),
                status="pending",
                note="Customer credit sale",
            )
        )

    if sale.customer_id:
        db.add(
            CustomerLedgerEntry(
                business_id=membership.business_id,
                customer_id=sale.customer_id,
                sale_id=sale.id,
                kind="sale",
                amount=subtotal,
                description=f"Sale {sale.sale_number}",
                created_by=current_user.id,
            )
        )

    db.commit()
    db.refresh(sale)
    sale.items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).order_by(SaleItem.product_name).all()
    sale.payments = db.query(SalePayment).filter(SalePayment.sale_id == sale.id).order_by(SalePayment.created_at).all()
    return sale


@router.get("", response_model=list[SaleOut])
def list_sales(
    store_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    query = db.query(Sale).filter(Sale.business_id == membership.business_id)
    if store_id:
        _ensure_store_access(membership, store_id, db)
        query = query.filter(Sale.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(Sale.store_id.in_(membership.store_access or []))
    if status:
        query = query.filter(Sale.status == status)
    return query.order_by(Sale.created_at.desc()).all()


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(
    sale_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sale = _sale_for_business(sale_id, membership, db)
    return sale


@router.post("/{sale_id}/payments", response_model=SaleOut)
def add_payment(
    sale_id: str,
    payload: SalePaymentCreate,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sale = _sale_for_business(sale_id, membership, db)
    if payload.method == "mobile_money":
        raise HTTPException(
            status_code=409,
            detail="Mobile-money payments are unavailable until the Vodacom Tanzania provider is integrated.",
        )
    if payload.method not in VALID_PAYMENT_METHODS:
        raise HTTPException(status_code=422, detail=f"Unsupported payment method: {payload.method}")
    if sale.balance_due <= 0 and payload.method != "refund":
        raise HTTPException(status_code=400, detail="This sale is already fully settled.")
    amount = _safe_decimal(payload.amount)
    if amount <= 0:
        raise HTTPException(status_code=422, detail="Payment amount must be greater than zero.")
    if payload.method == "refund":
        raise HTTPException(status_code=400, detail="Use the refund endpoint for refunds.")
    payment = SalePayment(
        sale_id=sale.id,
        method=payload.method,
        amount=amount,
        reference=payload.reference,
        status="confirmed" if payload.method != "credit" else "pending",
        note=payload.note,
    )
    db.add(payment)
    sale.paid_amount = Decimal(str(sale.paid_amount)) + amount
    sale.balance_due = sale.total_amount - sale.paid_amount
    sale.status = _normalize_sale_status(sale.total_amount, sale.paid_amount)
    if sale.balance_due < 0:
        sale.balance_due = Decimal("0")
        sale.paid_amount = sale.total_amount
        sale.status = "completed"
    db.commit(); db.refresh(sale)
    return sale


@router.post("/{sale_id}/refund", response_model=RefundOut)
def refund_sale(
    sale_id: str,
    payload: SaleRefundCreate,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sale = _sale_for_business(sale_id, membership, db)
    refund_amount = _safe_decimal(payload.amount) if payload.amount is not None else sale.total_amount
    if refund_amount <= 0:
        raise HTTPException(status_code=422, detail="Refund amount must be greater than zero.")
    if refund_amount > sale.paid_amount + Decimal("0.01"):
        raise HTTPException(status_code=400, detail="Refund amount cannot exceed the amount already paid on this sale.")

    if payload.items:
        item_map = {item.variant_id: item for item in db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()}
        selected_total = Decimal("0")
        for item in payload.items:
            original = item_map.get(item.variant_id)
            if not original:
                raise HTTPException(status_code=404, detail=f"Variant {item.variant_id} was not sold in this sale.")
            if item.quantity > original.quantity:
                raise HTTPException(status_code=400, detail=f"Refund quantity for {item.variant_id} exceeds the original quantity sold.")
            selected_total += original.unit_price * item.quantity
        if payload.amount is not None and abs(selected_total - refund_amount) > Decimal("0.01"):
            raise HTTPException(status_code=422, detail="Refund amount does not match the selected item totals.")
        refund_total = selected_total
    else:
        refund_total = refund_amount

    for item in payload.items or [
        type("Line", (), {"variant_id": sale_item.variant_id, "quantity": sale_item.quantity})() for sale_item in db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()
    ]:
        variant = db.query(ProductVariant).filter(ProductVariant.id == item.variant_id, ProductVariant.business_id == membership.business_id).first()
        if not variant:
            raise HTTPException(status_code=404, detail=f"Variant {item.variant_id} no longer exists in this business.")
        inventory_balance = (
            db.query(InventoryBalance)
            .filter(
                InventoryBalance.business_id == membership.business_id,
                InventoryBalance.store_id == sale.store_id,
                InventoryBalance.variant_id == variant.id,
            )
            .with_for_update()
            .first()
        )
        added_quantity = _safe_decimal(item.quantity)
        if inventory_balance is None:
            inventory_balance = InventoryBalance(
                business_id=membership.business_id,
                store_id=sale.store_id,
                variant_id=variant.id,
                quantity=Decimal("0"),
                average_cost=variant.purchase_price,
            )
            db.add(inventory_balance)
            db.flush()
        inventory_balance.quantity = Decimal(str(inventory_balance.quantity)) + added_quantity
        inventory_balance.updated_at = datetime.now(timezone.utc)
        db.add(
            StockMovement(
                business_id=membership.business_id,
                store_id=sale.store_id,
                variant_id=variant.id,
                movement_type="refund",
                quantity_delta=added_quantity,
                unit_cost=variant.purchase_price,
                reference_type="sale_refund",
                reference_id=sale.id,
                note=payload.reason,
                created_by=current_user.id,
            )
        )

    db.add(
        SaleRefund(
            sale_id=sale.id,
            amount=refund_total,
            reason=payload.reason,
            note=payload.note,
            created_by=current_user.id,
        )
    )
    sale.paid_amount = sale.paid_amount - refund_total
    sale.balance_due = max(Decimal("0"), sale.total_amount - sale.paid_amount)
    sale.status = _normalize_sale_status(sale.total_amount, sale.paid_amount)
    if sale.paid_amount <= 0:
        sale.status = "refunded"
    db.add(SalePayment(sale_id=sale.id, method="refund", amount=refund_total, status="confirmed", note=payload.reason))
    db.commit(); db.refresh(sale)
    return RefundOut(
        sale_id=sale.id,
        refund_amount=refund_total,
        remaining_balance=sale.balance_due,
        status=sale.status,
        note=payload.note,
    )


@router.get("/{sale_id}/receipt")
def get_receipt(
    sale_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    sale = _sale_for_business(sale_id, membership, db)
    items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()
    payments = db.query(SalePayment).filter(SalePayment.sale_id == sale.id).all()
    return {
        "sale_number": sale.sale_number,
        "store_id": sale.store_id,
        "customer_name": sale.customer_name,
        "status": sale.status,
        "subtotal": str(sale.subtotal),
        "total_amount": str(sale.total_amount),
        "paid_amount": str(sale.paid_amount),
        "balance_due": str(sale.balance_due),
        "items": [
            {
                "variant_id": item.variant_id,
                "product_name": item.product_name,
                "quantity": str(item.quantity),
                "unit_price": str(item.unit_price),
                "line_total": str(item.line_total),
            }
            for item in items
        ],
        "payments": [
            {
                "method": payment.method,
                "amount": str(payment.amount),
                "reference": payment.reference,
                "status": payment.status,
            }
            for payment in payments
        ],
        "created_at": sale.created_at.isoformat(),
    }
