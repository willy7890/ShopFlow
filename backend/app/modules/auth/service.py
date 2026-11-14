from datetime import datetime, timedelta, timezone
import logging
import secrets

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password, verify_password, create_access_token, new_refresh_token, hash_token
from app.modules.auth.email import EmailDeliveryNotConfigured, send_password_reset_email, send_verification_email
from app.modules.auth.models import EmailVerificationToken, PasswordResetToken, User, RefreshSession
from app.modules.businesses.models import Business, Store, Membership

logger = logging.getLogger(__name__)


def _normalize_email(email: str) -> str:
    return email.strip().casefold()


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
    email = _normalize_email(data.email)
    if db.query(User).filter(func.lower(func.trim(User.email)) == email).first():
        raise HTTPException(status_code=409, detail="Email is already registered")
    if data.phone and db.query(User).filter(User.phone == data.phone).first():
        raise HTTPException(status_code=409, detail="Phone number is already registered")

    try:
        user = User(
            full_name=data.full_name.strip(),
            # Preserve the address the customer entered for delivery. Lookup
            # and uniqueness checks use the normalized form above.
            email=data.email.strip(),
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
        db.commit()
        db.refresh(user)
    except IntegrityError as error:
        db.rollback()
        if db.query(User).filter(func.lower(func.trim(User.email)) == email).first():
            raise HTTPException(status_code=409, detail="Email is already registered") from error
        if data.phone and db.query(User).filter(User.phone == data.phone).first():
            raise HTTPException(status_code=409, detail="Phone number is already registered") from error
        raise
    except Exception:
        db.rollback()
        raise

    email_sent, _ = issue_email_verification(db, user)
    return {
        "full_name": user.full_name,
        "email": user.email,
        "verification_required": True,
        "email_sent": email_sent,
        "delivery_configured": settings.email_delivery_configured,
        "message": (
            "Verification email sent. Verify your email before signing in."
            if email_sent else
            "Your account is pending verification. Email delivery failed; request another verification email after the issue is resolved."
            if settings.email_delivery_configured else
            "Your account is pending verification. Email delivery is not configured; contact the administrator."
        ),
    }


def authenticate_user(db: Session, email: str, password: str) -> dict:
    normalized_email = _normalize_email(email)
    user = db.query(User).filter(func.lower(func.trim(User.email)) == normalized_email).first()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_email_verified:
        raise HTTPException(
            status_code=403,
            detail="Email address is not verified. Check your inbox or request a new link.",
        )
    result = _issue_session(db, user)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return result


def issue_email_verification(db: Session, user: User) -> tuple[bool, bool]:
    """Issue and deliver a one-use token. Returns (sent, rate_limited)."""
    if user.is_email_verified or not settings.email_delivery_configured:
        return False, False

    now = datetime.now(timezone.utc)
    db.query(User).filter(User.id == user.id).with_for_update().first()
    hour_ago = now - timedelta(hours=1)
    recent = (
        db.query(EmailVerificationToken)
        .filter(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.created_at >= hour_ago,
        )
        .order_by(EmailVerificationToken.created_at.desc())
        .all()
    )
    cooldown = timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS)
    latest_created = recent[0].created_at if recent else None
    if latest_created and latest_created.tzinfo is None:
        latest_created = latest_created.replace(tzinfo=timezone.utc)
    if len(recent) >= settings.EMAIL_VERIFICATION_MAX_PER_HOUR or (
        latest_created and now - latest_created < cooldown
    ):
        return False, True

    pending_tokens = db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.consumed_at.is_(None),
        EmailVerificationToken.revoked_at.is_(None),
    ).all()
    for old_token in pending_tokens:
        old_token.revoked_at = now

    raw_token = secrets.token_urlsafe(32)
    token = EmailVerificationToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=now + timedelta(minutes=settings.EMAIL_VERIFICATION_TOKEN_MINUTES),
        created_at=now,
    )
    db.add(token)
    db.commit()

    try:
        send_verification_email(user.email, raw_token)
    except EmailDeliveryNotConfigured:
        token.revoked_at = now
        db.commit()
        return False, False
    except Exception as error:
        token.revoked_at = now
        db.commit()
        logger.warning(
            "ShopFlow verification email delivery failed (type=%s smtp_code=%s)",
            type(error).__name__, getattr(error, "smtp_code", None),
        )
        return False, False
    logger.info("ShopFlow verification email accepted by SMTP for user_id=%s", user.id)
    return True, False


def resend_email_verification(db: Session, email: str) -> dict:
    normalized_email = _normalize_email(email)
    user = db.query(User).filter(func.lower(func.trim(User.email)) == normalized_email).first()
    if user and user.is_active and not user.is_email_verified:
        # Apply the limit, but keep the response shape and status independent of
        # account existence, verification state, and delivery outcome.
        issue_email_verification(db, user)
    return {
        "message": "If this account needs verification and email delivery is available, a message will be sent.",
        "delivery_configured": settings.email_delivery_configured,
        "delivery_sent": None,
    }


