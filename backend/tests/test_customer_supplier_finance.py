from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"finance-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Finance Clerk",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Finance Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    business_response = client.get(
        "/api/v1/businesses",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert business_response.status_code == 200, business_response.text
    business = business_response.json()[0]
    return payload["access_token"], business["id"]


def test_customer_debtor_and_supplier_creditor_flows():
    token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {token}", "X-Business-ID": business_id}

    category = client.post("/api/v1/catalog/categories", json={"name": "Snacks"}, headers=headers)
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]

    unit = client.post("/api/v1/catalog/units", json={"name": "Pack", "code": "PK"}, headers=headers)
    assert unit.status_code == 201, unit.text
    unit_id = unit.json()["id"]

    product = client.post(
        "/api/v1/catalog/products",
        json={"name": "Crunchy Biscuits", "category_id": category_id},
        headers=headers,
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    variant = client.post(
        f"/api/v1/catalog/products/{product_id}/variants",
        json={
            "name": "Family Pack",
            "unit_id": unit_id,
            "sku": f"CB-{uuid4().hex[:6].upper()}",
            "barcode": f"{uuid4().int % 1000000000000:013d}",
            "purchase_price": "800",
            "selling_price": "2000",
            "low_stock_threshold": "2",
            "track_stock": True,
        },
        headers=headers,
    )
    assert variant.status_code == 201, variant.text
    variant_id = variant.json()["id"]

    store = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert store.status_code == 200, store.text
    store_id = store.json()[0]["id"]

    supplier = client.post(
        "/api/v1/inventory/suppliers",
        json={"name": "Supplier One", "phone": "255700000000"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier.status_code == 201, supplier.text
    supplier_id = supplier.json()["id"]

    purchase = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "PO-2001",
            "items": [{"variant_id": variant_id, "quantity": "5", "unit_cost": "800", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert purchase.status_code == 201, purchase.text
    purchase_id = purchase.json()["id"]

    receive = client.post(f"/api/v1/inventory/purchases/{purchase_id}/receive", headers={**headers, "X-Store-ID": store_id})
    assert receive.status_code == 200, receive.text

    customer = client.post(
        "/api/v1/customers",
        json={"name": "Alice Customer", "phone": "255700111111", "credit_limit": "50000"},
        headers=headers,
    )
    assert customer.status_code == 201, customer.text
    customer_id = customer.json()["id"]

    sale = client.post(
        "/api/v1/sales",
        json={
            "store_id": store_id,
            "customer_id": customer_id,
            "items": [{"variant_id": variant_id, "quantity": "2"}],
            "payments": [{"method": "cash", "amount": "1500"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert sale.status_code == 201, sale.text
    sale_data = sale.json()
    assert sale_data["customer_id"] == customer_id
    assert sale_data["balance_due"] == "2500.00"

    statement = client.get(f"/api/v1/customers/{customer_id}/statement", headers=headers)
    assert statement.status_code == 200, statement.text
    statement_data = statement.json()
    assert statement_data["outstanding_balance"] == "2500.00"
    assert statement_data["total_sales"] == "4000.00"
    assert statement_data["total_payments"] == "1500.00"

    unverified_customer_payment = client.post(
        f"/api/v1/customers/{customer_id}/payments",
        json={"amount": "2500", "method": "mobile_money", "reference": "MPESA-UNVERIFIED"},
        headers=headers,
    )
    assert unverified_customer_payment.status_code == 409, unverified_customer_payment.text

    customer_payment = client.post(
        f"/api/v1/customers/{customer_id}/payments",
        json={"amount": "2500", "method": "cash", "reference": "CUST-001"},
        headers=headers,
    )
    assert customer_payment.status_code == 201, customer_payment.text

    final_statement = client.get(f"/api/v1/customers/{customer_id}/statement", headers=headers)
    assert final_statement.status_code == 200, final_statement.text
    assert final_statement.json()["outstanding_balance"] == "0.00"

    unverified_supplier_payment = client.post(
        f"/api/v1/inventory/suppliers/{supplier_id}/payments",
        json={"amount": "2500", "method": "mobile_money", "purchase_id": purchase_id},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert unverified_supplier_payment.status_code == 409, unverified_supplier_payment.text

    supplier_payment = client.post(
        f"/api/v1/inventory/suppliers/{supplier_id}/payments",
        json={"amount": "2500", "method": "bank", "purchase_id": purchase_id, "reference": "SUP-001"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier_payment.status_code == 201, supplier_payment.text

    supplier_statement = client.get(f"/api/v1/inventory/suppliers/{supplier_id}/statement", headers={**headers, "X-Store-ID": store_id})
    assert supplier_statement.status_code == 200, supplier_statement.text
    supplier_payload = supplier_statement.json()
    assert supplier_payload["total_purchases"] == "4000.00"
    assert supplier_payload["total_payments"] == "2500.00"
    assert supplier_payload["outstanding_balance"] == "1500.00"
