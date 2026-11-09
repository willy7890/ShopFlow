from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"sync-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Sync Owner",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Sync Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    access_token = response.json()["access_token"]
    business_response = client.get(
        "/api/v1/businesses",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert business_response.status_code == 200, business_response.text
    business = business_response.json()[0]
    return access_token, business["id"]


def test_offline_sync_push_de_dupes_sale_operations():
    access_token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {access_token}", "X-Business-ID": business_id}

    category = client.post("/api/v1/catalog/categories", json={"name": "Sync Items"}, headers=headers)
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]

    unit = client.post("/api/v1/catalog/units", json={"name": "Box", "code": "BOX"}, headers=headers)
    assert unit.status_code == 201, unit.text
    unit_id = unit.json()["id"]

    product = client.post(
        "/api/v1/catalog/products",
        json={"name": "Sync Breakfast", "category_id": category_id},
        headers=headers,
    )
    assert product.status_code == 201, product.text
    product_id = product.json()["id"]

    variant = client.post(
        f"/api/v1/catalog/products/{product_id}/variants",
        json={
            "name": "Large Box",
            "unit_id": unit_id,
            "sku": f"SYNC-{uuid4().hex[:8].upper()}",
            "barcode": f"{uuid4().int % 1000000000000:013d}",
            "purchase_price": "500",
            "selling_price": "1000",
            "low_stock_threshold": "1",
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
        json={"name": "Sync Supplier", "phone": "255700000111"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier.status_code == 201, supplier.text
    supplier_id = supplier.json()["id"]
    purchase = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "SYNC-PO-1",
            "items": [{"variant_id": variant_id, "quantity": "10", "unit_cost": "500", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert purchase.status_code == 201, purchase.text
    purchase_id = purchase.json()["id"]
    receive = client.post(f"/api/v1/inventory/purchases/{purchase_id}/receive", headers={**headers, "X-Store-ID": store_id})
    assert receive.status_code == 200, receive.text

    device = client.post(
        "/api/v1/sync/devices",
        json={"device_name": "offline-phone", "device_type": "ios", "platform": "iPhone"},
        headers=headers,
    )
    assert device.status_code == 201, device.text
    device_id = device.json()["id"]

    payload = {
        "items": [
            {
                "clientId": "sync-client-1",
                "store_id": store_id,
                "items": [{"variantId": variant_id, "qty": "2", "price": "1000"}],
                "payments": [{"method": "cash", "amount": "2000"}],
                "description": "Offline sale",
            }
        ]
    }

    push = client.post(
        "/api/v1/sync/push",
        json=payload,
        headers={**headers, "X-Device-ID": device_id},
    )
    assert push.status_code == 200, push.text
    sync_results = push.json()
    assert len(sync_results) == 1
    assert sync_results[0]["state"] == "synced"

    duplicated = client.post(
        "/api/v1/sync/push",
        json=payload,
        headers={**headers, "X-Device-ID": device_id},
    )
    assert duplicated.status_code == 200, duplicated.text
    assert duplicated.json()[0]["state"] == "synced"

    sales = client.get("/api/v1/sales", headers=headers)
    assert sales.status_code == 200, sales.text
    assert len(sales.json()) == 1

    status = client.get("/api/v1/sync/status", headers={**headers, "X-Device-ID": device_id})
    assert status.status_code == 200, status.text
    status_payload = status.json()
    assert status_payload["total_count"] >= 1

    pull = client.get("/api/v1/sync/pull", headers={**headers, "X-Device-ID": device_id})
    assert pull.status_code == 200, pull.text
    assert len(pull.json()) >= 1
