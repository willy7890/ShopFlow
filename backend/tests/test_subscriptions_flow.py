from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app

client = TestClient(app)


def _register(email: str):
    unique = uuid4().hex
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "ShopFlow Operator",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"ShopFlow Business {unique}",
        },
    )
    assert response.status_code == 201, response.text
    token_data = response.json()
    authorization = "Bearer " + token_data["access_token"]
    businesses = client.get(
        "/api/v1/businesses",
        headers={"Authorization": authorization},
    )
    assert businesses.status_code == 200, businesses.text
    return token_data, businesses.json()[0]["id"]


def test_subscription_plans_bootstrap_entitlements_and_admin_audit(monkeypatch):
    email = f"platform-admin-{uuid4().hex}@example.com"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", email)
    monkeypatch.setattr(settings, "SUPER_ADMIN_BOOTSTRAP_SECRET", "test-bootstrap-secret")
    token_data, business_id = _register(email)
    authorization = "Bearer " + token_data["access_token"]
    headers = {
        "Authorization": authorization,
        "X-Business-ID": business_id,
    }

    profile = client.get("/api/v1/auth/me", headers={"Authorization": authorization})
    assert profile.status_code == 200
    assert profile.json()["is_super_admin"] is False

    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={
            "Authorization": authorization,
            "X-Super-Admin-Bootstrap-Secret": "wrong-secret",
        },
    )
    assert bootstrap.status_code == 403
    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={
            "Authorization": authorization,
            "X-Super-Admin-Bootstrap-Secret": "test-bootstrap-secret",
        },
    )
    assert bootstrap.status_code == 200, bootstrap.text

    admin_headers = {"Authorization": authorization}
    free_plan = client.post(
        "/api/v1/subscriptions/admin/plans",
        json={
            "slug": f"basic-{uuid4().hex[:8]}",
            "name": "Basic",
            "price": "0.00",
            "currency": "TZS",
            "duration_days": 30,
            "features": {"sales": True, "store_limit": 1},
        },
        headers=admin_headers,
    )
    assert free_plan.status_code == 201, free_plan.text
    paid_plan = client.post(
        "/api/v1/subscriptions/admin/plans",
        json={
            "slug": f"standard-{uuid4().hex[:8]}",
            "name": "Standard",
            "price": "12500.00",
            "currency": "TZS",
            "duration_days": 30,
            "features": {"sales": True, "reports": True},
        },
        headers=admin_headers,
    )
    assert paid_plan.status_code == 201, paid_plan.text

    free_request = client.post(
        "/api/v1/subscriptions/request",
        json={"plan_id": free_plan.json()["id"]},
        headers=headers,
    )
    assert free_request.status_code == 201, free_request.text
    assert free_request.json()["status"] == "active"
    entitlements = client.get("/api/v1/subscriptions/entitlements", headers=headers)
    assert entitlements.status_code == 200, entitlements.text
    assert entitlements.json()["features"]["sales"] is True

    paid_request = client.post(
        "/api/v1/subscriptions/request",
        json={"plan_id": paid_plan.json()["id"]},
        headers=headers,
    )
    assert paid_request.status_code == 201, paid_request.text
    assert paid_request.json()["status"] == "pending"
    entitlements_during_upgrade = client.get("/api/v1/subscriptions/entitlements", headers=headers)
    assert entitlements_during_upgrade.status_code == 200
    assert entitlements_during_upgrade.json()["plan"]["id"] == free_plan.json()["id"]

    grant = client.post(
        f"/api/v1/subscriptions/admin/businesses/{business_id}/grant",
        json={"plan_id": paid_plan.json()["id"], "reason": "Approved pilot access"},
        headers=admin_headers,
    )
    assert grant.status_code == 201, grant.text
    assert grant.json()["status"] == "active"

    analytics = client.get("/api/v1/subscriptions/admin/analytics", headers=admin_headers)
    assert analytics.status_code == 200, analytics.text
    assert analytics.json()["business_count"] >= 1
    assert analytics.json()["confirmed_subscription_revenue"] is None

    audit = client.get("/api/v1/subscriptions/admin/audit-logs", headers=admin_headers)
    assert audit.status_code == 200, audit.text
    assert any(item["event_type"] == "subscription_administratively_granted" for item in audit.json())

    deactivated = client.patch(
        f"/api/v1/subscriptions/admin/businesses/{business_id}/status",
        json={"is_active": False, "reason": "Account review requested"},
        headers=admin_headers,
    )
    assert deactivated.status_code == 200, deactivated.text
    blocked = client.get("/api/v1/subscriptions/current", headers=headers)
    assert blocked.status_code == 403
