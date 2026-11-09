from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import (
    get_business_membership,
    get_current_user,
    require_roles,
)
from app.modules.auth.models import User
from app.modules.businesses.models import Business, Membership, Store
from app.modules.businesses.schemas import (
    BusinessAccessOut,
    BusinessCreate,
    BusinessOut,
    StoreCreate,
    StoreOut,
)

router = APIRouter()


@router.get("/access", response_model=list[BusinessAccessOut])
def list_business_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memberships = (
        db.query(Membership, Business)
        .join(Business, Business.id == Membership.business_id)
        .filter(
            Membership.user_id == current_user.id,
            Membership.is_active.is_(True),
            Business.is_active.is_(True),
        )
        .order_by(Business.name)
        .all()
    )
    access = []
    for membership, business in memberships:
        stores_query = db.query(Store).filter(Store.business_id == business.id, Store.is_active.is_(True))
        if membership.role != "owner":
            stores_query = stores_query.filter(Store.id.in_(membership.store_access or []))
        stores = stores_query.order_by(Store.name).all()
        store_ids = [store.id for store in stores]
        access.append(
            BusinessAccessOut(
                business_id=business.id,
                business_name=business.name,
                currency=business.currency,
                role=membership.role,
                store_ids=store_ids,
                permissions=list(membership.permissions or []),
                stores=stores,
            )
        )
    return access


@router.get("", response_model=list[BusinessOut])
def list_businesses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Business)
        .join(Membership, Membership.business_id == Business.id)
        .filter(Membership.user_id == current_user.id, Membership.is_active.is_(True), Business.is_active.is_(True))
        .all()
    )


@router.post("", response_model=BusinessOut, status_code=201)
def create_business(
    payload: BusinessCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    business = Business(
        name=payload.name.strip(),
        business_type=payload.business_type,
        country_code=payload.country_code,
        currency=payload.currency,
        operating_mode=payload.operating_mode,
    )
    db.add(business)
    db.flush()
    store = Store(business_id=business.id, name="Main Store", code="MAIN")
    db.add(store)
    db.flush()
    db.add(Membership(business_id=business.id, user_id=current_user.id, role="owner", store_access=[store.id]))
    db.commit()
    db.refresh(business)
    return business


@router.get("/{business_id}/stores", response_model=list[StoreOut])
def list_stores(
    business_id: str,
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    if membership.business_id != business_id:
        raise HTTPException(status_code=403, detail="Business context does not match")
    query = db.query(Store).filter(Store.business_id == business_id, Store.is_active.is_(True))
    if membership.role != "owner":
        query = query.filter(Store.id.in_(membership.store_access or []))
    return query.all()


@router.post("/{business_id}/stores", response_model=StoreOut, status_code=201)
def create_store(
    business_id: str,
    payload: StoreCreate,
    membership: Membership = Depends(require_roles("owner", "business_manager")),
    db: Session = Depends(get_db),
):
    if membership.business_id != business_id:
        raise HTTPException(status_code=403, detail="Business context does not match")
    if db.query(Store).filter(Store.business_id == business_id, Store.code == payload.code.upper()).first():
        raise HTTPException(status_code=409, detail="Store code already exists in this business")
    store = Store(
        business_id=business_id,
        name=payload.name.strip(),
        code=payload.code.upper(),
        address=payload.address,
    )
    db.add(store)
    db.commit()
    db.refresh(store)
    return store
