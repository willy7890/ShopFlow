from datetime import datetime, timezone
import hashlib
import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.audit.service import record_product_event
from app.modules.businesses.models import Membership, Store
from app.modules.catalog.models import Category, Product, ProductVariant
from app.modules.customers.models import Customer, CustomerLedgerEntry
from app.modules.finance.models import CashbookEntry
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
    return _create_sale(payload, membership, db, current_user, record_cashbook=True)


def _create_sale(
    payload: SaleCreate,
    membership: Membership,
    db: Session,
    current_user: User,
    *,
    record_cashbook: bool,
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
        balance = None
        unit_cost = variant.purchase_price
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
            unit_cost = balance.average_cost or variant.purchase_price
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
                unit_cost=unit_cost,
            )
        )
        if variant.track_stock:
            assert balance is not None
            quantity_before = Decimal(str(balance.quantity))
            balance.quantity = Decimal(str(balance.quantity)) - line.quantity
            balance.updated_at = datetime.now(timezone.utc)
            db.add(
                StockMovement(
                    business_id=membership.business_id,
                    store_id=payload.store_id,
                    variant_id=variant.id,
                    movement_type="sale",
                    quantity_delta=-line.quantity,
                    unit_cost=unit_cost,
                    reference_type="sale",
                    reference_id=sale.id,
                    note="Point-of-sale sale",
                    created_by=current_user.id,
                )
            )
            category = db.query(Category).filter(Category.id == product.category_id).first() if product.category_id else None
            record_product_event(
                db,
                business_id=membership.business_id,
                store_id=payload.store_id,
                product_id=product.id,
                variant_id=variant.id,
                category_id=product.category_id,
                category_name=category.name if category else "",
                actor_id=current_user.id,
                event_type="stock_adjusted",
                before={"quantity": str(quantity_before)},
                after={"quantity": str(balance.quantity), "reason": "Sale"},
            )

    for payment in payload.payments:
        if payment.method not in VALID_PAYMENT_METHODS:
            raise HTTPException(status_code=422, detail=f"Unsupported payment method: {payment.method}")
        payment_amount = _safe_decimal(payment.amount)
        db.add(
            SalePayment(
                sale_id=sale.id,
                method=payment.method,
                amount=payment_amount,
                reference=payment.reference,
                status="confirmed" if payment.method != "credit" else "pending",
                note=payment.note,
            )
        )
        if record_cashbook and payment.method != "credit" and payment_amount > 0:
            db.add(CashbookEntry(
                business_id=membership.business_id,
                store_id=payload.store_id,
                entry_type="sale_receipt",
                direction="in",
                amount=payment_amount,
                category=f"Sale ({payment.method})",
                reference_type="sale",
                reference_id=sale.id,
                note=payment.note,
                created_by=current_user.id,
            ))
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
    sale = (
        db.query(Sale)
        .filter(Sale.id == sale_id, Sale.business_id == membership.business_id)
        .with_for_update()
        .first()
    )
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found.")
    if membership.role != "owner" and sale.store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this sale's store.")

    request_data = payload.model_dump(mode="json", exclude={"idempotency_key"})
    request_hash = hashlib.sha256(
        json.dumps(request_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if payload.idempotency_key:
        existing_refund = (
            db.query(SaleRefund)
            .filter(
                SaleRefund.sale_id == sale.id,
                SaleRefund.idempotency_key == payload.idempotency_key,
            )
            .first()
        )
        if existing_refund:
            if existing_refund.request_hash != request_hash:
                raise HTTPException(status_code=409, detail="This refund idempotency key was already used with different details.")
            return RefundOut(
                sale_id=sale.id,
                refund_amount=existing_refund.amount,
                remaining_balance=sale.balance_due,
                status=sale.status,
                note=existing_refund.note,
            )

    sale_items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).order_by(SaleItem.id).all()
    previous_quantities: dict[str, Decimal] = {}
    previous_refunds = db.query(SaleRefund).filter(SaleRefund.sale_id == sale.id).all()
    previous_refund_amount = sum(
        (Decimal(str(existing_refund.amount)) for existing_refund in previous_refunds),
        Decimal("0"),
    )
    for existing_refund in previous_refunds:
        if not existing_refund.items_json:
            continue
        for item in json.loads(existing_refund.items_json):
            variant_id = str(item["variant_id"])
            previous_quantities[variant_id] = (
                previous_quantities.get(variant_id, Decimal("0"))
                + Decimal(str(item["quantity"]))
            )

    # Older refunds referenced the sale directly in stock movement records.
    legacy_movements = (
        db.query(StockMovement.variant_id, StockMovement.quantity_delta)
        .filter(
            StockMovement.reference_type == "sale_refund",
            StockMovement.reference_id == sale.id,
            StockMovement.movement_type == "refund",
        )
        .all()
    )
    for variant_id, quantity in legacy_movements:
        previous_quantities[variant_id] = (
            previous_quantities.get(variant_id, Decimal("0")) + Decimal(str(quantity))
        )

    sold_quantities: dict[str, Decimal] = {}
    for item in sale_items:
        sold_quantities[item.variant_id] = (
            sold_quantities.get(item.variant_id, Decimal("0")) + Decimal(str(item.quantity))
        )
    remaining_quantities = {
        variant_id: max(
            Decimal("0"),
            quantity - previous_quantities.get(variant_id, Decimal("0")),
        )
        for variant_id, quantity in sold_quantities.items()
    }

    refund_items: dict[str, Decimal] = {}
    if payload.items:
        for item in payload.items:
            refund_items[item.variant_id] = (
                refund_items.get(item.variant_id, Decimal("0")) + _safe_decimal(item.quantity)
            )
    elif payload.amount is None:
        refund_items = {
            variant_id: quantity
            for variant_id, quantity in remaining_quantities.items()
            if quantity > 0
        }

    selected_total = Decimal("0")
    for variant_id, quantity in refund_items.items():
        if variant_id not in sold_quantities:
            raise HTTPException(status_code=404, detail=f"Variant {variant_id} was not sold in this sale.")
        if quantity > remaining_quantities[variant_id]:
            raise HTTPException(status_code=400, detail=f"Refund quantity for {variant_id} exceeds the unrefunded quantity sold.")

        quantity_to_refund = quantity
        quantity_previously_refunded = previous_quantities.get(variant_id, Decimal("0"))
        for original in (item for item in sale_items if item.variant_id == variant_id):
            previously_on_line = min(Decimal(str(original.quantity)), quantity_previously_refunded)
            quantity_previously_refunded -= previously_on_line
            available_on_line = Decimal(str(original.quantity)) - previously_on_line
            line_quantity = min(available_on_line, quantity_to_refund)
            selected_total += Decimal(str(original.unit_price)) * line_quantity
            quantity_to_refund -= line_quantity
            if quantity_to_refund <= 0:
                break

    selected_total = selected_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    refund_amount = _safe_decimal(payload.amount) if payload.amount is not None else selected_total
    if refund_amount <= 0:
        raise HTTPException(status_code=422, detail="Refund amount must be greater than zero.")
    if refund_amount != refund_amount.quantize(Decimal("0.01")):
        raise HTTPException(status_code=422, detail="Refund amount cannot contain fractions of a cent.")
    if refund_amount > max(Decimal("0"), sale.paid_amount - previous_refund_amount):
        raise HTTPException(status_code=400, detail="Refund amount cannot exceed the amount already paid on this sale.")
    if refund_items and abs(selected_total - refund_amount) > Decimal("0.01"):
        raise HTTPException(status_code=422, detail="Refund amount does not match the selected item totals.")
    refund_total = refund_amount

    refund = SaleRefund(
        sale_id=sale.id,
        amount=refund_total,
        reason=payload.reason,
        note=payload.note,
        idempotency_key=payload.idempotency_key,
        request_hash=request_hash if payload.idempotency_key else None,
        items_json=json.dumps(
            [{"variant_id": variant_id, "quantity": str(quantity)} for variant_id, quantity in refund_items.items()],
            separators=(",", ":"),
        ),
        created_by=current_user.id,
    )
    db.add(refund)
    db.flush()

    for variant_id, quantity in refund_items.items():
        variant = db.query(ProductVariant).filter(ProductVariant.id == variant_id, ProductVariant.business_id == membership.business_id).first()
        if not variant:
            raise HTTPException(status_code=404, detail=f"Variant {variant_id} no longer exists in this business.")
        if not variant.track_stock:
            continue
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
        added_quantity = quantity
        sale_item = next((line for line in sale_items if line.variant_id == variant.id), None)
        unit_cost = sale_item.unit_cost if sale_item and sale_item.unit_cost is not None else variant.purchase_price
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
                unit_cost=unit_cost,
                reference_type="sale_refund",
                reference_id=refund.id,
                note=payload.reason,
                created_by=current_user.id,
            )
        )
        product = db.query(Product).filter(Product.id == variant.product_id).first()
        category = db.query(Category).filter(Category.id == product.category_id).first() if product and product.category_id else None
        quantity_before = Decimal(str(inventory_balance.quantity)) - added_quantity
        record_product_event(
            db,
            business_id=membership.business_id,
            store_id=sale.store_id,
            product_id=variant.product_id,
            variant_id=variant.id,
            category_id=product.category_id if product else None,
            category_name=category.name if category else "",
            actor_id=current_user.id,
            event_type="stock_adjusted",
            before={"quantity": str(quantity_before)},
            after={"quantity": str(inventory_balance.quantity), "reason": "Sale refund"},
        )

    db.add(CashbookEntry(
        business_id=membership.business_id,
        store_id=sale.store_id,
        entry_type="sale_refund",
        direction="out",
        amount=refund_total,
        category="Sale refund",
        reference_type="sale_refund",
        reference_id=refund.id,
        note=payload.reason,
        created_by=current_user.id,
    ))
    cumulative_refunds = previous_refund_amount + refund_total
    sale.status = _normalize_sale_status(sale.total_amount, sale.paid_amount)
    if cumulative_refunds >= sale.total_amount:
        sale.status = "refunded"
    db.add(SalePayment(sale_id=sale.id, method="refund", amount=refund_total, status="confirmed", note=payload.reason))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if not payload.idempotency_key:
            raise
        existing_refund = (
            db.query(SaleRefund)
            .filter(
                SaleRefund.sale_id == sale.id,
                SaleRefund.idempotency_key == payload.idempotency_key,
            )
            .first()
        )
        if not existing_refund or existing_refund.request_hash != request_hash:
            raise
        sale = _sale_for_business(sale.id, membership, db)
        return RefundOut(
            sale_id=sale.id,
            refund_amount=existing_refund.amount,
            remaining_balance=sale.balance_due,
            status=sale.status,
            note=existing_refund.note,
        )
    db.refresh(sale)
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
