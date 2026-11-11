from uuid import UUID

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


USER_A = "10000000-0000-0000-0000-000000000001"
USER_B = "10000000-0000-0000-0000-000000000002"


def settings():
    return Settings(_env_file=None, supabase_url="https://auth.example.test", supabase_publishable_key="public-test-key")


@pytest.mark.parametrize("header", [None, "Basic abc", "Bearer"])
def test_missing_or_wrong_credentials_fail_before_remote_call(monkeypatch, header):
    async def forbidden(*args, **kwargs):
        pytest.fail("Missing credentials must not contact Auth")
    monkeypatch.setattr(httpx.AsyncClient, "get", forbidden)
    with TestClient(create_app(settings())) as client:
        response = client.get("/api/auth/me", headers={"Authorization": header} if header else {})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


def test_remote_verified_identity_overrides_client_claims(monkeypatch):
    async def verify(_client, url, *, headers):
        assert url == "https://auth.example.test/auth/v1/user"
        assert headers["apikey"] == "public-test-key"
        user_id = USER_A if headers["Authorization"] == "Bearer user-a-token" else USER_B
        return httpx.Response(200, json={"id": user_id, "email": "learner@example.invalid", "role": "authenticated", "user_metadata": {"id": USER_B, "role": "admin"}})
    monkeypatch.setattr(httpx.AsyncClient, "get", verify)
    with TestClient(create_app(settings())) as client:
        for token, expected_id in [("user-a-token", USER_A), ("user-b-token", USER_B)]:
            response = client.get(f"/api/auth/me?user_id={USER_B}", headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 200
            assert response.json() == {"id": expected_id, "email": "learner@example.invalid"}
            assert UUID(response.json()["id"])
            assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("upstream,expected", [(401, 401), (403, 401), (429, 503), (500, 503)])
def test_rejected_or_unavailable_auth_never_authenticates(monkeypatch, upstream, expected):
    async def verify(*args, **kwargs):
        return httpx.Response(upstream, json={"message": "internal provider information"})
    monkeypatch.setattr(httpx.AsyncClient, "get", verify)
    with TestClient(create_app(settings())) as client:
        response = client.get("/api/auth/me", headers={"Authorization": "Bearer forged-or-expired-token"})
        assert response.status_code == expected
        assert "internal provider information" not in response.text


def test_timeout_is_recoverable_without_leaking_token(monkeypatch):
    async def verify(*args, **kwargs):
        raise httpx.ReadTimeout("sensitive upstream details")
    monkeypatch.setattr(httpx.AsyncClient, "get", verify)
    with TestClient(create_app(settings())) as client:
        response = client.get("/api/auth/me", headers={"Authorization": "Bearer private-token"})
        assert response.status_code == 503
        assert "private-token" not in response.text
        assert "sensitive" not in response.text


@pytest.mark.parametrize("payload,expected", [({"id": "invalid", "role": "authenticated"}, 503), ({"id": USER_A, "role": "service_role"}, 401), ({"id": USER_A, "role": "authenticated", "is_anonymous": True}, 401)])
def test_malformed_or_ineligible_user_is_rejected(monkeypatch, payload, expected):
    async def verify(*args, **kwargs):
        return httpx.Response(200, json=payload)
    monkeypatch.setattr(httpx.AsyncClient, "get", verify)
    with TestClient(create_app(settings())) as client:
        assert client.get("/api/auth/me", headers={"Authorization": "Bearer test"}).status_code == expected


def test_unconfigured_auth_does_not_break_public_health():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/auth/me", headers={"Authorization": "Bearer test"}).status_code == 503
