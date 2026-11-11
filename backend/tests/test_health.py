from fastapi.testclient import TestClient
from app.main import create_app
from app.config import Settings


def test_health_contract():
    with TestClient(create_app()) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "learnquest-api"}


def test_cors_only_permits_configured_origin():
    with TestClient(create_app(Settings(cors_origins=["http://localhost:5173"]))) as client:
        allowed = client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
        denied = client.get("/api/health", headers={"Origin": "https://untrusted.example"})
        assert "access-control-allow-origin" not in denied.headers


def test_unimplemented_routes_do_not_expose_data():
    with TestClient(create_app()) as client:
        assert client.get("/api/documents").status_code == 404
