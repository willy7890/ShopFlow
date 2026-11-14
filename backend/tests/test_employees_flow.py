from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from auth_test_support import register_verified_account

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    email = f"owner-{test_id}@example.com"
    session, _ = register_verified_account(
        client,
        full_name="Owner User",
        email=email,
        password="StrongPass123!",
        business_name=f"Employee Shop {test_id}",
    )
    token = session["access_token"]
    business_response = client.get(
        "/api/v1/businesses",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert business_response.status_code == 200, business_response.text
    business = business_response.json()[0]
    return token, business["id"]


def test_employee_management_and_store_access():
    owner_token, business_id = _register_owner()
    owner_headers = {"Authorization": f"Bearer {owner_token}", "X-Business-ID": business_id}

    store_response = client.get(f"/api/v1/businesses/{business_id}/stores", headers=owner_headers)
    assert store_response.status_code == 200, store_response.text
    first_store = store_response.json()[0]
    second_store = client.post(
        f"/api/v1/businesses/{business_id}/stores",
        json={"name": "Warehouse", "code": "WHR", "address": "Kisutu"},
        headers=owner_headers,
    )
    assert second_store.status_code == 201, second_store.text
    second_store_id = second_store.json()["id"]

    team_member_email = f"employee-{uuid4().hex}@example.com"
    employee_session, _ = register_verified_account(
        client,
        full_name="Cashier User",
        email=team_member_email,
        password="StrongPass123!",
        business_name=f"Team Member Business {uuid4().hex}",
    )
    employee_token = employee_session["access_token"]

    invite = client.post(
        "/api/v1/employees/invite",
        json={
            "email": team_member_email,
            "role": "cashier",
            "store_ids": [first_store["id"], second_store_id],
            "permissions": ["manage_sales", "view_dashboard"],
        },
        headers=owner_headers,
    )
    assert invite.status_code == 201, invite.text
    invited_employee = invite.json()
    assert invited_employee["role"] == "cashier"
    assert set(invited_employee["store_access"]) == {first_store["id"], second_store_id}
    assert set(invited_employee["permissions"]) == {"manage_sales", "view_dashboard"}

    employees = client.get("/api/v1/employees", headers=owner_headers)
    assert employees.status_code == 200, employees.text
    employee_payload = employees.json()
    assert any(employee["email"] == team_member_email for employee in employee_payload)

    employee_headers = {"Authorization": f"Bearer {employee_token}", "X-Business-ID": business_id}
    employee_member = next(item for item in employee_payload if item["email"] == team_member_email)
    employee_self_lookup = client.get(f"/api/v1/employees/{employee_member['id']}", headers=employee_headers)
    assert employee_self_lookup.status_code == 200, employee_self_lookup.text
    assert employee_self_lookup.json()["email"] == team_member_email
    patch_response = client.patch(
        f"/api/v1/employees/{employee_member['id']}",
        json={
            "role": "store_manager",
            "store_ids": [first_store["id"]],
            "permissions": ["manage_inventory", "manage_sales", "view_reports"],
        },
        headers=owner_headers,
    )
    assert patch_response.status_code == 200, patch_response.text
    patched = patch_response.json()
    assert patched["role"] == "store_manager"
    assert patched["store_access"] == [first_store["id"]]
    assert set(patched["permissions"]) == {"manage_inventory", "manage_sales", "view_reports"}

    business_access = client.get(
        "/api/v1/businesses/access",
        headers={"Authorization": f"Bearer {employee_token}"},
    )
    assert business_access.status_code == 200, business_access.text
    employee_access = next(item for item in business_access.json() if item["business_id"] == business_id)
    assert employee_access["store_ids"] == [first_store["id"]]
    assert [store["id"] for store in employee_access["stores"]] == [first_store["id"]]
    assert set(employee_access["permissions"]) == {"manage_inventory", "manage_sales", "view_reports"}

    access_check = client.get(
        "/api/v1/inventory/stock",
        params={"store_id": second_store_id},
        headers=employee_headers,
    )
    assert access_check.status_code == 403, access_check.text


def test_employee_permissions_can_be_granted_and_manager_scope_is_limited():
    owner_token, business_id = _register_owner()
    owner_headers = {"Authorization": f"Bearer {owner_token}", "X-Business-ID": business_id}
    stores = client.get(f"/api/v1/businesses/{business_id}/stores", headers=owner_headers)
    assert stores.status_code == 200, stores.text
    store_id = stores.json()[0]["id"]

    manager_email = f"manager-{uuid4().hex}@example.com"
    manager_session, _ = register_verified_account(
        client,
        full_name="Access Manager",
        email=manager_email,
        password="StrongPass123!",
        business_name=f"Manager Business {uuid4().hex}",
    )
    manager_token = manager_session["access_token"]
    manager_invite = client.post(
        "/api/v1/employees/invite",
        json={
            "email": manager_email,
            "role": "manager",
            "store_ids": [store_id],
            "permissions": ["manage_employees", "manage_sales", "view_reports"],
        },
        headers=owner_headers,
    )
    assert manager_invite.status_code == 201, manager_invite.text
    manager_headers = {"Authorization": f"Bearer {manager_token}", "X-Business-ID": business_id}

    employee_email = f"staff-{uuid4().hex}@example.com"
    register_verified_account(
        client,
        full_name="Shop Employee",
        email=employee_email,
        password="StrongPass123!",
        business_name=f"Staff Business {uuid4().hex}",
    )
    invited = client.post(
        "/api/v1/employees/invite",
        json={
            "email": employee_email,
            "role": "cashier",
            "store_ids": [store_id],
            "permissions": ["manage_sales"],
        },
        headers=owner_headers,
    )
    assert invited.status_code == 201, invited.text
    employee_id = invited.json()["id"]

    denied = client.patch(
        f"/api/v1/employees/{employee_id}",
        json={"permissions": ["manage_finance"]},
        headers=manager_headers,
    )
    assert denied.status_code == 403, denied.text

    granted = client.patch(
        f"/api/v1/employees/{employee_id}",
        json={"permissions": ["view_reports", "manage_sales"]},
        headers=manager_headers,
    )
    assert granted.status_code == 200, granted.text
    assert set(granted.json()["permissions"]) == {"view_reports", "manage_sales"}

    deactivated = client.patch(
        f"/api/v1/employees/{employee_id}",
        json={"is_active": False},
        headers=owner_headers,
    )
    assert deactivated.status_code == 200, deactivated.text
    listed = client.get("/api/v1/employees", headers=owner_headers)
    assert listed.status_code == 200, listed.text
    inactive = next(item for item in listed.json() if item["id"] == employee_id)
    assert inactive["is_active"] is False
