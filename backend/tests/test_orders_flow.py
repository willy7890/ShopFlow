from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"orders-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Order Manager",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Orders Shop {test_id}",
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
    return payload["access_token"], business["id"]


def test_order_lifecycle_invoice_generation_and_sale_conversion():
    token, business_id = _register_owner()
    headers = {"Authorization": f"Bearer {token}", "X-Business-ID": business_id}

    category_response = client.post(
        "/api/v1/catalog/categories",
        json={"name": "Office Supplies"},
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
        json={"name": "Notebook", "category_id": category_id},
        headers=headers,
    )
    assert product_response.status_code == 201, product_response.text
    product_id = product_response.json()["id"]

    variant_response = client.post(
        f"/api/v1/catalog/products/{product_id}/variants",
        json={
            "name": "A5 Notebook",
            "unit_id": unit_id,
            "sku": f"NB-{uuid4().hex[:6].upper()}",
            "barcode": f"{uuid4().int % 1000000000000:013d}",
            "purchase_price": "250",
            "selling_price": "600",
            "low_stock_threshold": "1",
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
        json={"name": "Office Supplier", "phone": "255700000010"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier_response.status_code == 201, supplier_response.text
    supplier_id = supplier_response.json()["id"]

    purchase_response = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "PO-ORDER-1",
            "items": [{"variant_id": variant_id, "quantity": "10", "unit_cost": "250", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert purchase_response.status_code == 201, purchase_response.text
    purchase_id = purchase_response.json()["id"]

    receive_response = client.post(f"/api/v1/inventory/purchases/{purchase_id}/receive", headers={**headers, "X-Store-ID": store_id})
    assert receive_response.status_code == 200, receive_response.text

    order_response = client.post(
        "/api/v1/orders",
        json={
            "store_id": store_id,
            "customer_name": "Jane Customer",
            "customer_phone": "255700000001",
            "note": "Delivery to the office",
            "items": [{"variant_id": variant_id, "quantity": "2"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert order_response.status_code == 201, order_response.text
    order = order_response.json()
    assert order["status"] == "draft"
    assert order["total_amount"] == "1200.00"

    confirm_response = client.post(f"/api/v1/orders/{order['id']}/confirm", headers={**headers, "X-Store-ID": store_id})
    assert confirm_response.status_code == 200, confirm_response.text
    assert confirm_response.json()["status"] == "confirmed"

    prepare_response = client.post(f"/api/v1/orders/{order['id']}/prepare", headers={**headers, "X-Store-ID": store_id})
    assert prepare_response.status_code == 200, prepare_response.text
    assert prepare_response.json()["status"] == "preparing"

    complete_response = client.post(f"/api/v1/orders/{order['id']}/complete", headers={**headers, "X-Store-ID": store_id})
    assert complete_response.status_code == 200, complete_response.text
    assert complete_response.json()["status"] == "fulfilled"

    invoice_response = client.get(f"/api/v1/orders/{order['id']}/invoice", headers={**headers, "X-Store-ID": store_id})
    assert invoice_response.status_code == 200, invoice_response.text
    assert invoice_response.headers["content-type"].startswith("application/pdf")
    assert invoice_response.content.startswith(b"%PDF")

    conversion_response = client.post(f"/api/v1/orders/{order['id']}/convert-to-sale", headers={**headers, "X-Store-ID": store_id})
    assert conversion_response.status_code == 200, conversion_response.text
    converted_order = conversion_response.json()
    assert converted_order["status"] == "converted"
    assert converted_order["converted_sale_id"]

    sale_lookup = client.get(f"/api/v1/sales/{converted_order['converted_sale_id']}", headers={**headers, "X-Store-ID": store_id})
    assert sale_lookup.status_code == 200, sale_lookup.text
    sale = sale_lookup.json()
    assert sale["total_amount"] == "1200.00"
    assert sale["status"] == "credit"
