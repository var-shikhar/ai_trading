from calendar import timegm
from datetime import date, datetime

import pytest

from app.alerts import engine as eng
from app.alerts.evaluate import PriceRule, bar_start, check_price, last_closed_bar, line_level, should_fire
from app.providers.base import Instrument
from tests.conftest import FakeProvider

pytestmark = pytest.mark.anyio
ME = "trader"


@pytest.fixture(autouse=True)
def owner():
    from app.services import accounts

    accounts.create_user(ME, "long enough pass")

DAY = 86400
MON = timegm((2026, 10, 5, 0, 0, 0))  # Monday 00:00, IST wall time as epoch


def at(day_offset: int, hh: int, mm: int) -> int:
    return MON + day_offset * DAY + hh * 3600 + mm * 60


# --- pure rules -------------------------------------------------------------------------


def test_crossings():
    up = PriceRule("crosses_above", 100)
    assert check_price(up, 99.5, 100.0) and check_price(up, 99, 101)
    assert not check_price(up, 100, 101)  # already above: no cross
    assert not check_price(up, None, 101)  # first tick can't cross
    down = PriceRule("crosses_below", 100)
    assert check_price(down, 101, 99) and not check_price(down, 99, 98)
    both = PriceRule("crosses", 100)
    assert check_price(both, 101, 99) and check_price(both, 99, 101)
    assert check_price(PriceRule("above", 100), None, 100.5)
    assert check_price(PriceRule("change_up", 3), None, 1, chp=3.2)
    assert not check_price(PriceRule("change_down", 3), None, 1, chp=-2.9)


def test_trend_line_level_moves_with_time():
    pts = [{"time": 0, "price": 100}, {"time": 10 * DAY, "price": 110}]
    assert line_level(pts, 5 * DAY) == pytest.approx(105)
    assert line_level(pts, 20 * DAY) == pytest.approx(120)  # extended to the right
    assert line_level([{"time": 0, "price": 50}], 99) == 50
    # Price flat at 115 while the line rises through it: crosses below.
    rule = PriceRule("crosses_below", 0)
    assert check_price(rule, 115, 115, level=line_level(pts, 16 * DAY), prev_level=line_level(pts, 14 * DAY))


def test_bar_timing_nse_and_mcx():
    assert bar_start(at(0, 10, 20), "1h", "09:15") == at(0, 10, 15)
    assert bar_start(at(0, 10, 20), "1h", "09:00") == at(0, 10, 0)
    # 1h NSE at 11:30: the 10:15 bar is the newest closed one.
    assert last_closed_bar(at(0, 11, 30), "1h", "09:15", "15:30") == at(0, 10, 15)
    # After the close the day's last (short) bar counts as closed.
    assert last_closed_bar(at(0, 15, 45), "1h", "09:15", "15:30") == at(0, 15, 15)
    # Daily: today's bar only after the session end.
    assert last_closed_bar(at(0, 14, 0), "1D", "09:15", "15:30") == MON - DAY
    assert last_closed_bar(at(0, 15, 31), "1D", "09:15", "15:30") == MON
    assert last_closed_bar(at(0, 23, 40), "1D", "09:00", "23:30") == MON  # MCX


def test_frequency():
    assert should_fire("once", None, 100, None, None)
    assert not should_fire("once", 50, 100, None, None)
    assert should_fire("once_per_bar", 50, 100, bar_time=2, last_bar=1)
    assert not should_fire("once_per_bar", 50, 100, bar_time=1, last_bar=1)
    assert not should_fire("every", 50, 100, None, None)  # 60 s cool-down
    assert should_fire("every", 50, 111, None, None)


# --- engine ------------------------------------------------------------------------------


class FakeHub:
    def __init__(self):
        self.sent: list[dict] = []
        self.subscribed: list[str] = []

    def add(self):
        import asyncio

        from app.services.live import Client

        return Client(asyncio.Queue())

    async def set_symbols(self, client, symbols):
        self.subscribed = list(symbols)

    async def remove(self, client):
        pass

    def broadcast(self, msg, user=None):
        self.sent.append(msg)


def make_engine(settings, now=None):
    from tests.test_candles import service

    hub = FakeHub()
    return eng.AlertEngine(hub, service(settings, now=now) if now else service(settings), lambda: True), hub


async def test_price_alert_fires_once_and_subscribes(settings):
    e, hub = make_engine(settings)
    a = eng.save_alert(owner=ME, a={"kind": "price", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN",
                        "config": {"op": "crosses_above", "value": 800}, "frequency": "once", "channels": ["app"]})
    await e.refresh()
    assert hub.subscribed == ["NSE:SBIN-EQ"]
    for p in (798, 799.5, 801, 799, 802):
        await e.on_tick({"symbol": "NSE:SBIN-EQ", "ltp": p, "time": at(0, 10, 0), "chp": 0.1})
    assert len(hub.sent) == 1 and "crossed above" in hub.sent[0]["title"]
    stored = eng.get_alert(a["id"])
    assert stored["status"] == "triggered" and stored["fire_count"] == 1
    assert len(eng.list_events(ME)) == 1
    await e.refresh()
    assert hub.subscribed == []  # nothing active left to watch


