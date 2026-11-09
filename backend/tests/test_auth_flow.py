from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_register_and_me():
    test_id = uuid4().hex
    email = f"owner-{test_id}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={
            "full_name": "Test Owner",
            "email": email,
            "password": "StrongPass123!",
            "business_name": f"Test Shop {test_id}",
        },
    )
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["access_token"]
    assert data["refresh_token"]
    authorization = {"Authorization": f"Bearer {data['access_token']}"}
    me = client.get("/api/v1/auth/me", headers=authorization)
    assert me.status_code == 200
    assert me.json()["email"] == email
    access = client.get("/api/v1/businesses/access", headers=authorization)
    assert access.status_code == 200
    assert len(access.json()) == 1
    assert access.json()[0]["role"] == "owner"
    assert len(access.json()[0]["stores"]) == 1
    assert access.json()[0]["store_ids"] == [access.json()[0]["stores"][0]["id"]]
