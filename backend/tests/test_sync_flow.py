from datetime import datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from auth_test_support import register_verified_account

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"sync-{test_id}@example.com"
    session, _ = register_verified_account(
        client,
        full_name="Sync Owner",
        email=email,
        password="StrongPass123!",
        business_name=f"Sync Shop {test_id}",
    )
    access_token = session["access_token"]
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
    assert device.json()["last_sync_at"] is None
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

    re_registered_device = client.post(
        "/api/v1/sync/devices",
        json={"device_name": "offline-phone", "device_type": "ios", "platform": "iPhone"},
        headers=headers,
    )
    assert re_registered_device.status_code == 201, re_registered_device.text
    assert re_registered_device.json()["id"] == device_id
    assert datetime.fromisoformat(re_registered_device.json()["last_sync_at"])

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


def test_offline_sync_pushes_accounts_and_cashbook_idempotently_without_receiving_stock():
    access_token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {access_token}", "X-Business-ID": business_id}
    store = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert store.status_code == 200, store.text
    store_id = store.json()[0]["id"]
    device = client.post(
        "/api/v1/sync/devices",
        json={"device_name": "accounts-phone", "device_type": "mobile"},
        headers=headers,
    )
    assert device.status_code == 201, device.text
    sync_headers = {**headers, "X-Device-ID": device.json()["id"]}

    customer_id = str(uuid4())
    supplier_id = str(uuid4())
    customer_payment_id = str(uuid4())
    supplier_bill_id = str(uuid4())
    cashbook_id = str(uuid4())
    payload = {
        "items": [
            {
                "clientId": "offline-customer-1",
                "entity_type": "customer",
                "id": customer_id,
                "storeId": store_id,
                "name": "Offline Customer",
                "phone": "255700000333",
            },
            {
                "clientId": "offline-supplier-1",
                "entity_type": "supplier",
                "id": supplier_id,
                "storeId": store_id,
                "name": "Offline Supplier",
                "phone": "255700000444",
            },
            {
                "clientId": "offline-customer-payment-1",
                "entity_type": "customer_ledger",
                "entryId": customer_payment_id,
                "storeId": store_id,
                "customerId": customer_id,
                "entryType": "payment",
                "amountMinor": 500,
            },
            {
                "clientId": "offline-supplier-bill-1",
                "entity_type": "supplier_ledger",
                "entryId": supplier_bill_id,
                "storeId": store_id,
                "supplierId": supplier_id,
                "entryType": "bill",
                "amountMinor": 2500,
            },
            {
                "clientId": "offline-cashbook-1",
                "entity_type": "cashbook_entry",
                "entryId": cashbook_id,
                "storeId": store_id,
                "entryType": "income",
                "source": "manual",
                "category": "Offline income",
                "amountMinor": 750,
            },
        ]
    }

    pushed = client.post("/api/v1/sync/push", json=payload, headers=sync_headers)
    assert pushed.status_code == 200, pushed.text
    assert [result["state"] for result in pushed.json()] == ["synced"] * 5

    duplicated = client.post("/api/v1/sync/push", json=payload, headers=sync_headers)
    assert duplicated.status_code == 200, duplicated.text
    assert [result["state"] for result in duplicated.json()] == ["synced"] * 5

    statement = client.get(
        f"/api/v1/inventory/suppliers/{supplier_id}/statement",
        headers=headers,
    )
    assert statement.status_code == 200, statement.text
    assert float(statement.json()["total_purchases"]) == 2500
    stock = client.get(
        f"/api/v1/inventory/stock?store_id={store_id}",
        headers=headers,
    )
    assert stock.status_code == 200, stock.text
    assert stock.json() == []

    entries = client.get(
        f"/api/v1/finance/entries?store_id={store_id}",
        headers=headers,
    )
    assert entries.status_code == 200, entries.text
    assert sum(entry["id"] == cashbook_id for entry in entries.json()) == 1

    history = client.get(
        f"/api/v1/customers/{customer_id}/history",
        headers=headers,
    )
    assert history.status_code == 200, history.text
    assert len(history.json()) == 1
    assert float(history.json()[0]["amount"]) == -500
    customer_statement = client.get(
        f"/api/v1/customers/{customer_id}/statement",
        headers=headers,
    )
    assert customer_statement.status_code == 200, customer_statement.text
    assert float(customer_statement.json()["outstanding_balance"]) == -500


