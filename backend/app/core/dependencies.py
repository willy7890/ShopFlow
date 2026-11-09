from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
import jwt

from app.core.database import get_db
from app.core.security import decode_access_token
from app.modules.auth.models import User
from app.modules.businesses.models import Business, Membership, Store

bearer_scheme = HTTPBearer(auto_error=True)


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
    return user


def get_business_membership(
    business_id_header: str = Header(..., alias="X-Business-ID"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Membership:
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
    business = db.get(Business, business_id_header)
    if not business or not business.is_active:
        raise HTTPException(status_code=403, detail="This business is inactive.")
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
