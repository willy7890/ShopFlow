from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.database import SessionLocal
from app.main import app
from app.modules.auth.models import User

client = TestClient(app)


@pytest.mark.parametrize("password", ["short", "lowercasepassword123!", "NOLOWERCASE123!", "NoDigitsHere!!!"])
def test_registration_rejects_weak_passwords_without_creating_an_account(password):
    email = f"weak-{uuid4().hex}@example.com"
    response = client.post("/api/v1/auth/register", json={
        "full_name": "Weak Password Test",
        "email": email,
        "password": password,
        "business_name": "Weak Password Shop",
    })
    assert response.status_code == 422
    with SessionLocal() as db:
        assert db.query(User).filter(User.email == email).first() is None


def test_register_and_me():
    test_id = uuid4().hex
    email = f"owner-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Test Owner",
            "email": email.upper(),
            "phone": "+255700000000",
            "password": "StrongPass123!",
            "business_name": f"Test Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["verification_required"] is True
    supplied_email = f"{email.split('@')[0].upper()}@example.com"
    assert data["email"] == supplied_email
    assert "access_token" not in data and "refresh_token" not in data
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"}).status_code == 403
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == supplied_email).one()
        assert user.phone == "+255700000000"
        assert user.is_super_admin is False
        user.is_email_verified = True
        db.commit()
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"})
    assert login.status_code == 200, login.text
    data = login.json()
    authorization = {"Authorization": f"Bearer {data['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=authorization)
    assert me.status_code == 200
    assert me.json()["email"] == supplied_email
    access = client.get("/api/v1/businesses/access", headers=authorization)
    assert access.status_code == 200
    assert len(access.json()) == 1
    assert access.json()[0]["role"] == "owner"
    assert len(access.json()[0]["stores"]) == 1
    assert access.json()[0]["store_ids"] == [access.json()[0]["stores"][0]["id"]]

    duplicate_email = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Another Owner",
            "email": email.upper(),
            "password": "StrongPass123!",
            "business_name": f"Another Shop {test_id}",
        },
    )
    assert duplicate_email.status_code == 409
    assert duplicate_email.json()["detail"] == "Email is already registered"

    duplicate_phone = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Another Owner",
            "email": f"another-{test_id}@example.com",
            "phone": "+255700000000",
            "password": "StrongPass123!",
            "business_name": f"Another Shop {test_id}",
        },
    )
    assert duplicate_phone.status_code == 409
    assert duplicate_phone.json()["detail"] == "Phone number is already registered"


def test_login_rejects_bad_password_and_inactive_accounts():
    test_id = uuid4().hex
    email = f"login-{test_id}@example.com"
    password = "StrongPass123!"
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Login Owner",
            "email": email,
            "password": password,
            "business_name": f"Login Shop {test_id}",
        },
    )
    assert registered.status_code == 201, registered.text

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()

    logged_in = client.post(
        "/api/v1/auth/login", json={"email": f"  {email.upper()}  ", "password": password}
    )
    assert logged_in.status_code == 200, logged_in.text
    assert logged_in.json()["access_token"]
    assert logged_in.json()["refresh_token"]

    wrong_password = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "WrongPass123!"},
    )
    assert wrong_password.status_code == 401

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        user.is_active = False
        db.commit()

    inactive_user = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert inactive_user.status_code == 401


def test_expired_access_token_refresh_restores_me_and_business_access(monkeypatch):
    monkeypatch.setattr(settings, "ACCESS_TOKEN_MINUTES", -1)
    test_id = uuid4().hex
    email = f"refresh-{test_id}@example.com"
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Refresh Owner",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Refresh Shop {test_id}",
        },
    )
    assert registered.status_code == 201, registered.text
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()
    tokens = client.post(
        "/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"},
    ).json()
    authorization = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert client.get("/api/v1/auth/me", headers=authorization).status_code == 401

    monkeypatch.setattr(settings, "ACCESS_TOKEN_MINUTES", 30)
    refreshed = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
    )
    assert refreshed.status_code == 200, refreshed.text
    refreshed_authorization = {
        "Authorization": f"Bearer {refreshed.json()['access_token']}"
    }
    assert client.get("/api/v1/auth/me", headers=refreshed_authorization).status_code == 200
    assert client.get(
        "/api/v1/businesses/access", headers=refreshed_authorization
    ).status_code == 200
