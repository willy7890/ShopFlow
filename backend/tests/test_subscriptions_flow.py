from uuid import uuid4
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.auth.models import User
from app.modules.businesses.models import Store
from app.modules.finance.models import CashbookEntry
from app.modules.sales.models import Sale
from app.modules.subscriptions.models import BusinessSubscription
from app.modules.subscriptions.models import SubscriptionPlan
from app.modules.businesses.models import Business, Membership
from app.core.entitlements import _feature_for_path, enforce_business_entitlement
from starlette.requests import Request
from app.main import app

client = TestClient(app)


def _enforcement_context(*, features=None, schema_version=1, mode="enforced", expires_at=None):
    db = SessionLocal()
    user = User(full_name="Entitlement Test", email=f"entitlements-{uuid4().hex}@example.com", password_hash="unused")
    business = Business(name="Entitlement Test Business")
    plan = SubscriptionPlan(
        slug=f"entitlement-{uuid4().hex[:12]}", name="Entitlement Test Plan",
        price=Decimal("1.00"), currency="TZS", duration_days=30,
        features=features or {}, entitlement_schema_version=schema_version,
    )
    db.add_all([user, business, plan])
    db.flush()
    membership = Membership(business_id=business.id, user_id=user.id, role="owner", is_active=True)
    subscription = BusinessSubscription(
        business_id=business.id, plan_id=plan.id, status="active", expires_at=expires_at,
        renewal_price=Decimal("1.00"), currency="TZS", entitlement_mode=mode,
    )
    db.add_all([membership, subscription])
    db.commit()
    return db, user, business, membership


def _entitlement_request(path="/api/v1/catalog/products", method="GET"):
    return Request({
        "type": "http", "method": method, "path": path, "headers": [],
        "query_string": b"", "server": ("testserver", 80), "client": ("testclient", 50000),
        "scheme": "http", "root_path": "",
    })


