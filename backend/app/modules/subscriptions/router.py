import hmac
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_business_membership, get_current_user, require_roles
from app.modules.auth.models import User
from app.modules.businesses.models import Business, Membership, Store
from app.modules.subscriptions.models import BusinessSubscription, SubscriptionAuditLog, SubscriptionPlan
from app.modules.subscriptions.schemas import (
    AdminBusinessOut,
    AdminSubscriptionGrant,
    BusinessStatusUpdate,
    BusinessSubscriptionOut,
    EntitlementsOut,
    PlatformAnalyticsOut,
    PlatformStoreOut,
    PlatformUserOut,
    StoreCreate,
    StoreStatusUpdate,
    SubscriptionAuditOut,
    SubscriptionPlanCreate,
    SubscriptionPlanOut,
    SubscriptionPlanUpdate,
    SubscriptionRequest,
    UserStatusUpdate,
)

router = APIRouter()


def _require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="Super admin access is required.")
    return current_user


def _audit(
    db: Session,
    actor: User,
    event_type: str,
    *,
    business_id: str | None = None,
    details: dict | None = None,
) -> None:
    db.add(
        SubscriptionAuditLog(
            business_id=business_id,
            user_id=actor.id,
            event_type=event_type,
            details=details or {},
        )
    )


def _latest_subscription(db: Session, business_id: str) -> BusinessSubscription | None:
    return (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == business_id)
        .order_by(BusinessSubscription.created_at.desc(), BusinessSubscription.id.desc())
        .first()
    )


def _effective_subscription(db: Session, business_id: str) -> BusinessSubscription | None:
    now = datetime.now(timezone.utc)
    candidates = (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == business_id, BusinessSubscription.status == "active")
        .order_by(BusinessSubscription.created_at.desc())
        .all()
    )
    for subscription in candidates:
        expiry = subscription.expires_at
        if expiry is None:
            return subscription
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry > now:
            return subscription
    return None


def _subscription_is_current(subscription: BusinessSubscription | None) -> bool:
    if not subscription or subscription.status != "active":
        return False
    if subscription.expires_at is None:
        return True
    expires_at = subscription.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc)


