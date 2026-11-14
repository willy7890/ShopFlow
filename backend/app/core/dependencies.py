from fastapi import Depends, Header, HTTPException, Request, status
from datetime import datetime, timezone
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
import jwt

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.modules.auth.models import User
from app.modules.businesses.models import Business, Membership, Store
from app.core.entitlements import enforce_business_entitlement

bearer_scheme = HTTPBearer(auto_error=True)

PLATFORM_PERMISSIONS = [
    "manage_business", "manage_stores", "manage_employees", "manage_products",
    "manage_inventory", "manage_sales", "manage_orders", "view_reports",
    "view_dashboard", "manage_finance", "manage_customers", "manage_suppliers",
    "manage_settings",
]


def is_trusted_super_admin(user: User) -> bool:
    configured_email = settings.SUPER_ADMIN_EMAIL.strip().casefold()
    return bool(
        configured_email
        and user.is_active
        and user.is_email_verified
        and user.is_super_admin
        and user.email.strip().casefold() == configured_email
    )


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme), db: Session = Depends(get_db)) -> User:
    token = credentials.credentials
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise credentials_error
    user = db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise credentials_error
    if not user.is_email_verified:
        raise HTTPException(status_code=403, detail="Email address is not verified. Check your inbox or request a new link.")
    password_changed_at = user.password_changed_at
    issued_at = payload.get("iat")
    if password_changed_at and issued_at is not None:
        changed_at = password_changed_at if password_changed_at.tzinfo else password_changed_at.replace(tzinfo=timezone.utc)
        if datetime.fromtimestamp(float(issued_at), timezone.utc) <= changed_at:
            raise credentials_error
    return user


def get_business_membership(
    request: Request,
    business_id_header: str = Header(..., alias="X-Business-ID"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Membership:
    business = db.get(Business, business_id_header)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if is_trusted_super_admin(current_user):
        stores = (
            db.query(Store.id)
            .filter(Store.business_id == business.id, Store.is_active.is_(True))
            .all()
        )
        # This is an in-memory authorization scope, never persisted as a
        # business membership. All data queries still filter by the selected
        # business ID, so ordinary tenant isolation remains unchanged.
        return Membership(
            business_id=business.id,
            user_id=current_user.id,
            role="owner",
            store_access=[store_id for (store_id,) in stores],
            permissions=PLATFORM_PERMISSIONS.copy(),
            is_active=True,
        )

    if not business.is_active:
        raise HTTPException(status_code=403, detail="This business is inactive.")
    membership = (
        db.query(Membership)
        .filter(
            Membership.business_id == business_id_header,
            Membership.user_id == current_user.id,
            Membership.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You do not have access to this business")
    enforce_business_entitlement(request, membership, current_user, db)
    return membership


def require_roles(*allowed_roles: str):
    def dependency(membership: Membership = Depends(get_business_membership)) -> Membership:
        if membership.role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Insufficient business permissions")
        return membership
    return dependency


def get_accessible_store(
    store_id_header: str = Header(..., alias="X-Store-ID"),
    membership: Membership = Depends(get_business_membership),
    db: Session = Depends(get_db),
) -> Store:
    store = (
        db.query(Store)
        .filter(Store.id == store_id_header, Store.business_id == membership.business_id, Store.is_active.is_(True))
        .first()
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found")
    if membership.role != "owner" and store_id_header not in (membership.store_access or []):
        raise HTTPException(status_code=403, detail="You do not have access to this store")
    return store
