from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.dependencies import get_business_membership, require_roles
from app.modules.businesses.models import Membership
from app.modules.catalog.models import Category, Brand, Unit, Product, ProductVariant
from app.modules.catalog.schemas import *

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
    if payload.category_id: _same_business(db, Category, payload.category_id, membership.business_id, "Category")
    if payload.brand_id: _same_business(db, Brand, payload.brand_id, membership.business_id, "Brand")
    obj = Product(business_id=membership.business_id, **payload.model_dump())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/products", response_model=list[ProductOut])
def list_products(membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    return db.query(Product).filter(Product.business_id == membership.business_id, Product.is_active.is_(True)).order_by(Product.name).all()

@router.post("/products/{product_id}/variants", response_model=VariantOut, status_code=201)
def create_variant(product_id: str, payload: VariantCreate, membership: Membership = Depends(require_roles("owner", "business_manager", "inventory_manager")), db: Session = Depends(get_db)):
    _same_business(db, Product, product_id, membership.business_id, "Product")
    _same_business(db, Unit, payload.unit_id, membership.business_id, "Unit")
    obj = ProductVariant(business_id=membership.business_id, product_id=product_id, **payload.model_dump())
    db.add(obj); db.commit(); db.refresh(obj); return obj

@router.get("/products/{product_id}/variants", response_model=list[VariantOut])
def list_variants(product_id: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    _same_business(db, Product, product_id, membership.business_id, "Product")
    return db.query(ProductVariant).filter(ProductVariant.business_id == membership.business_id, ProductVariant.product_id == product_id, ProductVariant.is_active.is_(True)).all()

@router.get("/barcodes/{barcode}", response_model=VariantOut)
def lookup_barcode(barcode: str, membership: Membership = Depends(get_business_membership), db: Session = Depends(get_db)):
    obj = db.query(ProductVariant).filter(ProductVariant.business_id == membership.business_id, ProductVariant.barcode == barcode, ProductVariant.is_active.is_(True)).first()
    if not obj: raise HTTPException(status_code=404, detail="Barcode is not registered in this business")
    return obj
