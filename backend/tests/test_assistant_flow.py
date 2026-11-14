import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.modules.assistant import router as assistant_router
from auth_test_support import register_verified_account

client = TestClient(app)


def _register_owner():
    test_id = uuid4().hex
    session, _ = register_verified_account(
        client,
        full_name="Assistant Owner",
        email=f"assistant-{test_id}@example.com",
        password="StrongPass123!",
        business_name=f"Assistant Shop {test_id}",
    )
    return session


def _business_headers(payload, business_id: str):
    headers = {
        "Authorization": f"Bearer {payload['access_token']}",
        "X-Business-ID": business_id,
    }
    stores = client.get(f"/api/v1/businesses/{business_id}/stores", headers=headers)
    assert stores.status_code == 200, stores.text
    headers["X-Store-ID"] = stores.json()[0]["id"]
    return headers


def test_assistant_requires_server_provider_configuration(monkeypatch):
    monkeypatch.setattr(settings, "AI_API_BASE_URL", "")
    monkeypatch.setattr(settings, "AI_API_KEY", "")
    monkeypatch.setattr(settings, "AI_MODEL", "")
    owner = _register_owner()
    business_id = client.get("/api/v1/businesses", headers={
        "Authorization": f"Bearer {owner['access_token']}",
    }).json()[0]["id"]
    headers = _business_headers(owner, business_id)

    response = client.post(
        "/api/v1/assistant/ask",
        headers=headers,
        json={"question": "How are sales?", "language": "en"},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "The business assistant provider is not configured."


def test_assistant_rejects_store_from_another_business():
    first_owner = _register_owner()
    second_owner = _register_owner()
    first_business = client.get("/api/v1/businesses", headers={
        "Authorization": f"Bearer {first_owner['access_token']}",
    }).json()[0]["id"]
    second_business = client.get("/api/v1/businesses", headers={
        "Authorization": f"Bearer {second_owner['access_token']}",
    }).json()[0]["id"]
    first_headers = _business_headers(first_owner, first_business)
    second_headers = _business_headers(second_owner, second_business)
    first_headers["X-Store-ID"] = second_headers["X-Store-ID"]

    response = client.post(
        "/api/v1/assistant/ask",
        headers=first_headers,
        json={"question": "How are sales?", "language": "en"},
    )

    assert response.status_code == 404


def test_assistant_sends_only_store_aggregates_to_configured_provider(monkeypatch):
    monkeypatch.setattr(settings, "AI_API_BASE_URL", "https://assistant.example/v1")
    monkeypatch.setattr(settings, "AI_API_KEY", "test-provider-key")
    monkeypatch.setattr(settings, "AI_MODEL", "test-model")
    owner = _register_owner()
    business_id = client.get("/api/v1/businesses", headers={
        "Authorization": f"Bearer {owner['access_token']}",
    }).json()[0]["id"]
    headers = _business_headers(owner, business_id)
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _limit):
            return b'{"choices":[{"message":{"content":"Sales are recorded."}}]}'

    def fake_urlopen(request, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(assistant_router, "urlopen", fake_urlopen)
    response = client.post(
        "/api/v1/assistant/ask",
        headers=headers,
        json={"question": "How are sales?", "language": "en"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["answer"] == "Sales are recorded."
    assert response.json()["store_id"] == headers["X-Store-ID"]
    assert captured["timeout"] == settings.AI_TIMEOUT_SECONDS
    request_payload = json.loads(captured["request"].data)
    user_message = json.loads(request_payload["messages"][1]["content"])
    assert user_message["question"] == "How are sales?"
    assert set(user_message["facts"]) == {
        "sales_total_last_30_days",
        "sale_count_last_30_days",
        "cashbook_income_all_time",
        "cashbook_expense_all_time",
        "low_stock_variant_count",
    }
