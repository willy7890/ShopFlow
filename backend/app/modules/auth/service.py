from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password, create_access_token, new_refresh_token, hash_token
from app.modules.auth.models import User, RefreshSession
from app.modules.businesses.models import Business, Store, Membership


def _issue_session(db: Session, user: User) -> dict:
    raw_refresh = new_refresh_token()
    session = RefreshSession(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_DAYS),
    )
    db.add(session)
    db.flush()
    return {
        "access_token": create_access_token(subject=user.id),
        "refresh_token": raw_refresh,
        "token_type": "bearer",
        "user": user,
    }


def register_user(db: Session, data) -> dict:
    email = data.email.lower()
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=409, detail="Email is already registered")
    if data.phone and db.query(User).filter(User.phone == data.phone).first():
        raise HTTPException(status_code=409, detail="Phone number is already registered")

    try:
        user = User(
            full_name=data.full_name.strip(),
            email=email,
            phone=data.phone,
            password_hash=hash_password(data.password),
            preferred_language=data.preferred_language,
            is_super_admin=False,
        )
        db.add(user)
        db.flush()

        business = Business(
            name=data.business_name.strip(),
            business_type=data.business_type,
            country_code=data.country_code,
            currency=data.currency,
        )
        db.add(business)
        db.flush()

        store = Store(business_id=business.id, name="Main Store", code="MAIN")
        db.add(store)
        db.flush()

        membership = Membership(
            business_id=business.id,
            user_id=user.id,
            role="owner",
            store_access=[store.id],
        )
        db.add(membership)
        result = _issue_session(db, user)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def authenticate_user(db: Session, email: str, password: str) -> dict:
    user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    result = _issue_session(db, user)
    db.commit()
    return result


def refresh_session(db: Session, raw_token: str) -> dict:
    session = db.query(RefreshSession).filter(RefreshSession.token_hash == hash_token(raw_token)).first()
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at is not None or session.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise HTTPException(status_code=401, detail="Refresh token is invalid or expired")
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User account is inactive")
    session.revoked_at = now
    result = _issue_session(db, user)
    db.commit()
    return result


def revoke_refresh_session(db: Session, raw_token: str) -> None:
    session = db.query(RefreshSession).filter(RefreshSession.token_hash == hash_token(raw_token)).first()
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