def test_pre_rollout_subscriber_keeps_legacy_access_until_review(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    db, user, _, membership = _enforcement_context(features={"sales": True}, mode="legacy")
    try:
        enforce_business_entitlement(_entitlement_request(), membership, user, db)
    finally:
        db.close()


def test_enforced_plan_denies_excluded_feature_and_expired_subscription(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    db, user, _, membership = _enforcement_context(features={"sales_pos": False})
    try:
        with pytest.raises(HTTPException) as denied:
            enforce_business_entitlement(_entitlement_request(), membership, user, db)
        assert denied.value.status_code == 403
        assert denied.value.detail["code"] == "feature_not_included"
    finally:
        db.close()

    db, user, _, membership = _enforcement_context(
        features={"product_management": True},
        expires_at=datetime(2001, 1, 1, tzinfo=timezone.utc),
    )
    try:
        with pytest.raises(HTTPException) as denied:
            enforce_business_entitlement(_entitlement_request(), membership, user, db)
        assert denied.value.status_code == 402
        assert denied.value.detail["code"] == "subscription_required"
    finally:
        db.close()


def test_missing_entitlement_configuration_fails_closed_after_explicit_enforcement(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    db, user, _, membership = _enforcement_context(features={}, schema_version=0)
    try:
        with pytest.raises(HTTPException) as denied:
            enforce_business_entitlement(_entitlement_request(), membership, user, db)
        assert denied.value.status_code == 403
        assert denied.value.detail["code"] == "plan_entitlements_unconfigured"
    finally:
        db.close()


@pytest.mark.parametrize(("path", "method", "feature"), [
    ("/api/v1/reports/transactions", "GET", "sales_reports"),
    ("/api/v1/reports/expenses", "GET", "financial_reports"),
    ("/api/v1/reports/products/best-selling", "GET", "advanced_analytics"),
    ("/api/v1/reports/products/low-stock", "GET", "stock_alerts"),
    ("/api/v1/orders/order-id/invoice", "GET", "invoices"),
    ("/api/v1/orders", "POST", "orders"),
    ("/api/v1/employees/employee-id", "PATCH", "advanced_permissions"),
    ("/api/v1/businesses/business-id/stores", "POST", "multi_store"),
    ("/api/v1/inventory/suppliers/supplier-id/statement", "GET", "supplier_payments"),
])
def test_business_routes_map_to_their_plan_entitlement(path, method, feature):
    assert _feature_for_path(path, method) == feature


def test_business_route_entitlements_follow_configured_api_prefix(monkeypatch):
    monkeypatch.setattr(settings, "API_V1_PREFIX", "/v2")
    assert _feature_for_path("/v2/sales", "POST") == "sales_pos"


def test_configured_api_prefix_does_not_bypass_product_limit(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "API_V1_PREFIX", "/v2")
    db, user, _, membership = _enforcement_context(features={"product_management": True})
    try:
        with pytest.raises(HTTPException) as denied:
            enforce_business_entitlement(
                _entitlement_request("/v2/catalog/products", "POST"), membership, user, db,
            )
        assert denied.value.detail["code"] == "usage_limit_not_configured"
    finally:
        db.close()


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
    # Test fixtures explicitly mark the new account verified before using
    # protected endpoints; public registration itself never issues a session.
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email.casefold()).one()
        user.is_email_verified = True
        db.commit()
    token_data = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123!"},
    ).json()
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
    for endpoint in (
        "/api/v1/subscriptions/admin/analytics",
        "/api/v1/subscriptions/admin/businesses",
        "/api/v1/subscriptions/admin/users",
        "/api/v1/subscriptions/admin/audit-logs",
    ):
        denied = client.get(endpoint, headers={"Authorization": authorization})
        assert denied.status_code == 403, denied.text

    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={
            "Authorization": authorization,
            "X-Super-Admin-Bootstrap-Secret": "wrong-secret",
        },
    )
    assert bootstrap.status_code == 403
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = False
        db.commit()
    unverified_bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={
            "Authorization": authorization,
            "X-Super-Admin-Bootstrap-Secret": "test-bootstrap-secret",
        },
    )
    assert unverified_bootstrap.status_code == 403
    assert "verified" in unverified_bootstrap.json()["detail"].lower()
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()
    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={
            "Authorization": authorization,
            "X-Super-Admin-Bootstrap-Secret": "test-bootstrap-secret",
        },
    )
    assert bootstrap.status_code == 200, bootstrap.text

    admin_login = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "StrongPass123!"},
    )
    assert admin_login.status_code == 200, admin_login.text
    admin_authorization = "Bearer " + admin_login.json()["access_token"]
    assert admin_login.json()["user"]["is_super_admin"] is True
    verified_profile = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": admin_authorization},
    )
    assert verified_profile.status_code == 200
    assert verified_profile.json()["email"] == email
    assert verified_profile.json()["is_super_admin"] is True
    platform_access = client.get(
        "/api/v1/subscriptions/admin/analytics",
        headers={"Authorization": admin_authorization},
    )
    assert platform_access.status_code == 200, platform_access.text

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
    super_admin_access = client.get("/api/v1/subscriptions/current", headers=headers)
    assert super_admin_access.status_code == 200


