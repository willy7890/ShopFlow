from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_cors_headers_are_present_on_unhandled_server_errors():
    test_app = FastAPI()

    @test_app.get("/broken")
    def broken_route():
        raise RuntimeError("intentional test exception")

    wrapped_app = CORSMiddleware(
        test_app,
        allow_origins=["http://localhost:8081"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    response = TestClient(wrapped_app, raise_server_exceptions=False).get(
        "/broken", headers={"Origin": "http://localhost:8081"}
    )
    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"
