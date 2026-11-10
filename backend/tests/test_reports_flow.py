from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"reports-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Reports Manager",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Reports Shop {test_id}",
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


def test_reports_dashboard_sales_profit_inventory_and_exports():
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
        json={"name": "Office Supplier", "phone": "255700000020"},
        headers={**headers, "X-Store-ID": store_id},
    )
    assert supplier_response.status_code == 201, supplier_response.text
    supplier_id = supplier_response.json()["id"]

    purchase_response = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "PO-REPORT-1",
            "items": [{"variant_id": variant_id, "quantity": "10", "unit_cost": "250", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert purchase_response.status_code == 201, purchase_response.text
    purchase_id = purchase_response.json()["id"]

    receive_response = client.post(f"/api/v1/inventory/purchases/{purchase_id}/receive", headers={**headers, "X-Store-ID": store_id})
    assert receive_response.status_code == 200, receive_response.text

    draft_purchase = client.post(
        "/api/v1/inventory/purchases",
        json={
            "store_id": store_id,
            "supplier_id": supplier_id,
            "reference_number": "PO-REPORT-DRAFT",
            "items": [{"variant_id": variant_id, "quantity": "1", "unit_cost": "900", "conversion_factor": "1"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert draft_purchase.status_code == 201, draft_purchase.text

    sale_response = client.post(
        "/api/v1/sales",
        json={
            "store_id": store_id,
            "customer_name": "Walk-in Customer",
            "items": [{"variant_id": variant_id, "quantity": "2"}],
            "payments": [{"method": "cash", "amount": "1200"}],
        },
        headers={**headers, "X-Store-ID": store_id},
    )
    assert sale_response.status_code == 201, sale_response.text
    sale = sale_response.json()
    assert sale["total_amount"] == "1200.00"

    variant_update = client.put(
        f"/api/v1/catalog/products/{product_id}/variants/{variant_id}",
        json={
            "name": "A5 Notebook",
            "unit_id": unit_id,
            "sku": variant_response.json()["sku"],
            "barcode": variant_response.json()["barcode"],
            "purchase_price": "900",
            "selling_price": "600",
            "low_stock_threshold": "1",
            "track_stock": True,
        },
        headers=headers,
    )
    assert variant_update.status_code == 200, variant_update.text

    expense_response = client.post(
        "/api/v1/finance/entries",
        json={
            "store_id": store_id,
            "entry_type": "expense",
            "direction": "out",
            "amount": "300",
            "category": "operations",
            "note": "Utility bill",
        },
        headers=headers,
    )
    assert expense_response.status_code == 201, expense_response.text

    sales_report = client.get(
        "/api/v1/reports/sales",
        params={"store_id": store_id},
        headers=headers,
    )
    assert sales_report.status_code == 200, sales_report.text
    assert sales_report.json()["total_sales"] == "1200.00"
    assert sales_report.json()["total_transactions"] == 1

    profit_report = client.get(
        "/api/v1/reports/profit",
        params={"store_id": store_id},
        headers=headers,
    )
    assert profit_report.status_code == 200, profit_report.text
    assert profit_report.json()["gross_revenue"] == "1200.00"
    assert profit_report.json()["cost_of_goods_sold"] == "500.00"
    assert profit_report.json()["gross_profit"] == "700.00"

    refund_response = client.post(
        f"/api/v1/sales/{sale['id']}/refund",
        json={
            "reason": "One notebook returned",
            "items": [{"variant_id": variant_id, "quantity": "1"}],
        },
        headers=headers,
    )
    assert refund_response.status_code == 200, refund_response.text
    refunded_profit = client.get(
        "/api/v1/reports/profit",
        params={"store_id": store_id},
        headers=headers,
    )
    assert refunded_profit.status_code == 200, refunded_profit.text
    assert refunded_profit.json()["cost_of_goods_sold"] == "250.00"
    assert refunded_profit.json()["gross_profit"] == "950.00"

    inventory_report = client.get(
        "/api/v1/reports/inventory",
        params={"store_id": store_id},
        headers=headers,
    )
    assert inventory_report.status_code == 200, inventory_report.text
    assert inventory_report.json()["total_variants"] >= 1

    dashboard = client.get(
        "/api/v1/reports/dashboard",
        params={"store_id": store_id},
        headers=headers,
    )
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["sales"]["total_sales"] == "1200.00"
    assert dashboard.json()["store_performance"][0]["store_id"] == store_id
    assert dashboard.json()["store_performance"][0]["net_cash"] == "900.00"
    assert dashboard.json()["suppliers"]["total_payables"] == "2500.00"

    csv_report = client.get(
        "/api/v1/reports/export/csv",
        params={"report": "sales", "store_id": store_id},
        headers=headers,
    )
    assert csv_report.status_code == 200, csv_report.text
    assert csv_report.headers["content-type"].startswith("text/csv")

    pdf_report = client.get(
        "/api/v1/reports/export/pdf",
        params={"report": "sales", "store_id": store_id},
        headers=headers,
    )
    assert pdf_report.status_code == 200, pdf_report.text
    assert pdf_report.headers["content-type"].startswith("application/pdf")
