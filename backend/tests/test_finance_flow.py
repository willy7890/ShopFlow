from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from auth_test_support import register_verified_account

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"finance-{test_id}@example.com"
    payload, _ = register_verified_account(
        client,
        full_name="Finance Clerk",
        email=email,
        password="StrongPass123!",
        business_name=f"Finance Shop {test_id}",
    )
    businesses_response = client.get(
        "/api/v1/businesses",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert businesses_response.status_code == 200, businesses_response.text
    return payload["access_token"], businesses_response.json()[0]["id"]


def test_cashbook_finance_flow_with_balances_and_reversal():
    token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {token}", "X-Business-ID": business_id}

    store_response = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert store_response.status_code == 200, store_response.text
    store_id = store_response.json()[0]["id"]

    opening = client.post(
        "/api/v1/finance/entries",
        json={
            "store_id": store_id,
            "entry_type": "opening_balance",
            "direction": "in",
            "amount": "25000",
            "category": "opening",
            "note": "Beginning cash balance",
        },
        headers=headers,
    )
    assert opening.status_code == 201, opening.text

    sale_receipt = client.post(
        "/api/v1/finance/entries",
        json={
            "store_id": store_id,
            "entry_type": "sale_receipt",
            "direction": "in",
            "amount": "6000",
            "category": "sales",
            "reference_type": "sale",
            "reference_id": "sale-001",
            "note": "Cash sales collected",
        },
        headers=headers,
    )
    assert sale_receipt.status_code == 201, sale_receipt.text

    supplier_payment = client.post(
        "/api/v1/finance/entries",
        json={
            "store_id": store_id,
            "entry_type": "supplier_payment",
            "direction": "out",
            "amount": "3500",
            "category": "payables",
            "reference_type": "supplier",
            "reference_id": "supplier-001",
            "note": "Supplier payment",
        },
        headers=headers,
    )
    assert supplier_payment.status_code == 201, supplier_payment.text

    expense = client.post(
        "/api/v1/finance/entries",
        json={
            "store_id": store_id,
            "entry_type": "expense",
            "direction": "out",
            "amount": "1200",
            "category": "operations",
            "note": "Utility expense",
        },
        headers=headers,
    )
    assert expense.status_code == 201, expense.text

    balance = client.get(
        "/api/v1/finance/balance",
        params={"store_id": store_id},
        headers=headers,
    )
    assert balance.status_code == 200, balance.text
    assert balance.json()["total_in"] == "31000.00"
    assert balance.json()["total_out"] == "4700.00"
    assert balance.json()["net_balance"] == "26300.00"

    summary = client.get(
        "/api/v1/finance/summary",
        params={"store_id": store_id},
        headers=headers,
    )
    assert summary.status_code == 200, summary.text
    assert len(summary.json()["entries"]) == 4
    assert summary.json()["net_balance"] == "26300.00"

    reversal = client.post(
        f"/api/v1/finance/entries/{sale_receipt.json()['id']}/reverse",
        headers=headers,
    )
    assert reversal.status_code == 201, reversal.text
    assert reversal.json()["reversal_of_id"] == sale_receipt.json()["id"]

    after_reversal = client.get(
        "/api/v1/finance/balance",
        params={"store_id": store_id},
        headers=headers,
    )
    assert after_reversal.status_code == 200, after_reversal.text
    assert after_reversal.json()["net_balance"] == "20300.00"