@router.post("/admin/bootstrap", status_code=200)
def bootstrap_super_admin(
    bootstrap_secret: str = Header(..., alias="X-Super-Admin-Bootstrap-Secret"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    configured_secret = settings.SUPER_ADMIN_BOOTSTRAP_SECRET
    configured_email = settings.SUPER_ADMIN_EMAIL.strip().lower()
    if not configured_secret or not configured_email:
        raise HTTPException(status_code=503, detail="Super admin bootstrap is not configured.")
    if not hmac.compare_digest(bootstrap_secret, configured_secret):
        raise HTTPException(status_code=403, detail="Invalid bootstrap credentials.")
    if current_user.email.lower() != configured_email:
        raise HTTPException(status_code=403, detail="This account is not the configured super admin.")
    other_admin = (
        db.query(User)
        .filter(User.is_super_admin.is_(True), User.id != current_user.id)
        .first()
    )
    if other_admin:
        raise HTTPException(status_code=409, detail="A super admin is already configured.")
    if current_user.is_super_admin:
        return {"is_super_admin": True}
    current_user.is_super_admin = True
    _audit(db, current_user, "super_admin_bootstrapped", details={"email": current_user.email})
    db.commit()
    return {"is_super_admin": True}


@router.get("/plans", response_model=list[SubscriptionPlanOut])
def list_plans(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    query = db.query(SubscriptionPlan)
    if active_only:
        query = query.filter(SubscriptionPlan.is_active.is_(True))
    return query.order_by(SubscriptionPlan.price, SubscriptionPlan.name).all()


@router.post("/admin/plans", response_model=SubscriptionPlanOut, status_code=201)
def create_plan(
    payload: SubscriptionPlanCreate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if db.query(SubscriptionPlan).filter(SubscriptionPlan.slug == payload.slug).first():
        raise HTTPException(status_code=409, detail="A plan with this slug already exists.")
    plan = SubscriptionPlan(**payload.model_dump())
    db.add(plan)
    _audit(db, admin, "subscription_plan_created", details={"slug": plan.slug, "name": plan.name})
    db.commit()
    db.refresh(plan)
    return plan


@router.patch("/admin/plans/{plan_id}", response_model=SubscriptionPlanOut)
def update_plan(
    plan_id: str,
    payload: SubscriptionPlanUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    plan = db.get(SubscriptionPlan, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Subscription plan not found.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    _audit(db, admin, "subscription_plan_updated", details={"plan_id": plan.id})
    db.commit()
    db.refresh(plan)
    return plan


@router.post("/request", response_model=BusinessSubscriptionOut, status_code=201)
def request_subscription(
    payload: SubscriptionRequest,
    membership: Membership = Depends(require_roles("owner", "business_manager")),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = (
        db.query(SubscriptionPlan)
        .filter(SubscriptionPlan.id == payload.plan_id, SubscriptionPlan.is_active.is_(True))
        .first()
    )
    if not plan:
        raise HTTPException(status_code=404, detail="Active subscription plan not found.")
    business = db.get(Business, membership.business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    if plan.currency != business.currency:
        raise HTTPException(status_code=422, detail="Plan currency must match the business currency.")
    current = _latest_subscription(db, membership.business_id)
    if current and current.status == "pending" and current.plan_id == plan.id:
        raise HTTPException(status_code=409, detail="A request for this plan is already pending.")

    now = datetime.now(timezone.utc)
    is_free_plan = plan.price == Decimal("0.00")
    subscription = BusinessSubscription(
        business_id=membership.business_id,
        plan_id=plan.id,
        status="active" if is_free_plan else "pending",
        started_at=now,
        expires_at=now + timedelta(days=plan.duration_days) if is_free_plan else None,
        renewal_price=plan.price,
        currency=plan.currency,
    )
    if is_free_plan:
        (
            db.query(BusinessSubscription)
            .filter(
                BusinessSubscription.business_id == membership.business_id,
                BusinessSubscription.status == "active",
            )
            .update({"status": "superseded"}, synchronize_session=False)
        )
    db.add(subscription)
    db.flush()
    _audit(
        db,
        current_user,
        "subscription_requested",
        business_id=membership.business_id,
        details={"subscription_id": subscription.id, "plan_id": plan.id, "status": subscription.status},
    )
    db.commit()
    db.refresh(subscription)
    return subscription


@router.get("/current", response_model=BusinessSubscriptionOut | None)
def get_current_subscription(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return _effective_subscription(db, membership.business_id) or _latest_subscription(db, membership.business_id)


@router.get("/history", response_model=list[BusinessSubscriptionOut])
def get_subscription_history(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    return (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == membership.business_id)
        .order_by(BusinessSubscription.created_at.desc())
        .all()
    )


@router.get("/entitlements", response_model=EntitlementsOut)
def get_entitlements(
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
):
    subscription = _effective_subscription(db, membership.business_id)
    plan = db.get(SubscriptionPlan, subscription.plan_id) if subscription and subscription.plan_id else None
    features: dict[str, bool | int | str] = {}
    if _subscription_is_current(subscription) and plan:
        features.update(plan.features or {})
        features.update(subscription.feature_overrides or {})
    return EntitlementsOut(subscription=subscription, plan=plan, features=features)


@router.get("/admin/businesses", response_model=list[AdminBusinessOut])
def list_platform_businesses(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    businesses = db.query(Business).order_by(Business.created_at.desc()).offset(offset).limit(limit).all()
    return [
        AdminBusinessOut(
            id=business.id,
            name=business.name,
            business_type=business.business_type,
            currency=business.currency,
            is_active=business.is_active,
            subscription=_latest_subscription(db, business.id),
        )
        for business in businesses
    ]


@router.patch("/admin/businesses/{business_id}/status", response_model=AdminBusinessOut)
def update_business_status(
    business_id: str,
    payload: BusinessStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    business.is_active = payload.is_active
    _audit(
        db,
        admin,
        "business_status_changed",
        business_id=business.id,
        details={"is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    return AdminBusinessOut(
        id=business.id,
        name=business.name,
        business_type=business.business_type,
        currency=business.currency,
        is_active=business.is_active,
        subscription=_latest_subscription(db, business.id),
    )


@router.get("/admin/users", response_model=list[PlatformUserOut])
def list_platform_users(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    return db.query(User).order_by(User.created_at.desc()).offset(offset).limit(limit).all()


@router.patch("/admin/users/{user_id}/status", response_model=PlatformUserOut)
def update_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="You cannot deactivate your own account.")
    if user.is_super_admin and not payload.is_active:
        remaining_admins = (
            db.query(func.count(User.id))
            .filter(User.is_super_admin.is_(True), User.is_active.is_(True), User.id != user.id)
            .scalar()
        )
        if not remaining_admins:
            raise HTTPException(status_code=409, detail="The last active super admin cannot be deactivated.")
    user.is_active = payload.is_active
    _audit(
        db,
        admin,
        "user_status_changed",
        details={"user_id": user.id, "is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    db.refresh(user)
    return user


@router.get("/admin/businesses/{business_id}/stores", response_model=list[PlatformStoreOut])
def list_platform_stores(
    business_id: str,
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    if not db.get(Business, business_id):
        raise HTTPException(status_code=404, detail="Business not found.")
    return db.query(Store).filter(Store.business_id == business_id).order_by(Store.created_at).all()


@router.post("/admin/businesses/{business_id}/stores", response_model=PlatformStoreOut, status_code=201)
def create_platform_store(
    business_id: str,
    payload: StoreCreate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found.")
    code = payload.code.upper()
    if db.query(Store).filter(Store.business_id == business_id, Store.code == code).first():
        raise HTTPException(status_code=409, detail="Store code already exists in this business.")
    store = Store(business_id=business_id, name=payload.name.strip(), code=code, address=payload.address)
    db.add(store)
    db.flush()
    _audit(db, admin, "platform_store_created", business_id=business_id, details={"store_id": store.id})
    db.commit()
    db.refresh(store)
    return store


@router.patch("/admin/stores/{store_id}/status", response_model=PlatformStoreOut)
def update_platform_store_status(
    store_id: str,
    payload: StoreStatusUpdate,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    store = db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    store.is_active = payload.is_active
    _audit(
        db,
        admin,
        "platform_store_status_changed",
        business_id=store.business_id,
        details={"store_id": store.id, "is_active": payload.is_active, "reason": payload.reason},
    )
    db.commit()
    db.refresh(store)
    return store


@router.post("/admin/businesses/{business_id}/grant", response_model=BusinessSubscriptionOut, status_code=201)
def grant_subscription(
    business_id: str,
    payload: AdminSubscriptionGrant,
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business = db.get(Business, business_id)
    plan = db.get(SubscriptionPlan, payload.plan_id)
    if not business or not plan:
        raise HTTPException(status_code=404, detail="Business or plan not found.")
    if not plan.is_active:
        raise HTTPException(status_code=409, detail="Inactive plans cannot be granted.")
    if plan.currency != business.currency:
        raise HTTPException(status_code=422, detail="Plan currency must match the business currency.")
    now = datetime.now(timezone.utc)
    active_subscriptions = (
        db.query(BusinessSubscription)
        .filter(BusinessSubscription.business_id == business_id, BusinessSubscription.status == "active")
        .all()
    )
    for previous in active_subscriptions:
        previous.status = "superseded"
    duration = payload.duration_days or plan.duration_days
    subscription = BusinessSubscription(
        business_id=business_id,
        plan_id=plan.id,
        status="active",
        started_at=now,
        expires_at=now + timedelta(days=duration),
        renewal_price=plan.price,
        currency=plan.currency,
    )
    db.add(subscription)
    db.flush()
    _audit(
        db,
        admin,
        "subscription_administratively_granted",
        business_id=business_id,
        details={
            "subscription_id": subscription.id,
            "plan_id": plan.id,
            "duration_days": duration,
            "reason": payload.reason,
        },
    )
    db.commit()
    db.refresh(subscription)
    return subscription


@router.get("/admin/audit-logs", response_model=list[SubscriptionAuditOut])
def list_platform_audit_logs(
    business_id: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=250),
    _admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    query = db.query(SubscriptionAuditLog)
    if business_id:
        query = query.filter(SubscriptionAuditLog.business_id == business_id)
    return query.order_by(SubscriptionAuditLog.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/admin/analytics", response_model=PlatformAnalyticsOut)
def platform_analytics(
    admin: User = Depends(_require_super_admin),
    db: Session = Depends(get_db),
):
    business_count, active_business_count = db.query(
        func.count(Business.id),
        func.sum(case((Business.is_active.is_(True), 1), else_=0)),
    ).one()
    active_subscriptions = (
        db.query(func.count(BusinessSubscription.id))
        .filter(BusinessSubscription.status == "active")
        .scalar()
        or 0
    )
    pending_subscriptions = (
        db.query(func.count(BusinessSubscription.id))
        .filter(BusinessSubscription.status == "pending")
        .scalar()
        or 0
    )
    return PlatformAnalyticsOut(
        business_count=business_count or 0,
        active_business_count=active_business_count or 0,
        user_count=db.query(func.count(User.id)).scalar() or 0,
        active_subscription_count=active_subscriptions,
        pending_subscription_count=pending_subscriptions,
        confirmed_subscription_revenue=None,
        currency=None,
    )