def test_trusted_super_admin_has_owner_scope_across_all_business_modules(monkeypatch):
    admin_email = f"global-admin-{uuid4().hex}@example.com"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", admin_email)
    monkeypatch.setattr(settings, "SUPER_ADMIN_BOOTSTRAP_SECRET", "global-test-secret")
    admin_data, admin_business_id = _register(admin_email)
    merchant_data, merchant_business_id = _register(f"merchant-{uuid4().hex}@example.com")
    admin_auth = {"Authorization": f"Bearer {admin_data['access_token']}"}
    merchant_auth = {"Authorization": f"Bearer {merchant_data['access_token']}"}

    with SessionLocal() as db:
        admin = db.query(User).filter(User.email == admin_email).one()
        admin.is_email_verified = True
        db.commit()

    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={**admin_auth, "X-Super-Admin-Bootstrap-Secret": "global-test-secret"},
    )
    assert bootstrap.status_code == 200, bootstrap.text

    admin_access = client.get("/api/v1/businesses/access", headers=admin_auth)
    assert admin_access.status_code == 200, admin_access.text
    access_by_business = {entry["business_id"]: entry for entry in admin_access.json()}
    assert {admin_business_id, merchant_business_id}.issubset(access_by_business)
    assert access_by_business[merchant_business_id]["role"] == "owner"
    assert len(access_by_business[merchant_business_id]["stores"]) == 1

    merchant_business = access_by_business[merchant_business_id]
    store_id = merchant_business["stores"][0]["id"]
    headers = {
        **admin_auth,
        "X-Business-ID": merchant_business_id,
        "X-Store-ID": store_id,
    }
    checks = [
        ("/businesses", 200),
        (f"/businesses/{merchant_business_id}/stores", 200),
        ("/catalog/products", 200),
        ("/customers", 200),
        ("/inventory/suppliers", 200),
        ("/employees", 200),
        ("/sales", 200),
        ("/orders", 200),
        ("/finance/entries", 200),
        ("/reports/dashboard", 200),
        ("/subscriptions/current", 200),
        ("/sync/status", 200),
    ]
    for path, status in checks:
        previous_env = settings.APP_ENV
        if path == "/reports/dashboard":
            monkeypatch.setattr(settings, "APP_ENV", "production")
        response = client.get(f"/api/v1{path}", headers=headers)
        if path == "/reports/dashboard":
            monkeypatch.setattr(settings, "APP_ENV", previous_env)
        assert response.status_code == status, f"{path}: {response.status_code} {response.text}"

    created_customer = client.post(
        "/api/v1/customers",
        headers=headers,
        json={"name": "No Email Customer", "phone": "255700123456"},
    )
    assert created_customer.status_code == 201, created_customer.text
    assert created_customer.json()["email"] is None
    category = client.post("/api/v1/catalog/categories", headers=headers, json={"name": "Admin Created"})
    assert category.status_code == 201, category.text
    merchant_denied = client.get(
        "/api/v1/customers",
        headers={**merchant_auth, "X-Business-ID": merchant_business_id},
    )
    assert merchant_denied.status_code == 200
    cross_tenant_denied = client.get(
        "/api/v1/customers",
        headers={**merchant_auth, "X-Business-ID": admin_business_id},
    )
    assert cross_tenant_denied.status_code == 403

    with SessionLocal() as db:
        merchant = db.query(User).filter(User.email == merchant_data["user"]["email"]).one()
        merchant.is_email_verified = True
        merchant.is_super_admin = True
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    spoofed_role_denied = client.get(
        "/api/v1/subscriptions/admin/businesses",
        headers=merchant_auth,
    )
    assert spoofed_role_denied.status_code == 403


