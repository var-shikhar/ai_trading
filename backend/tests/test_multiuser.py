from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import store
from app.config import get_settings
from app.services import accounts

PW = "correct horse battery"


@pytest.fixture
def app_(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    get_settings.cache_clear()
    from app.main import app

    with TestClient(app):
        accounts.create_user("boss", PW, role="admin")
        yield app
    get_settings.cache_clear()


def signed_in(app, username, password=PW) -> TestClient:
    c = TestClient(app)
    assert c.post("/api/session/login", json={"username": username, "password": password}).status_code == 200
    return c


def invite(admin: TestClient, **kw) -> str:
    r = admin.post("/api/admin/invites", json=kw)
    assert r.status_code == 200, r.text
    return r.json()["code"]


def test_signup_only_with_a_valid_invite(app_):
    admin = signed_in(app_, "boss")
    anon = TestClient(app_)
    assert anon.post("/api/session/signup", json={"code": "nope", "username": "asha", "password": PW}).status_code == 404

    code = invite(admin, note="Asha")
    assert anon.get("/api/session/invite", params={"code": code}).json()["role"] == "user"
    r = anon.post("/api/session/signup", json={"code": code, "username": "Asha", "password": PW})
    assert r.status_code == 200 and r.json()["username"] == "asha" and r.json()["created_by"] == "boss"
    assert anon.get("/api/session/me").json()["username"] == "asha"  # signed in right away

    again = TestClient(app_).post("/api/session/signup", json={"code": code, "username": "evil", "password": PW})
    assert again.status_code == 404  # one-time
    listed = {i["prefix"]: i for i in admin.get("/api/admin/invites").json()}
    assert listed[code[:6]]["status"] == "used" and listed[code[:6]]["used_by"] == "asha"
    assert "code" not in listed[code[:6]]  # never shown again


def test_invite_email_lock_expiry_and_revoke(app_):
    admin = signed_in(app_, "boss")
    anon = TestClient(app_)
    code = invite(admin, email="ravi@example.com")
    wrong = anon.post("/api/session/signup", json={"code": code, "username": "ravi", "password": PW, "email": "x@y.io"})
    assert wrong.status_code == 400
    ok = anon.post("/api/session/signup", json={"code": code, "username": "ravi", "password": PW})
    assert ok.json()["email"] == "ravi@example.com"

    old = invite(admin)
    with store.tx() as c:
        c.execute(store.invites.update().values(expires=store.now() - timedelta(minutes=1)).where(
            store.invites.c.prefix == old[:6]))
    assert anon.post("/api/session/signup", json={"code": old, "username": "late", "password": PW}).status_code == 404

    revoked = invite(admin)
    inv_id = next(i["id"] for i in admin.get("/api/admin/invites").json() if i["prefix"] == revoked[:6])
    assert admin.delete(f"/api/admin/invites/{inv_id}").status_code == 200
    assert anon.post("/api/session/signup", json={"code": revoked, "username": "nope2", "password": PW}).status_code == 404

    user = signed_in(app_, "ravi")
    assert user.post("/api/admin/invites", json={}).status_code == 403  # admins only


def test_each_user_sees_only_their_own_data(app_):
    accounts.create_user("asha", PW)
    accounts.create_user("ravi", PW)
    asha, ravi = signed_in(app_, "asha"), signed_in(app_, "ravi")

    wl = asha.post("/api/watchlists", json={"name": "Asha's list"}).json()
    asha.put("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}, json={"drawings": [{"id": "d1"}]})
    alert = {"kind": "price", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "config": {"op": "above", "value": 1}}
    asha.post("/api/alerts", json=alert)

    assert [w["name"] for w in asha.get("/api/watchlists").json()] == ["Asha's list"]
    assert ravi.get("/api/watchlists").json() == []
    assert ravi.get("/api/drawings", params={"symbol": "NSE:SBIN-EQ"}).json() == {"drawings": []}
    assert ravi.get("/api/alerts").json()["alerts"] == []
    assert ravi.put(f"/api/watchlists/{wl['id']}", json={"name": "hijack"}).status_code == 404
    ravi.delete(f"/api/watchlists/{wl['id']}")  # no effect on someone else's list
    assert len(asha.get("/api/watchlists").json()) == 1
    universes = [u["id"] for u in ravi.get("/api/scanner/catalog").json()["universes"]]
    assert f"watchlist:{wl['id']}" not in universes


def test_only_admins_control_the_shared_fyers_connection(app_):
    accounts.create_user("asha", PW)
    user = signed_in(app_, "asha")
    assert user.get("/api/auth/status").status_code == 200  # everyone can see if data is live
    assert user.get("/api/auth/fyers/login", follow_redirects=False).status_code == 403
    assert user.post("/api/auth/fyers/logout").status_code == 403


def test_api_keys_for_agents(app_):
    accounts.create_user("asha", PW)
    asha = signed_in(app_, "asha")
    key = asha.post("/api/session/api-keys", json={"name": "my agent"}).json()["key"]
    assert key.startswith("ik_")

    agent = TestClient(app_, headers={"Authorization": f"Bearer {key}"})
    assert agent.get("/api/session/me").json()["username"] == "asha"
    sig = agent.post("/api/signals", json={"symbol": "NSE:SBIN-EQ", "direction": "long", "confidence": 0.8,
                                          "reason": "breakout + volume", "payload": {"model": "test"}})
    assert sig.status_code == 200 and sig.json()["source"] == "agent" and sig.json()["status"] == "new"
    assert [s["reason"] for s in asha.get("/api/signals").json()] == ["breakout + volume"]
    assert asha.patch(f"/api/signals/{sig.json()['id']}", json={"status": "acted"}).status_code == 200
    assert asha.get("/api/signals", params={"status": "acted"}).json()[0]["id"] == sig.json()["id"]

    key_id = asha.get("/api/session/api-keys").json()[0]["id"]
    asha.delete(f"/api/session/api-keys/{key_id}")
    assert agent.get("/api/session/me").status_code == 401  # revoked
    assert TestClient(app_, headers={"Authorization": "Bearer ik_wrong"}).get("/api/watchlists").status_code == 401


def test_strategies_crud_and_validation(app_):
    accounts.create_user("asha", PW)
    asha, boss = signed_in(app_, "asha"), signed_in(app_, "boss")
    definition = {"tf": "1D", "side": "long", "entry": [{"type": "rsi", "params": {"op": "<", "value": 30}}]}
    s = asha.post("/api/strategies", json={"name": "RSI dip", "definition": definition}).json()
    assert s["owner"] == "asha" and s["definition"]["entry"][0]["type"] == "rsi"
    assert boss.get("/api/strategies").json() == []
    bad = asha.post("/api/strategies", json={"name": "x", "definition": {"entry": [{"type": "magic"}]}})
    assert bad.status_code == 400
    upd = asha.put(f"/api/strategies/{s['id']}", json={"name": "RSI dip v2", "definition": definition})
    assert upd.json()["name"] == "RSI dip v2"
    assert boss.put(f"/api/strategies/{s['id']}", json={"name": "mine", "definition": definition}).status_code == 404


def test_deleting_a_user_removes_their_data(app_):
    accounts.create_user("temp", PW)
    temp = signed_in(app_, "temp")
    temp.post("/api/watchlists", json={"name": "gone soon"})
    admin = signed_in(app_, "boss")
    assert admin.delete("/api/admin/users/temp").status_code == 200
    assert store.rows(store.watchlists.select()) == []


def test_profile_notification_settings(app_):
    accounts.create_user("asha", PW)
    asha = signed_in(app_, "asha")
    r = asha.patch("/api/session/me", json={"telegram_chat_id": "123456789", "set_telegram": True,
                                            "email": "asha@example.com", "set_email": True})
    assert r.json()["telegram_chat_id"] == "123456789" and r.json()["email"] == "asha@example.com"
    bad = asha.patch("/api/session/me", json={"telegram_chat_id": "not-a-number", "set_telegram": True})
    assert bad.status_code == 400
    from app.alerts import notify

    assert notify.recipients("asha") == ("123456789", "asha@example.com")
    assert notify.recipients("boss") == (None, None)  # admin with no profile and no .env fallback


@pytest.mark.anyio
async def test_scanner_can_use_your_own_watchlist_only(app_):
    from app.services import universes

    accounts.create_user("asha", PW)
    asha = signed_in(app_, "asha")
    items = [{"symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "name": "SBI", "kind": "EQ"}]
    wl = asha.post("/api/watchlists", json={"name": "Mine", "items": items}).json()
    got = await universes.members(f"watchlist:{wl['id']}", owner="asha")
    assert [m["symbol"] for m in got] == ["NSE:SBIN-EQ"]
    with pytest.raises(KeyError):
        await universes.members(f"watchlist:{wl['id']}", owner="boss")


def test_cache_trim_keeps_daily_and_recent_intraday(app_):
    from datetime import date, datetime, timedelta

    from app.db import get_conn
    from app.services import cache

    con = get_conn()
    today = date(2026, 10, 13)
    old, recent = datetime(2020, 1, 6, 9, 15), datetime(2026, 10, 1, 9, 15)
    for res, ts in [("D", old), ("15", old), ("15", recent), ("5", datetime(2026, 7, 1, 9, 15)), ("5", recent)]:
        con.execute("INSERT INTO candles VALUES ('NSE:SBIN-EQ', ?, ?, 1, 2, 0.5, 1.5, 10)", [res, ts])
    con.execute("INSERT INTO coverage VALUES ('NSE:SBIN-EQ', '15', '2020-01-01', '2026-10-01', ?)", [datetime.now()])
    out = cache.trim(today)
    assert out["removed"] == {"15": 1, "5": 1}
    left = sorted(con.execute("SELECT resolution, ts FROM candles").fetchall())
    assert ("D", old) in left and ("15", recent) in left and len(left) == 3
    cov_from = con.execute("SELECT covered_from FROM coverage WHERE resolution = '15'").fetchone()[0]
    assert cov_from > date(2020, 1, 1)  # trimmed range will be re-fetched if needed
    admin = signed_in(app_, "boss")
    assert admin.get("/api/admin/data").json()["candles"][0]["resolution"] in ("15", "5", "D")
