from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Membership, Store
from app.modules.catalog.models import ProductVariant
from app.modules.inventory.models import Supplier, Purchase, PurchaseItem, InventoryBalance, StockMovement, SupplierPayment
from app.modules.inventory.schemas import *

router = APIRouter()

@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(payload: SupplierCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    obj = Supplier(business_id=membership.business_id, **payload.model_dump())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Supplier).filter(Supplier.business_id == membership.business_id).order_by(Supplier.name).all()

@router.post("/suppliers/{supplier_id}/payments", response_model=SupplierPaymentOut, status_code=201)
def create_supplier_payment(
    supplier_id: str,
    payload: SupplierPaymentCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "store_manager", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.business_id == membership.business_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found in this business")
    if payload.method.lower() in {"mobile_money", "mpesa", "m-pesa"}:
        raise HTTPException(
            status_code=409,
            detail="Mobile-money supplier payments are unavailable until the Vodacom Tanzania provider is integrated.",
        )
    if payload.purchase_id:
        purchase = db.query(Purchase).filter(Purchase.id == payload.purchase_id, Purchase.business_id == membership.business_id).first()
        if not purchase:
            raise HTTPException(status_code=404, detail="Purchase not found in this business")
    payment = SupplierPayment(
        business_id=membership.business_id,
        store_id=payload.purchase_id and db.query(Purchase).filter(Purchase.id == payload.purchase_id).first().store_id,
        supplier_id=supplier.id,
        purchase_id=payload.purchase_id,
        amount=Decimal(str(payload.amount)),
        method=payload.method,
        reference=payload.reference,
        note=payload.note,
        status="posted",
        created_by=current_user.id,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment

@router.get("/suppliers/{supplier_id}/statement", response_model=SupplierStatementOut)
def supplier_statement(
    supplier_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.business_id == membership.business_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found in this business")
    purchases_total = db.query(func.coalesce(func.sum(Purchase.total_amount), Decimal("0"))).filter(Purchase.business_id == membership.business_id, Purchase.supplier_id == supplier_id).scalar()
    payments_total = db.query(func.coalesce(func.sum(SupplierPayment.amount), Decimal("0"))).filter(SupplierPayment.business_id == membership.business_id, SupplierPayment.supplier_id == supplier_id, SupplierPayment.reversal_of_id.is_(None)).scalar()
    outstanding = Decimal(str(purchases_total or 0)) - Decimal(str(payments_total or 0))
    payments = db.query(SupplierPayment).filter(SupplierPayment.business_id == membership.business_id, SupplierPayment.supplier_id == supplier_id).order_by(SupplierPayment.created_at.desc()).all()
    return SupplierStatementOut(
        supplier=supplier,
        total_purchases=Decimal(str(purchases_total or 0)),
        total_payments=Decimal(str(payments_total or 0)),
        outstanding_balance=outstanding,
        payments=payments,
    )

@router.post("/suppliers/{supplier_id}/payments/{payment_id}/reverse", response_model=SupplierPaymentOut, status_code=201)
def reverse_supplier_payment(
    supplier_id: str,
    payment_id: str,
    membership: Membership = Depends(require_roles("owner", "business_manager", "accountant")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.business_id == membership.business_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found in this business")
    payment = db.query(SupplierPayment).filter(SupplierPayment.id == payment_id, SupplierPayment.business_id == membership.business_id, SupplierPayment.supplier_id == supplier_id).first()
    if not payment:
        raise HTTPException(status_code=404, detail="Supplier payment not found")
    if payment.reversal_of_id:
        raise HTTPException(status_code=409, detail="This payment has already been reversed")
    reversal = SupplierPayment(
        business_id=membership.business_id,
        store_id=payment.store_id,
        supplier_id=supplier.id,
        purchase_id=payment.purchase_id,
        amount=Decimal(str(payment.amount)),
        method=payment.method,
        reference=f"REV-{payment.id[:8]}",
        note="Reversed supplier payment record.",
        status="reversed",
        reversal_of_id=payment.id,
        created_by=current_user.id,
    )
    db.add(reversal)
    db.commit()
    db.refresh(reversal)
    return reversal

@router.post("/purchases", response_model=PurchaseOut, status_code=201)
def create_purchase(payload: PurchaseCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "store_manager", "inventory_manager")), db: Session = Depends(get_db)):
    # current_user is injected explicitly below via auth dependency replacement in route registration.
    store = db.query(Store).filter(Store.id == payload.store_id, Store.business_id == membership.business_id, Store.is_active.is_(True)).first()
    if not store: raise HTTPException(status_code=404, detail="Store not found in this business")
    if membership.role != "owner" and payload.store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="No access to this store")
    if payload.supplier_id and not db.query(Supplier).filter(Supplier.id == payload.supplier_id, Supplier.business_id == membership.business_id).first():
        raise HTTPException(status_code=404, detail="Supplier not found in this business")
    variants = {}
    total = Decimal("0")
    for line in payload.items:
        variant = db.query(ProductVariant).filter(ProductVariant.id == line.variant_id, ProductVariant.business_id == membership.business_id, ProductVariant.is_active.is_(True)).first()
        if not variant: raise HTTPException(status_code=404, detail=f"Variant {line.variant_id} not found in this business")
        variants[line.variant_id] = variant
        total += line.quantity * line.unit_cost
    try:
        purchase = Purchase(business_id=membership.business_id, store_id=payload.store_id, supplier_id=payload.supplier_id, reference_number=payload.reference_number, status="draft", total_amount=total, note=payload.note, created_by=membership.user_id)
        db.add(purchase); db.flush()
        for line in payload.items:
            db.add(PurchaseItem(purchase_id=purchase.id, variant_id=line.variant_id, quantity=line.quantity, unit_cost=line.unit_cost, conversion_factor=line.conversion_factor, line_total=line.quantity * line.unit_cost))
        db.commit(); db.refresh(purchase); return purchase
    except Exception:
        db.rollback(); raise

@router.post("/purchases/{purchase_id}/receive", response_model=PurchaseOut)
def receive_purchase(purchase_id: str, membership: Membership = Depends(require_roles("owner", "business_manager", "store_manager", "inventory_manager")), db: Session = Depends(get_db)):
    purchase = db.query(Purchase).filter(Purchase.id == purchase_id, Purchase.business_id == membership.business_id).with_for_update().first()
    if not purchase: raise HTTPException(status_code=404, detail="Purchase not found")
    if purchase.status != "draft": raise HTTPException(status_code=409, detail="Only draft purchases can be received")
    if membership.role != "owner" and purchase.store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="No access to this store")
    try:
        items = db.query(PurchaseItem).filter(PurchaseItem.purchase_id == purchase.id).all()
        for item in items:
            variant = db.query(ProductVariant).filter(ProductVariant.id == item.variant_id, ProductVariant.business_id == membership.business_id).first()
            if not variant: raise HTTPException(status_code=409, detail="Purchase contains an invalid product variant")
            added_qty = Decimal(str(item.quantity)) * Decimal(str(item.conversion_factor))
            balance = db.query(InventoryBalance).filter(
                InventoryBalance.business_id == membership.business_id,
                InventoryBalance.store_id == purchase.store_id,
                InventoryBalance.variant_id == item.variant_id,
            ).with_for_update().first()
            if not balance:
                balance = InventoryBalance(business_id=membership.business_id, store_id=purchase.store_id, variant_id=item.variant_id, quantity=0, average_cost=0)
                db.add(balance); db.flush()
            old_qty = Decimal(str(balance.quantity))
            old_cost = Decimal(str(balance.average_cost))
            new_qty = old_qty + added_qty
            if new_qty > 0:
                balance.average_cost = ((old_qty * old_cost) + (added_qty * Decimal(str(item.unit_cost)) / Decimal(str(item.conversion_factor)))) / new_qty
            balance.quantity = new_qty
            db.add(StockMovement(
                business_id=membership.business_id, store_id=purchase.store_id, variant_id=item.variant_id,
                movement_type="PURCHASE", quantity_delta=added_qty,
                unit_cost=Decimal(str(item.unit_cost)) / Decimal(str(item.conversion_factor)),
                reference_type="purchase", reference_id=purchase.id, note="Stock received from purchase",
                created_by=membership.user_id,
            ))
        purchase.status = "received"
        purchase.received_at = datetime.now(timezone.utc)
        db.commit(); db.refresh(purchase); return purchase
    except Exception:
        db.rollback(); raise

@router.get("/stock", response_model=list[BalanceOut])
def list_stock(store_id: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    store = db.query(Store).filter(Store.id == store_id, Store.business_id == membership.business_id).first()
    if not store: raise HTTPException(status_code=404, detail="Store not found")
    if membership.role != "owner" and store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="No access to this store")
    return db.query(InventoryBalance).filter(InventoryBalance.business_id == membership.business_id, InventoryBalance.store_id == store_id).all()

@router.get("/movements", response_model=list[StockMovementOut])
def list_movements(store_id: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    store = db.query(Store).filter(Store.id == store_id, Store.business_id == membership.business_id).first()
    if not store: raise HTTPException(status_code=404, detail="Store not found")
    if membership.role != "owner" and store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="No access to this store")
    return db.query(StockMovement).filter(StockMovement.business_id == membership.business_id, StockMovement.store_id == store_id).order_by(StockMovement.created_at.desc()).limit(500).all()
