from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_token
from app.main import app
from app.modules.auth.models import EmailVerificationToken, User

client = TestClient(app)


def _configure_delivery(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test.invalid")
    monkeypatch.setattr(settings, "SMTP_PORT", 587)
    monkeypatch.setattr(settings, "SMTP_USERNAME", "shopflow-test")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "test-password")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "noreply@example.test")
    monkeypatch.setattr(settings, "SMTP_STARTTLS", True)
    monkeypatch.setattr(settings, "SMTP_USE_SSL", False)
    monkeypatch.setattr(
        settings,
        "EMAIL_VERIFICATION_BASE_URL",
        "https://api.example.test/api/v1/auth/verify-email",
    )
    monkeypatch.setattr(
        settings,
        "PASSWORD_RESET_BASE_URL",
        "https://api.example.test/api/v1/auth/password-reset",
    )


def _register(email: str):
    return client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Verification Owner",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Verify Shop {uuid4().hex}",
        },
    )


def test_verification_link_is_hashed_persisted_and_single_use(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append((recipient, token)),
    )
    email = f"verify-{uuid4().hex}@example.com"

    registered = _register(email)
    assert registered.status_code == 201, registered.text
    assert registered.json()["email_sent"] is True
    assert registered.json()["delivery_configured"] is True
    assert len(sent) == 1
    raw_token = sent[0][1]

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        token_row = db.query(EmailVerificationToken).filter(
            EmailVerificationToken.user_id == user.id
        ).one()
        assert token_row.token_hash == hash_token(raw_token)
        assert token_row.token_hash != raw_token
        assert user.is_email_verified is False

    page = client.get("/api/v1/auth/verify-email")
    assert page.status_code == 200
    assert "location.hash" in page.text
    verified = client.post("/api/v1/auth/verify-email", json={"token": raw_token})
    assert verified.status_code == 200
    assert verified.json()["verified"] is True
    replay = client.post("/api/v1/auth/verify-email", json={"token": raw_token})
    assert replay.status_code == 400

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        assert user.is_email_verified is True

    login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123!"},
    )
    assert login.status_code == 200, login.text


def test_registration_sends_to_the_email_address_as_entered(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append((recipient, token)),
    )
    supplied_email = f"Mixed.Case-{uuid4().hex}@example.com"
    response = _register(supplied_email)
    assert response.status_code == 201, response.text
    assert response.json()["email"] == supplied_email
    assert sent[0][0] == supplied_email


def test_verification_token_only_verifies_its_associated_user(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append((recipient, token)),
    )
    first_email = f"first-{uuid4().hex}@example.com"
    second_email = f"second-{uuid4().hex}@example.com"
    assert _register(first_email).status_code == 201
    assert _register(second_email).status_code == 201
    token = next(token for recipient, token in sent if recipient == first_email)
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
    with SessionLocal() as db:
        assert db.query(User).filter(User.email == first_email).one().is_email_verified is True
        assert db.query(User).filter(User.email == second_email).one().is_email_verified is False


def test_configured_super_admin_cannot_sign_in_until_email_verification(monkeypatch):
    _configure_delivery(monkeypatch)
    email = f"owner-{uuid4().hex}@example.com"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", email.upper())
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append(token),
    )

    registered = _register(email)
    assert registered.status_code == 201, registered.text
    assert "access_token" not in registered.json()
    denied_login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123!"},
    )
    assert denied_login.status_code == 403

    verified = client.post("/api/v1/auth/verify-email", json={"token": sent[0]})
    assert verified.status_code == 200
    allowed_login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123!"},
    )
    assert allowed_login.status_code == 200
    assert allowed_login.json()["user"]["is_super_admin"] is False


def test_expired_token_does_not_verify_account(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append(token),
    )
    email = f"expired-{uuid4().hex}@example.com"
    registered = _register(email)
    assert registered.status_code == 201, registered.text

    with SessionLocal() as db:
        token_row = db.query(EmailVerificationToken).filter(
            EmailVerificationToken.token_hash == hash_token(sent[0])
        ).one()
        token_row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    response = client.post("/api/v1/auth/verify-email", json={"token": sent[0]})
    assert response.status_code == 400
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        assert user.is_email_verified is False


def test_resend_is_rate_limited_and_does_not_disclose_account_state(monkeypatch):
    _configure_delivery(monkeypatch)
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_MAX_PER_HOUR", 1)
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", 0)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append(token),
    )
    email = f"limited-{uuid4().hex}@example.com"
    registered = _register(email)
    assert registered.status_code == 201, registered.text

    resend = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": f"  {email.upper()}  "},
    )
    missing = client.post(
        "/api/v1/auth/resend-verification",
        json={"email": f"missing-{uuid4().hex}@example.com"},
    )
    assert resend.status_code == missing.status_code == 200
    assert resend.json() == missing.json()
    assert resend.json()["delivery_sent"] is None
    assert len(sent) == 1


