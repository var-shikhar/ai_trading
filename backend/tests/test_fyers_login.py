from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import get_settings
from app.deps import get_fyers
from app.providers.base import ProviderError
from app.providers.fyers import now_ist
from app.services import tokens


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("FYERS_APP_ID", "APP-200")
    monkeypatch.setenv("FYERS_SECRET_KEY", "SECRET")
    monkeypatch.setenv("FRONTEND_URL", "https://trade.example.in")
    get_settings.cache_clear()
    get_fyers.cache_clear()
    from app.main import app

    with TestClient(app, follow_redirects=False) as c:
        yield c
    get_fyers.cache_clear()
    get_settings.cache_clear()


def start_login(client) -> str:
    r = client.get("/api/auth/fyers/login")
    assert r.status_code == 307
    return parse_qs(urlparse(r.headers["location"]).query)["state"][0]


def back(r) -> dict:
    assert r.status_code == 307
    loc = urlparse(r.headers["location"])
    assert f"{loc.scheme}://{loc.netloc}" == "https://trade.example.in"
    return {k: v[0] for k, v in parse_qs(loc.query).items()}


def succeed(monkeypatch):
    async def ok(self, code):
        tokens.save_token("fyers", "TOKEN", now_ist() + timedelta(hours=5))

    monkeypatch.setattr(type(get_fyers()), "exchange_auth_code", ok)


def test_login_then_reload_of_callback_still_reports_success(client, monkeypatch):
    succeed(monkeypatch)
    state = start_login(client)
    first = client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "CODE", "state": state})
    assert back(first) == {"fyers": "ok"}
    again = client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "CODE", "state": state})
    assert back(again) == {"fyers": "ok"}  # reload: not a bare 400 any more


def test_state_survives_a_backend_restart(client, monkeypatch):
    succeed(monkeypatch)
    state = start_login(client)
    db.close_conn()  # as if the server restarted while the user was on Fyers' page
    r = client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "CODE", "state": state})
    assert back(r) == {"fyers": "ok"}


def test_expired_or_unknown_link_explains_what_to_do(client, monkeypatch):
    succeed(monkeypatch)
    state = start_login(client)
    db.get_conn().execute("UPDATE oauth_states SET created = ?", [datetime.now() - timedelta(minutes=20)])
    r = back(client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "CODE", "state": state}))
    assert r["fyers"] == "error" and "expired" in r["reason"]
    r = back(client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "X", "state": "made-up"}))
    assert r["fyers"] == "error"


def test_fyers_rejection_reason_is_shown(client, monkeypatch):
    async def fail(self, code):
        raise ProviderError("Fyers login failed: invalid auth code")

    monkeypatch.setattr(type(get_fyers()), "exchange_auth_code", fail)
    state = start_login(client)
    r = back(client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "OLD", "state": state}))
    assert r == {"fyers": "error", "reason": "Fyers login failed: invalid auth code"}
    # A fresh attempt works normally afterwards.
    succeed(monkeypatch)
    state = start_login(client)
    assert back(client.get("/api/auth/fyers/callback", params={"s": "ok", "auth_code": "NEW", "state": state})) == {"fyers": "ok"}


def test_cancelled_on_fyers_side(client):
    state = start_login(client)
    r = back(client.get("/api/auth/fyers/callback", params={"s": "error", "message": "User cancelled", "state": state}))
    assert r == {"fyers": "error", "reason": "User cancelled"}
