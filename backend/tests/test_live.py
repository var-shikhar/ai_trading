import asyncio

import httpx
import pytest

from app.services.live import LiveHub, tick_from_message

pytestmark = pytest.mark.anyio


class FakeSocket:
    def __init__(self):
        self.subscribed: set[str] = set()

    def subscribe(self, symbols, data_type):
        self.subscribed |= set(symbols)

    def unsubscribe(self, symbols, data_type):
        self.subscribed -= set(symbols)

    def close_connection(self):
        pass


def make_hub():
    sockets = []

    def factory(token, hub):
        sockets.append(FakeSocket())
        return sockets[-1]

    aliases = {"NSE:NIFTY1!": "NSE:NIFTY99OCTFUT"}
    hub = LiveHub(token=lambda: "APP:TOKEN", resolve=lambda s: aliases.get(s, s), socket_factory=factory)
    return hub, sockets


def drain(client):
    out = []
    while not client.queue.empty():
        out.append(client.queue.get_nowait())
    return out


async def test_union_subscription_and_alias_relabel():
    hub, sockets = make_hub()
    a, b = hub.add(), hub.add()
    await hub.set_symbols(a, ["NSE:SBIN-EQ", "NSE:NIFTY1!"])
    await hub.set_symbols(b, ["NSE:SBIN-EQ", "NSE:TCS-EQ"])
    sock = sockets[0]
    assert len(sockets) == 1  # one shared socket
    assert sock.subscribed == {"NSE:SBIN-EQ", "NSE:NIFTY99OCTFUT", "NSE:TCS-EQ"}

    hub.on_message  # called from the SDK thread in real use; dispatch directly here
    hub._dispatch({"symbol": "NSE:NIFTY99OCTFUT", "ltp": 25000.5, "last_traded_time": 1_800_000_000,
                   "vol_traded_today": 10})
    ticks_a = [m for m in drain(a) if m["type"] == "tick"]
    assert ticks_a == [{"type": "tick", **tick_from_message({"symbol": "NSE:NIFTY1!", "ltp": 25000.5,
                        "last_traded_time": 1_800_000_000, "vol_traded_today": 10})}]
    assert not [m for m in drain(b) if m["type"] == "tick"]  # b didn't ask for NIFTY

    await hub.remove(a)
    assert sock.subscribed == {"NSE:SBIN-EQ", "NSE:TCS-EQ"}
    await hub.set_symbols(b, [])
    assert sock.subscribed == set()


async def test_new_client_gets_last_known_tick():
    hub, _ = make_hub()
    a = hub.add()
    await hub.set_symbols(a, ["NSE:SBIN-EQ"])
    hub._dispatch({"symbol": "NSE:SBIN-EQ", "ltp": 800.0, "last_traded_time": 1_800_000_000})
    b = hub.add()
    await hub.set_symbols(b, ["NSE:SBIN-EQ"])
    assert [m["ltp"] for m in drain(b) if m["type"] == "tick"] == [800.0]


async def test_no_token_reports_error_status():
    hub = LiveHub(token=lambda: None, resolve=lambda s: s, socket_factory=lambda t, h: pytest.fail("no socket"))
    c = hub.add()
    await hub.set_symbols(c, ["NSE:SBIN-EQ"])
    assert hub.status == "error" and "login" in hub.message


def test_tick_time_is_ist_wall_clock():
    t = tick_from_message({"symbol": "X", "ltp": 1, "last_traded_time": 0})
    assert t["time"] == 19800
    assert tick_from_message({"symbol": "X"}) is None


def test_watchlist_crud_and_scanner_universe():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert client.get("/api/watchlists").json() == []
        wl = client.post("/api/watchlists", json={"name": "Swing"}).json()
        items = [{"symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "name": "SBI", "kind": "EQ"}]
        updated = client.put(f"/api/watchlists/{wl['id']}", json={"items": items}).json()
        assert updated["name"] == "Swing" and updated["items"][0]["symbol"] == "NSE:SBIN-EQ"
        renamed = client.put(f"/api/watchlists/{wl['id']}", json={"name": "Breakouts"}).json()
        assert renamed["name"] == "Breakouts" and len(renamed["items"]) == 1
        universes = {u["id"]: u["name"] for u in client.get("/api/scanner/catalog").json()["universes"]}
        assert universes[f"watchlist:{wl['id']}"] == "Watchlist: Breakouts"
        client.delete(f"/api/watchlists/{wl['id']}")
        assert client.get("/api/watchlists").json() == []


async def test_quotes_parsing():
    from tests.test_fyers import epoch, login, provider

    def handler(req: httpx.Request):
        assert req.url.params["symbols"] == "NSE:SBIN-EQ,NSE:TCS-EQ"
        return httpx.Response(200, json={"s": "ok", "d": [
            {"n": "NSE:SBIN-EQ", "s": "ok", "v": {"lp": 800.5, "ch": 5.5, "chp": 0.69, "prev_close_price": 795,
                                                  "tt": str(epoch(2026, 1, 5, 15, 30) - 19800)}},
            {"n": "NSE:TCS-EQ", "s": "error", "v": {"errmsg": "invalid"}},
        ]})

    login()
    q = await provider(handler).get_quotes(["NSE:SBIN-EQ", "NSE:TCS-EQ"])
    assert set(q) == {"NSE:SBIN-EQ"} and q["NSE:SBIN-EQ"]["ltp"] == 800.5 and q["NSE:SBIN-EQ"]["chp"] == 0.69