def test_resend_rotates_single_use_token(monkeypatch):
    _configure_delivery(monkeypatch)
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_MAX_PER_HOUR", 5)
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", 0)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda recipient, token: sent.append(token),
    )
    email = f"rotated-{uuid4().hex}@example.com"
    registered = _register(email)
    assert registered.status_code == 201, registered.text
    resent = client.post("/api/v1/auth/resend-verification", json={"email": email})
    assert resent.status_code == 200
    assert len(sent) == 2
    assert sent[0] != sent[1]
    assert client.post("/api/v1/auth/verify-email", json={"token": sent[0]}).status_code == 400
    assert client.post("/api/v1/auth/verify-email", json={"token": sent[1]}).status_code == 200


def test_registration_without_email_configuration_does_not_claim_delivery(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    monkeypatch.setattr(settings, "SMTP_FROM_EMAIL", "")
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_BASE_URL", "")
    monkeypatch.setattr(
        "app.modules.auth.service.send_verification_email",
        lambda *_: (_ for _ in ()).throw(AssertionError("sender must not run")),
    )

    response = _register(f"offline-{uuid4().hex}@example.com")
    assert response.status_code == 201, response.text
    assert response.json()["email_sent"] is False
    assert response.json()["delivery_configured"] is False


def test_smtp_sender_builds_verification_message_and_uses_starttls(monkeypatch):
    _configure_delivery(monkeypatch)
    import app.modules.auth.email as email_module

    captured = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            captured["connection"] = (host, port, timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def ehlo(self):
            captured["ehlo"] = True

        def starttls(self, context):
            captured["tls"] = context

        def login(self, username, password):
            captured["login"] = (username, password)

        def send_message(self, message):
            captured["message"] = message

    monkeypatch.setattr(email_module.smtplib, "SMTP", FakeSMTP)
    email_module.send_verification_email("owner@example.test", "opaque-token-value")

    assert captured["connection"] == ("smtp.test.invalid", 587, 20)
    assert captured["tls"] is not None
    assert captured["tls"].get_ca_certs()
    assert captured["login"] == ("shopflow-test", "test-password")
    message = captured["message"]
    assert message["To"] == "owner@example.test"
    assert "noreply@example.test" in message["From"]
    assert "#token=opaque-token-value" in message.get_body(preferencelist=("plain",)).get_content()


def test_smtp_failure_logs_provider_reason_without_password(monkeypatch, caplog):
    import logging
    import smtplib

    _configure_delivery(monkeypatch)

    def reject_delivery(*_):
        raise smtplib.SMTPAuthenticationError(535, b"5.7.8 invalid credentials")

    monkeypatch.setattr("app.modules.auth.service.send_verification_email", reject_delivery)
    email = f"smtp-failure-{uuid4().hex}@example.com"
    with caplog.at_level(logging.WARNING):
        response = _register(email)

    assert response.status_code == 201, response.text
    assert response.json()["email_sent"] is False
    assert "smtp_code=535" in caplog.text
    assert "invalid credentials" not in caplog.text
    assert "test-password" not in caplog.text

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        token = db.query(EmailVerificationToken).filter(
            EmailVerificationToken.user_id == user.id
        ).one()
        assert user.is_email_verified is False
        assert token.revoked_at is not None


def test_password_reset_hashes_token_consumes_once_and_revokes_sessions(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_password_reset_email",
        lambda recipient, token: sent.append((recipient, token)),
    )
    email = f"reset-{uuid4().hex}@example.com"
    assert _register(email).status_code == 201
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()
    session = client.post("/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"}).json()

    requested = client.post("/api/v1/auth/password-reset/request", json={"email": email.upper()})
    assert requested.status_code == 202
    assert sent[0][0] == email
    raw_token = sent[0][1]
    from app.modules.auth.models import PasswordResetToken, RefreshSession
    with SessionLocal() as db:
        row = db.query(PasswordResetToken).one()
        assert row.token_hash == hash_token(raw_token)
        assert row.token_hash != raw_token

    reset = client.post("/api/v1/auth/password-reset/confirm", json={
        "token": raw_token, "new_password": "ChangedStrongPass456!",
    })
    assert reset.status_code == 200, reset.text
    assert client.post("/api/v1/auth/password-reset/confirm", json={
        "token": raw_token, "new_password": "AnotherStrongPass789!",
    }).status_code == 400
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {session['access_token']}"}).status_code == 401
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "ChangedStrongPass456!"}).status_code == 200
    with SessionLocal() as db:
        assert db.query(RefreshSession).filter(RefreshSession.revoked_at.is_(None)).count() == 1


def test_password_reset_expiry_and_unknown_email_response_are_safe(monkeypatch):
    _configure_delivery(monkeypatch)
    sent = []
    monkeypatch.setattr(
        "app.modules.auth.service.send_password_reset_email",
        lambda recipient, token: sent.append((recipient, token)),
    )
    email = f"expired-reset-{uuid4().hex}@example.com"
    assert _register(email).status_code == 201
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()

    known = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post("/api/v1/auth/password-reset/request", json={"email": f"missing-{uuid4().hex}@example.com"})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(sent) == 1

    from app.modules.auth.models import PasswordResetToken
    with SessionLocal() as db:
        row = db.query(PasswordResetToken).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    expired = client.post("/api/v1/auth/password-reset/confirm", json={
        "token": sent[0][1], "new_password": "ChangedStrongPass456!",
    })
    assert expired.status_code == 400
    assert "expired" in expired.json()["detail"].lower()
