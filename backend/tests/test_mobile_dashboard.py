from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.database import SessionLocal
from app.main import app
from app.modules.businesses.models import Membership

client = TestClient(app)


def test_mobile_dashboard_and_recent_sales_follow_member_permissions():
    test_id = uuid4().hex
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Mobile Dashboard Owner",
            "email": f"mobile-dashboard-{test_id}@example.com",
            "password": "StrongPass123!",
            "business_name": f"Mobile Dashboard Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    access_response = client.get(
        "/api/v1/businesses/access",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert access_response.status_code == 200, access_response.text
    access = access_response.json()[0]
    store_id = access["store_ids"][0]
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Business-ID": access["business_id"],
        "X-Store-ID": store_id,
    }

    dashboard = client.get(
        "/api/v1/reports/mobile-dashboard",
        params={"store_id": store_id},
        headers=headers,
    )
    assert dashboard.status_code == 200, dashboard.text

    db = SessionLocal()
    try:
        membership = db.query(Membership).filter(
            Membership.business_id == access["business_id"],
        ).one()
        membership.role = "cashier"
        membership.store_access = [store_id]
        membership.permissions = ["view_dashboard", "manage_sales"]
        db.commit()
    finally:
        db.close()

    cashier_dashboard = client.get(
        "/api/v1/reports/mobile-dashboard",
        params={"store_id": store_id},
        headers=headers,
    )
    assert cashier_dashboard.status_code == 200, cashier_dashboard.text
    cashier_report = cashier_dashboard.json()
    assert cashier_report["inventory"]["total_variants"] == 0
    assert float(cashier_report["debtors"]["total_outstanding"]) == 0
    assert float(cashier_report["suppliers"]["total_payables"]) == 0

    recent_sales = client.get(
        "/api/v1/sales/recent",
        params={"store_id": store_id, "limit": 5},
        headers=headers,
    )
    assert recent_sales.status_code == 200, recent_sales.text
    assert recent_sales.json() == []

    db = SessionLocal()
    try:
        membership = db.query(Membership).filter(
            Membership.business_id == access["business_id"],
        ).one()
        membership.permissions = ["manage_sales"]
        db.commit()
    finally:
        db.close()

    denied_dashboard = client.get(
        "/api/v1/reports/mobile-dashboard",
        params={"store_id": store_id},
        headers=headers,
    )
    assert denied_dashboard.status_code == 403
    denied_report = client.get(
        "/api/v1/reports/dashboard",
        params={"store_id": store_id},
        headers=headers,
    )
    assert denied_report.status_code == 403
