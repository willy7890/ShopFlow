from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"operator-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Sales Clerk",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Sales Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    businesses = client.get(
        "/api/v1/businesses",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert businesses.status_code == 200, businesses.text
    business = businesses.json()[0]
    return payload["access_token"], business["id"], business["name"]


def test_sales_flow_creates_and_refunds_inventory_adjusted_sales():
    token, business_id, _ = _register_owner()
    headers = {"Authorization": f"Bearer {token}", "X-Business-ID": business_id}

    category_response = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Beverages"},
        headers=headers,
    )
    assert category_response.status_code == 201, category_response.text
    category_id = category_response.json()["id"]

    unit_response = client.post(
        "/api/v1/catalog/units",
        json={"name": "Pieces", "code": "PCS"},
        headers=headers,
    )
    assert unit_response.status_code == 201, unit_response.text
    unit_id = unit_response.json()["id"]

    product_response = client.post(
        "/api/v1/catalog/products",
        json={"name": "Coca Cola", "category_id": category_id},
        headers=headers,
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    variant_response = client.post(
        f"/api/v1/catalog/products/{product_id}/variants",
        json={
            "name": "330ml Bottle",
            "unit_id": unit_id,
            "sku": f"CC-{uuid4().hex[:6].upper()}",
            "barcode": f"{uuid4().int % 1000000000000:013d}",
            "purchase_price": "1200",
            "selling_price": "2000",
            "low_stock_threshold": "2",
            "track_stock": True,
        },
        headers=headers,
    )
    assert variant_response.status_code == 201, variant_response.text
    variant_id = variant_response.json()["id"]

    store_response = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert store_response.status_code == 200, store_response.text
    store_id = store_response.json()[0]["id"]

    supplier_response = client.post(
        "/api/v1/inventory/suppliers",
        json={"name": "Supplier One", "phone": "255700000000"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier_response.status_code == 201, supplier_response.text
    supplier_id = supplier_response.json()["id"]

    purchase_response = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "PO-1001",
            "items": [{"variant_id": variant_id, "quantity": "5", "unit_cost": "1200", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert purchase_response.status_code == 201, purchase_response.text
    purchase_id = purchase_response.json()["id"]

    receive_response = client.post(
        f"/api/v1/inventory/purchases/{purchase_id}/receive",
        headers={**headers, "X-Store-ID": store_id},
    )
    assert receive_response.status_code == 200, receive_response.text

    unverified_mobile_money = client.post(
        "/api/v1/sales",
        json={
            "store_id": store_id,
            "customer_name": "Walk-in Customer",
            "items": [{"variant_id": variant_id, "quantity": "2"}],
            "payments": [{"method": "mobile_money", "amount": "4000"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert unverified_mobile_money.status_code == 409, unverified_mobile_money.text

    sale_response = client.post(
        "/api/v1/sales",
        json={
            "store_id": store_id,
            "customer_name": "Walk-in Customer",
            "items": [{"variant_id": variant_id, "quantity": "2"}],
            "payments": [{"method": "cash", "amount": "4000"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert sale_response.status_code == 201, sale_response.text
    sale = sale_response.json()
    assert sale["total_amount"] == "4000.00"
    assert sale["balance_due"] == "0.00"
    assert sale["status"] == "completed"
    assert len(sale["items"]) == 1

    receipt = client.get(f"/api/v1/sales/{sale['id']}/receipt", headers=headers)
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["sale_number"]
    assert receipt.json()["total_amount"] == "4000.00"

    stock_response = client.get(
        "/api/v1/inventory/stock",
        params={"store_id": store_id},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert stock_response.status_code == 200, stock_response.text
    balances = stock_response.json()
    stock_value = next(item for item in balances if item["variant_id"] == variant_id)
    assert stock_value["quantity"] == "3.000" or stock_value["quantity"] == "3.0" or stock_value["quantity"] == "3"

    refund_response = client.post(
        f"/api/v1/sales/{sale['id']}/refund",
        json={"reason": "Customer changed mind", "amount": "2000.00", "items": [{"variant_id": variant_id, "quantity": "1"}]},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert refund_response.status_code == 200, refund_response.text
    refund = refund_response.json()
    assert refund["refund_amount"] == "2000.00"
    assert refund["status"] in {"partial", "completed", "refunded"}

    final_sale = client.get(f"/api/v1/sales/{sale['id']}", headers={**headers, "X-Store-ID": store_id})
    assert final_sale.status_code == 200, final_sale.text
    final_payload = final_sale.json()
    assert final_payload["status"] in {"partial", "completed", "refunded"}