def test_failed_sync_operation_can_be_retried_with_the_same_client_id():
    access_token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {access_token}", "X-Business-ID": business_id}
    store = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    store_id = store.json()[0]["id"]
    device = client.post(
        "/api/v1/sync/devices",
        json={"device_name": "retry-phone", "device_type": "mobile"},
        headers=headers,
    )
    sync_headers = {**headers, "X-Device-ID": device.json()["id"]}
    client_id = "offline-customer-retry"
    payload = {
        "items": [{
            "clientId": client_id,
            "entity_type": "customer",
            "id": str(uuid4()),
            "storeId": store_id,
            "name": "",
        }]
    }

    failed = client.post("/api/v1/sync/push", json=payload, headers=sync_headers)
    assert failed.status_code == 200, failed.text
    assert failed.json()[0]["state"] == "failed"

    payload["items"][0]["name"] = "Recovered Customer"
    retried = client.post("/api/v1/sync/push", json=payload, headers=sync_headers)
    assert retried.status_code == 200, retried.text
    assert retried.json()[0]["state"] == "synced"


def test_offline_account_updates_and_archives_sync_idempotently():
    access_token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {access_token}", "X-Business-ID": business_id}
    store = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert store.status_code == 200, store.text
    store_id = store.json()[0]["id"]
    customer = client.post("/api/v1/customers", json={"name": "Before Customer"}, headers=headers)
    assert customer.status_code == 201, customer.text
    supplier = client.post(
        "/api/v1/inventory/suppliers",
        json={"name": "Before Supplier"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier.status_code == 201, supplier.text
    device = client.post(
        "/api/v1/sync/devices",
        json={"device_name": "account-update-phone", "device_type": "mobile"},
        headers=headers,
    )
    sync_headers = {**headers, "X-Device-ID": device.json()["id"]}

    update_payload = {
        "items": [
            {
                "clientId": "customer-update-1",
                "entity_type": "customer_update",
                "id": customer.json()["id"],
                "storeId": store_id,
                "name": "Updated Customer",
                "isActive": False,
            },
            {
                "clientId": "supplier-update-1",
                "entity_type": "supplier_update",
                "id": supplier.json()["id"],
                "storeId": store_id,
                "name": "Updated Supplier",
                "isActive": False,
            },
        ]
    }
    pushed = client.post("/api/v1/sync/push", json=update_payload, headers=sync_headers)
    assert pushed.status_code == 200, pushed.text
    assert [item["state"] for item in pushed.json()] == ["synced", "synced"]
    duplicated = client.post("/api/v1/sync/push", json=update_payload, headers=sync_headers)
    assert duplicated.status_code == 200, duplicated.text
    assert [item["state"] for item in duplicated.json()] == ["synced", "synced"]
    assert client.get("/api/v1/customers", headers=headers).json() == []
    assert client.get("/api/v1/inventory/suppliers", headers=headers).json() == []

    restore_payload = {
        "items": [
            {
                "clientId": "customer-update-2",
                "entity_type": "customer_update",
                "id": customer.json()["id"],
                "storeId": store_id,
                "isActive": True,
            },
            {
                "clientId": "supplier-update-2",
                "entity_type": "supplier_update",
                "id": supplier.json()["id"],
                "storeId": store_id,
                "isActive": True,
            },
        ]
    }
    restored = client.post("/api/v1/sync/push", json=restore_payload, headers=sync_headers)
    assert restored.status_code == 200, restored.text
    assert [item["state"] for item in restored.json()] == ["synced", "synced"]
    assert client.get(f"/api/v1/customers/{customer.json()['id']}", headers=headers).json()["name"] == "Updated Customer"
    assert client.get("/api/v1/inventory/suppliers", headers=headers).json()[0]["name"] == "Updated Supplier"
