import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.services import accounts


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    get_settings.cache_clear()
    accounts.reset_throttle()
    from app.main import app

    with TestClient(app) as c:
        accounts.create_user("owner", "correct horse battery")
        yield c
    get_settings.cache_clear()


def test_password_hashing():
    h = accounts.hash_password("s3cret-pass")
    assert h.startswith("scrypt$") and "s3cret" not in h
    assert accounts.verify_password("s3cret-pass", h)
    assert not accounts.verify_password("wrong", h)
    assert accounts.hash_password("s3cret-pass") != h  # salted


def test_api_requires_login(client):
    assert client.get("/api/watchlists").status_code == 401
    assert client.get("/api/session/me").status_code == 401
    assert client.get("/api/health").status_code == 200  # public


def test_login_logout_flow(client):
    bad = client.post("/api/session/login", json={"username": "owner", "password": "nope"})
    assert bad.status_code == 401

    ok = client.post("/api/session/login", json={"username": "OWNER", "password": "correct horse battery"})
    assert ok.status_code == 200
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert client.get("/api/session/me").json()["username"] == "owner"
    assert client.get("/api/watchlists").status_code == 200

    client.post("/api/session/logout")
    assert client.get("/api/watchlists").status_code == 401


def test_session_token_not_stored_in_plain_text(client):
    client.post("/api/session/login", json={"username": "owner", "password": "correct horse battery"})
    token = client.cookies.get(accounts.SESSION_COOKIE)
    from app.db import get_conn

    stored = [r[0] for r in get_conn().execute("SELECT token_hash FROM sessions").fetchall()]
    assert token and token not in stored and len(stored) == 1


def test_repeated_failures_are_throttled(client):
    for _ in range(accounts.MAX_FAILURES):
        client.post("/api/session/login", json={"username": "owner", "password": "wrong"})
    locked = client.post("/api/session/login", json={"username": "owner", "password": "correct horse battery"})
    assert locked.status_code == 429


def test_password_change_signs_out_sessions(client):
    client.post("/api/session/login", json={"username": "owner", "password": "correct horse battery"})
    assert client.get("/api/session/me").status_code == 200
    accounts.set_password("owner", "a whole new password")
    assert client.get("/api/session/me").status_code == 401


def test_live_socket_requires_login(client):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/live") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_user_validation():
    with pytest.raises(ValueError):
        accounts.create_user("x", "short")
    accounts.create_user("someone", "long enough pass")
    with pytest.raises(ValueError):
        accounts.create_user("Someone", "another long pass")  # usernames are case-insensitive
