from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership, Store
from app.modules.catalog.models import Product, ProductVariant
from app.modules.customers.models import Customer
from app.modules.orders.models import Invoice, Order, OrderItem
from app.modules.orders.schemas import OrderCreate, OrderItemCreate, OrderOut
from app.modules.sales.router import create_sale
from app.modules.sales.schemas import SaleCreate, SaleLineCreate

router = APIRouter()


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


def _order_for_business(order_id: str, membership: Membership, db: Session) -> Order:
    order = db.query(Order).filter(Order.id == order_id, Order.business_id == membership.business_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found.")
    if membership.role != "owner" and order.store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this order's store.")
    return order


def _generate_order_number(business_id: str, store_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"ORD-{business_id[:6].upper()}-{store_id[:6].upper()}-{stamp}"


def _build_pdf(order: Order, invoice: Invoice) -> bytes:
    lines = [
        "ORDER INVOICE",
        f"Invoice #: {invoice.invoice_number}",
        f"Order #: {order.order_number}",
        f"Customer: {order.customer_name or 'Walk-in'}",
        f"Store: {order.store_id}",
        "",
        "Items:",
    ]
    for item in order.items:
        lines.append(f"- {item.product_name} x {item.quantity} @ {item.unit_price} = {item.line_total}")
    lines.extend([
        "",
        f"Subtotal: {order.subtotal}",
        f"Discount: {order.discount}",
        f"Total: {invoice.total_amount}",
        f"Status: {order.status}",
    ])

    content_parts = []
    y = 760
    for index, text in enumerate(lines):
        content_parts.append(f"BT /F1 12 Tf 50 {y} Td ({_escape_pdf_text(text)}) Tj ET")
        y -= 20

    content_stream = "\n".join(content_parts).encode("latin-1", "replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content_stream)} >>\nstream\n{content_stream.decode('latin-1')}\nendstream".encode("latin-1"),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode("latin-1"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("latin-1"))
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))
    return bytes(pdf)


def _escape_pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


@router.post("", response_model=OrderOut, status_code=201)
def create_order(
    payload: OrderCreate,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant", "inventory_manager")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_store_access(membership, payload.store_id, db)
    if not payload.items:
        raise HTTPException(status_code=422, detail="An order must include at least one item.")

    customer: Customer | None = None
    if payload.customer_id:
        customer = (
            db.query(Customer)
            .filter(Customer.id == payload.customer_id, Customer.business_id == membership.business_id, Customer.is_active.is_(True))
            .first()
        )
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found in this business.")

    subtotal = Decimal("0")
    order_items: list[OrderItem] = []
    for raw_item in payload.items:
        variant = (
            db.query(ProductVariant)
            .filter(
                ProductVariant.id == raw_item.variant_id,
                ProductVariant.business_id == membership.business_id,
                ProductVariant.is_active.is_(True),
            )
            .first()
        )
        if not variant:
            raise HTTPException(status_code=404, detail=f"Variant {raw_item.variant_id} not found in this business.")
        product = (
            db.query(Product)
            .filter(Product.id == variant.product_id, Product.business_id == membership.business_id, Product.is_active.is_(True))
            .first()
        )
        if not product:
            raise HTTPException(status_code=404, detail="The product linked to this variant is no longer active.")

        unit_price = _safe_decimal(raw_item.unit_price) if raw_item.unit_price is not None else variant.selling_price
        if unit_price < Decimal("0"):
            raise HTTPException(status_code=422, detail="Item price cannot be negative.")
        quantity = _safe_decimal(raw_item.quantity)
        line_total = unit_price * quantity
        subtotal += line_total
        order_items.append(
            OrderItem(
                variant_id=variant.id,
                product_name=product.name,
                variant_name=variant.name,
                sku=variant.sku,
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
            )
        )

    order = Order(
        business_id=membership.business_id,
        store_id=payload.store_id,
        customer_id=customer.id if customer else payload.customer_id,
        order_number=_generate_order_number(membership.business_id, payload.store_id),
        customer_name=(payload.customer_name.strip() if payload.customer_name else customer.name if customer else None),
        customer_phone=(payload.customer_phone.strip() if payload.customer_phone else customer.phone if customer else None),
        status="draft",
        subtotal=subtotal,
        discount=Decimal("0"),
        total_amount=subtotal,
        paid_amount=Decimal("0"),
        balance_due=subtotal,
        note=payload.note,
        created_by=current_user.id,
    )
    db.add(order)
    db.flush()
    for item in order_items:
        item.order_id = order.id
        db.add(item)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.get("", response_model=list[OrderOut])
def list_orders(
    store_id: str | None = Query(default=None),
    status: Literal["draft", "confirmed", "preparing", "ready", "fulfilled", "converted", "cancelled"] | None = Query(default=None),
    search: str | None = Query(default=None, min_length=1, max_length=120),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    query = db.query(Order).filter(Order.business_id == membership.business_id)
    if store_id:
        _ensure_store_access(membership, store_id, db)
        query = query.filter(Order.store_id == store_id)
    elif membership.role != "owner":
        query = query.filter(Order.store_id.in_(membership.store_access or []))
    if status:
        query = query.filter(Order.status == status)
    if search:
        term = f"%{search.strip()}%"
        query = query.filter(or_(Order.order_number.ilike(term), Order.customer_name.ilike(term), Order.customer_phone.ilike(term)))
    orders = query.order_by(Order.created_at.desc()).offset(offset).limit(limit).all()
    for order in orders:
        order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return orders


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.post("/{order_id}/confirm", response_model=OrderOut)
def confirm_order(
    order_id: str,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant", "inventory_manager")),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    if order.status != "draft":
        raise HTTPException(status_code=409, detail="Only drafts can be confirmed.")
    order.status = "confirmed"
    order.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.post("/{order_id}/prepare", response_model=OrderOut)
def prepare_order(
    order_id: str,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "inventory_manager")),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    if order.status not in {"confirmed", "draft"}:
        raise HTTPException(status_code=409, detail="Only confirmed or draft orders can be prepared.")
    order.status = "preparing"
    order.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.post("/{order_id}/complete", response_model=OrderOut)
def complete_order(
    order_id: str,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager")),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    if order.status not in {"confirmed", "preparing", "ready"}:
        raise HTTPException(status_code=409, detail="This order is not ready to be completed.")
    order.status = "fulfilled"
    order.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: str,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier")),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    if order.status == "converted":
        raise HTTPException(status_code=409, detail="A converted order cannot be cancelled.")
    order.status = "cancelled"
    order.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.post("/{order_id}/convert-to-sale", response_model=OrderOut)
def convert_order_to_sale(
    order_id: str,
    membership: Membership = Depends(require_roles("owner", "manager", "store_manager", "cashier", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = _order_for_business(order_id, membership, db)
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled order cannot be converted into a sale.")
    if order.converted_sale_id:
        raise HTTPException(status_code=409, detail="This order has already been converted into a sale.")

    sale_payload = SaleCreate(
        store_id=order.store_id,
        customer_id=order.customer_id,
        customer_name=order.customer_name,
        customer_phone=order.customer_phone,
        note=order.note,
        items=[
            SaleLineCreate(variant_id=item.variant_id, quantity=item.quantity, unit_price=item.unit_price)
            for item in order.items
        ],
    )
    sale = create_sale(
        payload=sale_payload,
        membership=membership,
        db=db,
        current_user=current_user,
    )
    order.converted_sale_id = sale.id
    order.status = "converted"
    order.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(order)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()
    return order


@router.get("/{order_id}/invoice")
def get_order_invoice(
    order_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    order = _order_for_business(order_id, membership, db)
    order.items = db.query(OrderItem).filter(OrderItem.order_id == order.id).order_by(OrderItem.product_name).all()

    invoice = db.query(Invoice).filter(Invoice.business_id == membership.business_id, Invoice.order_id == order.id).first()
    if not invoice:
        invoice = Invoice(
            business_id=membership.business_id,
            order_id=order.id,
            invoice_number=f"INV-{order.order_number}",
            total_amount=order.total_amount,
            status="issued",
        )
        db.add(invoice)
        db.commit(); db.refresh(invoice)

    pdf_bytes = _build_pdf(order, invoice)
    response = Response(content=pdf_bytes, media_type="application/pdf")
    response.headers["Content-Disposition"] = f"attachment; filename={invoice.invoice_number}.pdf"
    return response
