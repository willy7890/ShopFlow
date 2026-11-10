from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.dependencies import get_business_membership, require_roles
from app.modules.businesses.models import Membership
from app.modules.catalog.models import Category, Brand, Unit, Product, ProductVariant
from app.modules.catalog.schemas import *
from app.modules.audit.models import ProductAuditEvent
from app.modules.audit.service import record_product_event
import json

router = APIRouter()

def _same_business(db, model, item_id, business_id, label):
    obj = db.query(model).filter(model.id == item_id, model.business_id == business_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail=f"{label} not found in this business")
    return obj

@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "store_manager", "inventory_manager")), db: Session = Depends(get_db)):
    if payload.parent_id:
        _same_business(db, Category, payload.parent_id, membership.business_id, "Parent category")
    obj = Category(business_id=membership.business_id, **payload.model_dump())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/categories", response_model=list[CategoryOut])
def list_categories(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Category).filter(Category.business_id == membership.business_id, Category.is_active.is_(True)).order_by(Category.name).all()

@router.post("/brands", response_model=BrandOut, status_code=201)
def create_brand(payload: BrandCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    obj = Brand(business_id=membership.business_id, name=payload.name.strip())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/brands", response_model=list[BrandOut])
def list_brands(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Brand).filter(Brand.business_id == membership.business_id, Brand.is_active.is_(True)).order_by(Brand.name).all()

@router.post("/units", response_model=UnitOut, status_code=201)
def create_unit(payload: UnitCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    if payload.base_unit_id:
        _same_business(db, Unit, payload.base_unit_id, membership.business_id, "Base unit")
    obj = Unit(business_id=membership.business_id, **payload.model_dump())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/units", response_model=list[UnitOut])
def list_units(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Unit).filter(Unit.business_id == membership.business_id, Unit.is_active.is_(True)).order_by(Unit.name).all()

@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(payload: ProductCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    category = _same_business(db, Category, payload.category_id, membership.business_id, "Category") if payload.category_id else None
    if payload.brand_id: _same_business(db, Brand, payload.brand_id, membership.business_id, "Brand")
    obj = Product(business_id=membership.business_id, **payload.model_dump())
    db.add(obj)
    db.flush()
    record_product_event(
        db,
        business_id=membership.business_id,
        product_id=obj.id,
        actor_id=membership.user_id,
        event_type="created",
        category_id=obj.category_id,
        category_name=category.name if category else "",
        after=payload.model_dump(mode="json"),
    )
    db.commit(); db.refresh(obj); return obj

@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: str,
    payload: ProductCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")),
    db: Session = Depends(get_db),
):
    product = _same_business(db, Product, product_id, membership.business_id, "Product")
    category = _same_business(db, Category, payload.category_id, membership.business_id, "Category") if payload.category_id else None
    if payload.brand_id: _same_business(db, Brand, payload.brand_id, membership.business_id, "Brand")
    before = {
        "name": product.name,
        "category_id": product.category_id,
        "description": product.description,
        "brand_id": product.brand_id,
        "image_url": product.image_url,
    }
    for key, value in payload.model_dump().items():
        setattr(product, key, value)
    record_product_event(
        db,
        business_id=membership.business_id,
        product_id=product.id,
        actor_id=membership.user_id,
        event_type="updated",
        category_id=product.category_id,
        category_name=category.name if category else "",
        before=before,
        after=payload.model_dump(mode="json"),
    )
    db.commit(); db.refresh(product); return product

@router.get("/products", response_model=list[ProductOut])
def list_products(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Product).filter(Product.business_id == membership.business_id, Product.is_active.is_(True)).order_by(Product.name).all()

@router.post("/products/{product_id}/variants", response_model=VariantOut, status_code=201)
def create_variant(product_id: str, payload: VariantCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    product = _same_business(db, Product, product_id, membership.business_id, "Product")
    _same_business(db, Unit, payload.unit_id, membership.business_id, "Unit")
    obj = ProductVariant(business_id=membership.business_id, product_id=product_id, **payload.model_dump())
    db.add(obj)
    db.flush()
    category = db.query(Category).filter(Category.id == product.category_id).first() if product.category_id else None
    record_product_event(
        db,
        business_id=membership.business_id,
        product_id=product.id,
        variant_id=obj.id,
        actor_id=membership.user_id,
        event_type="created",
        category_id=product.category_id,
        category_name=category.name if category else "",
        after=payload.model_dump(mode="json"),
    )
    db.commit(); db.refresh(obj); return obj

@router.put("/products/{product_id}/variants/{variant_id}", response_model=VariantOut)
def update_variant(
    product_id: str,
    variant_id: str,
    payload: VariantCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")),
    db: Session = Depends(get_db),
):
    product = _same_business(db, Product, product_id, membership.business_id, "Product")
    variant = db.query(ProductVariant).filter(
        ProductVariant.id == variant_id,
        ProductVariant.product_id == product_id,
        ProductVariant.business_id == membership.business_id,
    ).first()
    if not variant: raise HTTPException(status_code=404, detail="Product variant not found in this business")
    _same_business(db, Unit, payload.unit_id, membership.business_id, "Unit")
    before = {
        key: getattr(variant, key)
        for key in ("name", "unit_id", "sku", "barcode", "purchase_price", "selling_price", "low_stock_threshold", "track_stock")
    }
    for key, value in payload.model_dump().items():
        setattr(variant, key, value)
    category = db.query(Category).filter(Category.id == product.category_id).first() if product.category_id else None
    record_product_event(
        db,
        business_id=membership.business_id,
        product_id=product.id,
        variant_id=variant.id,
        actor_id=membership.user_id,
        event_type="updated",
        category_id=product.category_id,
        category_name=category.name if category else "",
        before=before,
        after=payload.model_dump(mode="json"),
    )
    db.commit(); db.refresh(variant); return variant

@router.get("/history")
def product_history(
    store_id: str,
    category_id: str | None = None,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    from app.modules.businesses.models import Store

    store = db.query(Store).filter(
        Store.id == store_id,
        Store.business_id == membership.business_id,
        Store.is_active.is_(True),
    ).first()
    if not store:
        raise HTTPException(status_code=404, detail="Store not found in this business.")
    if membership.role != "owner" and store_id not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this store.")
    if membership.role != "owner" and not set(membership.permissions or []).intersection({"view_reports", "manage_products", "manage_inventory"}):
        raise HTTPException(status_code=403, detail="You do not have permission to view product history.")
    query = db.query(ProductAuditEvent).filter(
        ProductAuditEvent.business_id == membership.business_id,
        (ProductAuditEvent.store_id == store_id) | (ProductAuditEvent.store_id.is_(None)),
    )
    if category_id:
        query = query.filter(ProductAuditEvent.category_id == category_id)
    events = query.order_by(ProductAuditEvent.created_at.desc(), ProductAuditEvent.id.desc()).limit(200).all()
    return [{
        "id": event.id,
        "store_id": event.store_id,
        "product_id": event.product_id,
        "variant_id": event.variant_id,
        "category_id": event.category_id,
        "category_name": event.category_name,
        "event_type": event.event_type,
        "before": json.loads(event.before_json) if event.before_json else None,
        "after": json.loads(event.after_json),
        "actor_id": event.actor_id,
        "created_at": event.created_at,
    } for event in events]

@router.get("/products/{product_id}/variants", response_model=list[VariantOut])
def list_variants(product_id: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    _same_business(db, Product, product_id, membership.business_id, "Product")
    return db.query(ProductVariant).filter(ProductVariant.business_id == membership.business_id, ProductVariant.product_id == product_id, ProductVariant.is_active.is_(True)).all()

@router.get("/barcodes/{barcode}", response_model=VariantOut)
def lookup_barcode(barcode: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    obj = db.query(ProductVariant).filter(ProductVariant.business_id == membership.business_id, ProductVariant.barcode == barcode, ProductVariant.is_active.is_(True)).first()
    if not obj: raise HTTPException(status_code=404, detail="Barcode is not registered in this business")
    return obj