def request_password_reset(db: Session, email: str) -> None:
    if not settings.password_reset_delivery_configured:
        raise HTTPException(status_code=503, detail="Password reset email delivery is not configured.")
    normalized_email = _normalize_email(email)
    user = db.query(User).filter(func.lower(func.trim(User.email)) == normalized_email).first()
    if not user or not user.is_active or not user.is_email_verified:
        return

    now = datetime.now(timezone.utc)
    db.query(User).filter(User.id == user.id).with_for_update().first()
    recent = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at >= now - timedelta(hours=1),
        )
        .order_by(PasswordResetToken.created_at.desc())
        .all()
    )
    latest = recent[0].created_at if recent else None
    if latest and latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)
    if len(recent) >= settings.PASSWORD_RESET_MAX_PER_HOUR or (
        latest and now - latest < timedelta(seconds=settings.PASSWORD_RESET_RESEND_COOLDOWN_SECONDS)
    ):
        return

    for old in db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.consumed_at.is_(None),
        PasswordResetToken.revoked_at.is_(None),
    ).all():
        old.revoked_at = now
    raw_token = secrets.token_urlsafe(32)
    token = PasswordResetToken(
        user_id=user.id,
        token_hash=hash_token(raw_token),
        expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_MINUTES),
        created_at=now,
    )
    db.add(token)
    db.commit()
    try:
        send_password_reset_email(user.email, raw_token)
    except Exception as error:
        token.revoked_at = datetime.now(timezone.utc)
        db.commit()
        code = getattr(error, "smtp_code", None)
        logger.warning(
            "ShopFlow password reset delivery failed (type=%s smtp_code=%s)",
            type(error).__name__, code,
        )
        # Do not reveal whether the account exists or expose provider response details.
        return
    logger.info("ShopFlow password reset email accepted by SMTP for user_id=%s", user.id)


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    token = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == hash_token(raw_token)
    ).with_for_update().first()
    now = datetime.now(timezone.utc)
    if not token or token.consumed_at is not None or token.revoked_at is not None:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has already been used.")
    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        token.revoked_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This password reset link has expired. Request another.")
    user = db.get(User, token.user_id)
    if not user or not user.is_active or not user.is_email_verified:
        token.revoked_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This password reset link is no longer valid.")
    user.password_hash = hash_password(new_password)
    user.password_changed_at = now
    token.consumed_at = now
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.id != token.id,
        PasswordResetToken.consumed_at.is_(None),
        PasswordResetToken.revoked_at.is_(None),
    ).update({PasswordResetToken.revoked_at: now}, synchronize_session=False)
    db.query(RefreshSession).filter(
        RefreshSession.user_id == user.id,
        RefreshSession.revoked_at.is_(None),
    ).update({RefreshSession.revoked_at: now}, synchronize_session=False)
    db.commit()


def verify_email_token(db: Session, raw_token: str) -> None:
    token = db.query(EmailVerificationToken).filter(
        EmailVerificationToken.token_hash == hash_token(raw_token)
    ).with_for_update().first()
    now = datetime.now(timezone.utc)
    if not token or token.consumed_at is not None or token.revoked_at is not None:
        raise HTTPException(status_code=400, detail="This verification link is invalid or has already been used.")
    expires_at = token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        token.revoked_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This verification link has expired. Request a new one.")

    user = db.get(User, token.user_id)
    if not user or not user.is_active:
        token.revoked_at = now
        db.commit()
        raise HTTPException(status_code=400, detail="This verification link is no longer valid.")
    user.is_email_verified = True
    token.consumed_at = now
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user.id,
        EmailVerificationToken.id != token.id,
        EmailVerificationToken.consumed_at.is_(None),
        EmailVerificationToken.revoked_at.is_(None),
    ).update({EmailVerificationToken.revoked_at: now}, synchronize_session=False)
    db.commit()


def refresh_session(db: Session, raw_token: str) -> dict:
    session = db.query(RefreshSession).filter(RefreshSession.token_hash == hash_token(raw_token)).first()
    now = datetime.now(timezone.utc)
    if not session or session.revoked_at is not None or session.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise HTTPException(status_code=401, detail="Refresh token is invalid or expired")
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User account is inactive")
    if not user.is_email_verified:
        raise HTTPException(
            status_code=403,
            detail="Email address is not verified. Check your inbox or request a new link.",
        )
    session.revoked_at = now
    result = _issue_session(db, user)
    db.commit()
    return result


def revoke_refresh_session(db: Session, raw_token: str) -> None:
    session = db.query(RefreshSession).filter(RefreshSession.token_hash == hash_token(raw_token)).first()
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()
