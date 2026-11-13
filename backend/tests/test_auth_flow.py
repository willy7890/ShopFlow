from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.modules.auth.models import User

client = TestClient(app)


def test_register_and_me():
    test_id = uuid4().hex
    email = f"owner-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Test Owner",
            "email": email,
            "phone": "+255700000000",
            "password": "StrongPass123!",
            "business_name": f"Test Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["user"]["phone"] == "+255700000000"
    assert data["user"]["is_super_admin"] is False
    authorization = {"Authorization": f"Bearer {data['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=authorization)
    assert me.status_code == 200
    assert me.json()["email"] == email
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
            "email": email,
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

    logged_in = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
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