def test_reconcile_unverified_foreign_admin_flag_to_configured_primary(monkeypatch):
    primary_email = "wilbardmagaso777@gmail.com"
    previous_email = f"legacy-admin-{uuid4().hex}@example.com"
    secret = "recovery-test-secret"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", primary_email)
    monkeypatch.setattr(settings, "SUPER_ADMIN_BOOTSTRAP_SECRET", secret)

    primary_session, _ = _register(primary_email)
    previous_session, _ = _register(previous_email)
    primary_auth = {"Authorization": f"Bearer {primary_session['access_token']}"}
    previous_auth = {"Authorization": f"Bearer {previous_session['access_token']}"}
    with SessionLocal() as db:
        primary = db.query(User).filter(User.email == primary_email).one()
        primary.is_email_verified = True
        previous = db.query(User).filter(User.email == previous_email).one()
        previous.is_super_admin = True
        previous.is_email_verified = False
        db.commit()

    assert client.get("/api/v1/auth/me", headers=primary_auth).json()["is_super_admin"] is False
    blocked_bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={**primary_auth, "X-Super-Admin-Bootstrap-Secret": secret},
    )
    assert blocked_bootstrap.status_code == 409
    assert client.get("/api/v1/subscriptions/admin/users", headers=primary_auth).status_code == 403

    recovered = client.post(
        "/api/v1/subscriptions/admin/reconcile-primary",
        headers={**primary_auth, "X-Super-Admin-Bootstrap-Secret": secret},
        json={
            "existing_admin_email": previous_email,
            "confirm_primary_email": primary_email,
            "reason": "Recover configured system owner after stale unverified bootstrap",
        },
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json() == {"is_super_admin": True}

    primary_me = client.get("/api/v1/auth/me", headers=primary_auth)
    assert primary_me.status_code == 200
    assert primary_me.json()["email"] == primary_email
    assert primary_me.json()["is_super_admin"] is True
    with SessionLocal() as db:
        primary = db.query(User).filter(User.email == primary_email).one()
        previous = db.query(User).filter(User.email == previous_email).one()
        assert primary.is_super_admin is True
        assert previous.is_super_admin is False
        # The recovery case starts with an unverified stale flag. Restore the
        # ordinary account's verified state before testing its business access.
        previous.is_email_verified = True
        db.commit()

    for endpoint in (
        "/api/v1/subscriptions/admin/businesses",
        "/api/v1/subscriptions/admin/users",
        "/api/v1/subscriptions/admin/analytics",
        "/api/v1/subscriptions/admin/audit-logs",
    ):
        assert client.get(endpoint, headers=primary_auth).status_code == 200, endpoint
        assert client.get(endpoint, headers=previous_auth).status_code == 403, endpoint
    primary_access = client.get("/api/v1/businesses/access", headers=primary_auth)
    previous_access = client.get("/api/v1/businesses/access", headers=previous_auth)
    assert primary_access.status_code == previous_access.status_code == 200
    assert {row["business_id"] for row in primary_access.json()} >= {
        row["business_id"] for row in previous_access.json()
    }
    assert len(previous_access.json()) == 1

    assert client.post(
        "/api/v1/subscriptions/admin/reconcile-primary",
        headers={**previous_auth, "X-Super-Admin-Bootstrap-Secret": secret},
        json={
            "existing_admin_email": previous_email,
            "confirm_primary_email": primary_email,
            "reason": "Unauthorized user attempted system owner recovery",
        },
    ).status_code == 403
    audit = client.get("/api/v1/subscriptions/admin/audit-logs", headers=primary_auth)
    assert any(row["event_type"] == "super_admin_identity_reconciled" for row in audit.json())


def test_plan_management_assignment_and_global_reports_are_database_backed(monkeypatch):
    owner_email = f"owner-{uuid4().hex}@example.com"
    merchant_email = f"merchant-{uuid4().hex}@example.com"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", owner_email)
    monkeypatch.setattr(settings, "SUPER_ADMIN_BOOTSTRAP_SECRET", "plans-test-secret")
    owner_session, owner_business_id = _register(owner_email)
    merchant_session, merchant_business_id = _register(merchant_email)
    owner_auth = {"Authorization": f"Bearer {owner_session['access_token']}"}
    merchant_auth = {"Authorization": f"Bearer {merchant_session['access_token']}"}

    with SessionLocal() as db:
        owner = db.query(User).filter(User.email == owner_email).one()
        owner.is_email_verified = True
        db.commit()
        merchant = db.query(User).filter(User.email == merchant_email).one()
        store = db.query(Store).filter(Store.business_id == merchant_business_id).one()
        db.add(Sale(
            business_id=merchant_business_id,
            store_id=store.id,
            sale_number=f"ADMIN-REPORT-{uuid4().hex[:8]}",
            status="completed",
            total_amount=Decimal("1200.00"),
            paid_amount=Decimal("1200.00"),
            balance_due=Decimal("0.00"),
            created_by=merchant.id,
        ))
        db.add(CashbookEntry(
            business_id=merchant_business_id,
            store_id=store.id,
            entry_type="expense",
            direction="out",
            amount=Decimal("45.00"),
            category="Rent",
            created_by=merchant.id,
        ))
        db.commit()

    bootstrap = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={**owner_auth, "X-Super-Admin-Bootstrap-Secret": "plans-test-secret"},
    )
    assert bootstrap.status_code == 200, bootstrap.text

    created = client.post("/api/v1/subscriptions/admin/plans", headers=owner_auth, json={
        "slug": "tanzania-growth",
        "name": "Tanzania Growth",
        "description": "Growth plan with a trial",
        "price": "25000.00",
        "duration_days": 30,
        "trial_days": 7,
        "features": {"stores": 3, "employees": 20, "products": 1000, "reports": True},
    })
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["currency"] == "TZS"
    assert plan["description"] == "Growth plan with a trial"
    assert plan["trial_days"] == 7

    updated = client.patch(f"/api/v1/subscriptions/admin/plans/{plan['id']}", headers=owner_auth, json={
        "name": "Tanzania Growth Plus",
        "description": "Updated plan details",
        "price": "30000.00",
        "duration_days": 90,
        "trial_days": 14,
        "features": {"stores": 5, "employees": 40, "products": 5000, "reports": True},
        "is_active": True,
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["duration_days"] == 90
    assert updated.json()["features"]["employees"] == 40

    grant = client.post(f"/api/v1/subscriptions/admin/businesses/{merchant_business_id}/grant", headers=owner_auth, json={
        "plan_id": plan["id"], "duration_days": 7, "reason": "Approved one week initial access",
    })
    assert grant.status_code == 201, grant.text
    assert grant.json()["status"] == "active"
    assert grant.json()["currency"] == "TZS"
    assert grant.json()["expires_at"]

    detail = client.get(f"/api/v1/subscriptions/admin/businesses/{merchant_business_id}", headers=owner_auth)
    assert detail.status_code == 200, detail.text
    assert detail.json()["owner_email"] == merchant_email
    assert detail.json()["subscription"]["plan_id"] == plan["id"]
    businesses_on_plan = client.get(f"/api/v1/subscriptions/admin/plans/{plan['id']}/businesses", headers=owner_auth)
    assert businesses_on_plan.status_code == 200, businesses_on_plan.text
    assert any(row["id"] == merchant_business_id for row in businesses_on_plan.json())
    searched_by_owner = client.get("/api/v1/subscriptions/admin/businesses", headers=owner_auth, params={"search": merchant_email})
    assert [row["id"] for row in searched_by_owner.json()] == [merchant_business_id]
    searched_by_id = client.get("/api/v1/subscriptions/admin/businesses", headers=owner_auth, params={"search": merchant_business_id})
    assert [row["id"] for row in searched_by_id.json()] == [merchant_business_id]
    filtered_by_plan = client.get("/api/v1/subscriptions/admin/businesses", headers=owner_auth, params={
        "plan_id": plan["id"], "subscription_status": "active",
    })
    assert [row["id"] for row in filtered_by_plan.json()] == [merchant_business_id]

    today = datetime.now(timezone.utc).date().isoformat()
    global_report = client.get(
        "/api/v1/subscriptions/admin/global-reports",
        params={"start_date": today, "end_date": today},
        headers=owner_auth,
    )
    assert global_report.status_code == 200, global_report.text
    tzs = next(row for row in global_report.json()["currency_totals"] if row["currency"] == "TZS")
    assert Decimal(tzs["sales_revenue"]) == Decimal("1200.00")
    assert Decimal(tzs["expenses"]) == Decimal("45.00")
    assert global_report.json()["transaction_count"] == 1
    empty_period = client.get(
        "/api/v1/subscriptions/admin/global-reports",
        params={"start_date": "2001-01-01", "end_date": "2001-01-02"},
        headers=owner_auth,
    )
    empty_tzs = next(row for row in empty_period.json()["currency_totals"] if row["currency"] == "TZS")
    assert Decimal(empty_tzs["sales_revenue"]) == 0
    assert Decimal(empty_tzs["expenses"]) == 0

    business_report = client.get("/api/v1/reports/mobile-dashboard", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    assert business_report.status_code == 200, business_report.text
    assert Decimal(business_report.json()["sales"]["total_sales"]) == Decimal("1200.00")
    expense_report = client.get("/api/v1/reports/expenses", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    assert expense_report.status_code == 200, expense_report.text
    assert Decimal(expense_report.json()["total_expenses"]) == Decimal("45.00")
    assert expense_report.json()["entries"] == [{"category": "Rent", "amount": "45.00"}]
    cashbook_report = client.get("/api/v1/finance/entries", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    assert cashbook_report.status_code == 200, cashbook_report.text
    assert any(Decimal(entry["amount"]) == Decimal("45.00") for entry in cashbook_report.json())
    cashbook_balance = client.get("/api/v1/finance/balance", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    assert cashbook_balance.status_code == 200, cashbook_balance.text
    assert Decimal(cashbook_balance.json()["total_out"]) == Decimal("45.00")
    assert Decimal(cashbook_balance.json()["net_balance"]) == Decimal("-45.00")
    transaction_report = client.get("/api/v1/reports/transactions", params={
        "start_date": today, "end_date": today, "limit": 25,
    }, headers={**owner_auth, "X-Business-ID": merchant_business_id})
    assert transaction_report.status_code == 200, transaction_report.text
    assert len(transaction_report.json()) == 1
    assert transaction_report.json()[0]["sale_number"].startswith("ADMIN-REPORT-")
    unauthorized_transaction_report = client.get("/api/v1/reports/transactions", headers={
        **merchant_auth, "X-Business-ID": owner_business_id,
    })
    assert unauthorized_transaction_report.status_code in {403, 404}
    csv_export = client.get("/api/v1/reports/export/csv", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    pdf_export = client.get("/api/v1/reports/export/pdf", params={"start_date": today, "end_date": today}, headers={
        **owner_auth, "X-Business-ID": merchant_business_id,
    })
    assert csv_export.status_code == 200 and "text/csv" in csv_export.headers["content-type"]
    assert pdf_export.status_code == 200 and pdf_export.content.startswith(b"%PDF")

    subscriptions = client.get("/api/v1/subscriptions/admin/subscriptions", headers=owner_auth)
    assert subscriptions.status_code == 200, subscriptions.text
    active = next(row for row in subscriptions.json() if row["business_id"] == merchant_business_id)
    extended = client.patch(f"/api/v1/subscriptions/admin/subscriptions/{active['id']}", headers=owner_auth, json={
        "extend_days": 30, "reason": "Extend approved business access",
    })
    assert extended.status_code == 200, extended.text
    with SessionLocal() as db:
        stored_subscription = db.get(BusinessSubscription, active["id"])
        stored_subscription.expires_at = datetime(2001, 1, 1, tzinfo=timezone.utc)
        db.commit()
    expired_rows = client.get("/api/v1/subscriptions/admin/subscriptions", headers=owner_auth)
    expired = next(row for row in expired_rows.json() if row["id"] == active["id"])
    assert expired["status"] == "active" and expired["effective_status"] == "expired"
    suspended = client.patch(f"/api/v1/subscriptions/admin/subscriptions/{active['id']}", headers=owner_auth, json={
        "status": "suspended", "reason": "Suspend after review",
    })
    assert suspended.status_code == 200, suspended.text
    assert suspended.json()["status"] == "suspended"
    assert client.post("/api/v1/subscriptions/admin/plans", headers=merchant_auth, json={
        "slug": "ordinary-user-plan", "name": "Unauthorized", "price": "1", "duration_days": 7,
    }).status_code == 403


def test_subscription_payment_ledger_requires_super_admin_and_audits_lifecycle(monkeypatch):
    email = f"payments-admin-{uuid4().hex}@example.com"
    monkeypatch.setattr(settings, "SUPER_ADMIN_EMAIL", email)
    monkeypatch.setattr(settings, "SUPER_ADMIN_BOOTSTRAP_SECRET", "payment-test-secret")
    owner_data, business_id = _register(email)
    owner_headers = {"Authorization": f"Bearer {owner_data['access_token']}"}
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == email).one()
        user.is_email_verified = True
        db.commit()
    bootstrapped = client.post(
        "/api/v1/subscriptions/admin/bootstrap",
        headers={**owner_headers, "X-Super-Admin-Bootstrap-Secret": "payment-test-secret"},
    )
    assert bootstrapped.status_code == 200, bootstrapped.text
    admin_login = client.post("/api/v1/auth/login", json={"email": email, "password": "StrongPass123!"})
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}
    ordinary_data, _ = _register(f"payments-user-{uuid4().hex}@example.com")
    ordinary_headers = {"Authorization": f"Bearer {ordinary_data['access_token']}"}

    plan_response = client.post("/api/v1/subscriptions/admin/plans", headers=admin_headers, json={
        "slug": f"paid-{uuid4().hex[:10]}", "name": "Paid plan", "price": "5000.00",
        "currency": "TZS", "duration_days": 30, "features": {"sales": True},
    })
    assert plan_response.status_code == 201, plan_response.text
    subscription = client.post("/api/v1/subscriptions/request", headers={
        **owner_headers, "X-Business-ID": business_id,
    }, json={"plan_id": plan_response.json()["id"]})
    assert subscription.status_code == 201, subscription.text
    sub_id = subscription.json()["id"]
    today = datetime.now(timezone.utc).date().isoformat()
    payment_payload = {
        "subscription_id": sub_id, "amount": "5000.00", "payment_method": "bank",
        "transaction_reference": f"TX-{uuid4().hex}", "paid_at": f"{today}T10:00:00Z",
    }
    denied = client.post("/api/v1/subscriptions/admin/payments", headers=ordinary_headers, json=payment_payload)
    assert denied.status_code == 403
    payment_headers = {**owner_headers, "X-Business-ID": business_id}
    unconfigured_payment = client.post("/api/v1/subscriptions/payments/submit", headers=payment_headers, json={
        "payment_method": "bank",
        "transaction_reference": f"NO-SETTING-{uuid4().hex}",
        "paid_at": payment_payload["paid_at"],
    })
    assert unconfigured_payment.status_code == 409
    setting = client.patch("/api/v1/subscriptions/admin/payment-settings/TZS/bank", headers=admin_headers, json={
        "display_name": "Bank transfer (test fixture)",
        "recipient_name": "TEST FIXTURE ONLY",
        "recipient_details": "TEST ONLY; not a valid payment destination",
        "reference_instructions": "Use a synthetic transaction reference in tests.",
        "is_active": True,
        "reason": "Configure isolated payment workflow test",
    })
    assert setting.status_code == 200, setting.text
    instructions = client.get("/api/v1/subscriptions/payment-instructions", headers=payment_headers)
    assert instructions.status_code == 200, instructions.text
    assert instructions.json()["configured"] is True
    assert instructions.json()["methods"][0]["recipient_details"].startswith("TEST ONLY")
    customer_payment_payload = {
        "payment_method": "bank",
        "transaction_reference": payment_payload["transaction_reference"],
        "paid_at": payment_payload["paid_at"],
    }
    customer_payment = client.post("/api/v1/subscriptions/payments/submit", headers=payment_headers, json=customer_payment_payload)
    assert customer_payment.status_code == 201, customer_payment.text
    assert customer_payment.json()["amount"] == "5000.00"
    assert customer_payment.json()["currency"] == "TZS"
    assert client.post("/api/v1/subscriptions/payments/submit", headers=payment_headers, json={
        **customer_payment_payload,
        "transaction_reference": customer_payment_payload["transaction_reference"].lower(),
    }).status_code == 409
    assert client.post("/api/v1/subscriptions/payments/submit", headers={**ordinary_headers, "X-Business-ID": business_id}, json={
        **customer_payment_payload, "transaction_reference": f"CROSS-{uuid4().hex}",
    }).status_code == 403
    mismatch = client.post("/api/v1/subscriptions/admin/payments", headers=admin_headers, json={
        **payment_payload,
        "amount": "4999.00",
        "transaction_reference": f"MISMATCH-{uuid4().hex}",
    })
    assert mismatch.status_code == 201
    mismatch_confirmation = client.patch(f"/api/v1/subscriptions/admin/payments/{mismatch.json()['id']}", headers=admin_headers, json={
        "status": "confirmed", "details": "Attempted amount mismatch confirmation",
    })
    assert mismatch_confirmation.status_code == 409
    pending_rows = client.get("/api/v1/subscriptions/admin/payments", headers=admin_headers, params={"status": "pending"})
    assert pending_rows.status_code == 200
    assert next(item for item in pending_rows.json() if item["id"] == mismatch.json()["id"])["status"] == "pending"
    recorded = customer_payment
    duplicate = client.post("/api/v1/subscriptions/admin/payments", headers=admin_headers, json={
        **payment_payload,
        "transaction_reference": payment_payload["transaction_reference"].lower(),
    })
    assert duplicate.status_code == 409, duplicate.text

    payment_id = recorded.json()["id"]
    confirmed = client.patch(f"/api/v1/subscriptions/admin/payments/{payment_id}", headers=admin_headers, json={
        "status": "confirmed", "details": "Bank statement reconciled",
    })
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    subscriptions = client.get("/api/v1/subscriptions/admin/subscriptions", headers=admin_headers)
    assert subscriptions.status_code == 200
    active = next(item for item in subscriptions.json() if item["id"] == sub_id)
    assert active["status"] == "active"
    first_expiry = active["expires_at"]
    repeated_approval = client.patch(f"/api/v1/subscriptions/admin/payments/{payment_id}", headers=admin_headers, json={
        "status": "confirmed", "details": "Duplicate approval request",
    })
    assert repeated_approval.status_code == 200
    subscriptions = client.get("/api/v1/subscriptions/admin/subscriptions", headers=admin_headers)
    assert next(item for item in subscriptions.json() if item["id"] == sub_id)["expires_at"] == first_expiry

    failed_payment = client.post("/api/v1/subscriptions/admin/payments", headers=admin_headers, json={
        **payment_payload, "transaction_reference": f"FAIL-{uuid4().hex}",
    })
    assert failed_payment.status_code == 201
    failed = client.patch(f"/api/v1/subscriptions/admin/payments/{failed_payment.json()['id']}", headers=admin_headers, json={
        "status": "failed", "details": "Reference not found in provider statement",
    })
    assert failed.status_code == 200 and failed.json()["status"] == "failed"

    revenue = client.get("/api/v1/subscriptions/admin/revenue", headers=admin_headers, params={
        "start_date": today, "end_date": today,
    })
    assert revenue.status_code == 200, revenue.text
    assert any(item["currency"] == "TZS" and Decimal(item["confirmed_amount"]) == Decimal("5000.00") for item in revenue.json()["daily"])

    refunded = client.post(f"/api/v1/subscriptions/admin/payments/{payment_id}/refund", headers=admin_headers, json={
        "status": "refunded", "details": "Duplicate customer transfer", "refund_amount": "5000.00",
    })
    assert refunded.status_code == 200, refunded.text
    assert refunded.json()["status"] == "refunded"
    audit = client.get("/api/v1/subscriptions/admin/audit-logs", headers=admin_headers)
    assert audit.status_code == 200
    events = {entry["event_type"] for entry in audit.json()}
    assert {"subscription_payment_recorded", "subscription_payment_confirmed", "subscription_payment_failed", "subscription_payment_confirmation_rejected", "subscription_payment_refunded"}.issubset(events)