async def test_drawing_alert_on_trend_line(settings):
    e, hub = make_engine(settings)
    t0 = at(0, 9, 15)
    eng.save_alert(owner=ME, a={"kind": "drawing", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "frequency": "every",
                    "config": {"op": "crosses_above", "points": [{"time": t0, "price": 100}, {"time": t0 + 3600, "price": 110}]}})
    await e.on_tick({"symbol": "NSE:SBIN-EQ", "ltp": 104, "time": t0 + 1800})  # line at 105
    await e.on_tick({"symbol": "NSE:SBIN-EQ", "ltp": 106.5, "time": t0 + 1860})  # line ~105.2: crossed
    assert len(hub.sent) == 1 and "your line" in hub.sent[0]["title"]


async def test_condition_alert_once_per_closed_bar(settings):
    now_dt = datetime(2026, 10, 6, 20, 0)  # Tuesday evening: Tuesday's daily bar is closed
    e, hub = make_engine(settings, now=now_dt)
    eng.save_alert(owner=ME, a={"kind": "condition", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "tf": "1D",
                    "frequency": "once_per_bar", "config": {"conditions": [{"type": "rsi", "params": {"op": ">", "value": 0}}]}})
    now = at(1, 20, 0)
    await e.check_bars(now)
    await e.check_bars(now)  # same closed bar: no second alert
    assert len(hub.sent) == 1 and "conditions met" in hub.sent[0]["title"]
    await e.check_bars(now + DAY)  # Wednesday's bar closed... but the fake clock's data ends Tuesday
    assert len(hub.sent) == 1


async def test_scan_alert_reports_only_new_matches(settings):
    from app.services.instruments import refresh_instruments

    class Registry(FakeProvider):
        async def fetch_instruments(self):
            return [Instrument("NSE:SBIN-EQ", "SBIN", "SBI", "NSE", "EQ"), Instrument("NSE:TCS-EQ", "TCS", "TCS", "NSE", "EQ")]

    await refresh_instruments(Registry())
    e, hub = make_engine(settings)
    a = eng.save_alert(owner=ME, a={"kind": "scan", "name": "Everything", "frequency": "every",
                        "config": {"universe": "custom", "custom": ["SBIN", "TCS"], "at": "15:45",
                                   "conditions": [{"type": "rsi", "params": {"op": ">", "value": 0}}]}})
    await e.check_scans(at(0, 15, 0))  # before the scan time
    assert not hub.sent
    await e.check_scans(at(0, 15, 50))
    assert len(hub.sent) == 1 and "2 new" in hub.sent[0]["title"]
    await e.check_scans(at(0, 16, 30))  # already ran today
    stored = eng.get_alert(a["id"])
    stored["last_fired"] = None
    await e.run_scan_alert(stored, "2026-10-06")  # next day: same matches -> nothing new
    assert len(hub.sent) == 1


def test_alerts_api_validation_and_crud():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        body = {"kind": "price", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "config": {"op": "crosses_above", "value": 900}}
        created = client.post("/api/alerts", json=body).json()
        listing = client.get("/api/alerts").json()
        assert listing["alerts"][0]["id"] == created["id"]
        assert listing["channels"]["app"] is True and listing["channels"]["telegram"] is False
        paused = client.put(f"/api/alerts/{created['id']}", json={**body, "status": "paused"}).json()
        assert paused["status"] == "paused"
        assert client.post("/api/alerts", json={**body, "config": {"op": "x"}}).status_code == 422
        bad_cond = {"kind": "condition", "symbol": "NSE:SBIN-EQ", "tf": "1D", "config": {"conditions": [{"type": "magic"}]}}
        assert client.post("/api/alerts", json=bad_cond).status_code == 422
        assert client.post("/api/alerts/test", json=["telegram"]).json() == {"telegram": "not configured"}
        client.delete(f"/api/alerts/{created['id']}")
        assert client.get("/api/alerts").json()["alerts"] == []


async def test_price_alerts_resubscribe_when_fyers_comes_back(settings):
    """The engine starts while Fyers is logged out (the token expires daily);
    after the login, price alerts must get ticks without anyone editing them."""
    from tests.test_candles import service

    hub = FakeHub()
    ready = {"ok": False}
    e = eng.AlertEngine(hub, service(settings), lambda: ready["ok"])
    eng.save_alert(owner=ME, a={"kind": "price", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN",
                                "config": {"op": "crosses", "value": 800}, "frequency": "once", "channels": ["app"]})
    await e.refresh()
    assert hub.subscribed == [] and e.status.startswith("paused")
    ready["ok"] = True
    await e.check_bars()
    assert hub.subscribed == ["NSE:SBIN-EQ"] and e.status == "running"


def test_price_alert_needs_a_positive_level():
    from fastapi.testclient import TestClient

    from app.main import app

    body = {"kind": "price", "symbol": "NSE:SBIN-EQ", "ticker": "SBIN", "config": {"op": "crosses", "value": 0}}
    with TestClient(app) as client:
        assert client.post("/api/alerts", json=body).status_code == 422
