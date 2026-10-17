from calendar import timegm
from datetime import date, datetime

import pytest

from app.db import get_conn
from app.services import market_sync, scan_jobs, universes
from app.services.candles import CandleService
from tests.test_scanner import Registry

pytestmark = pytest.mark.anyio

NOW = datetime(2026, 10, 14, 16, 0)  # a Wednesday, after the close
TODAY = NOW.date()


class QuotingProvider(Registry):
    """Fake market plus a quotes endpoint for today's bar."""

    def __init__(self, prev_close: dict[str, float] | None = None):
        super().__init__()
        self.prev_close = prev_close or {}
        self.quote_calls = 0

    async def get_quotes(self, symbols):
        self.quote_calls += 1
        con = get_conn()
        out = {}
        for s in symbols:
            last = con.execute(
                "SELECT arg_max(close, ts) FROM candles WHERE symbol = ? AND resolution = 'D' AND ts < ?",
                [s, datetime.combine(TODAY, datetime.min.time())],
            ).fetchone()[0]
            out[s] = {
                "ltp": 150.0,
                "open": 148.0,
                "high": 151.0,
                "low": 147.0,
                "prev_close": self.prev_close.get(s, last),
                "volume": 20_000,
                "time": timegm(datetime.combine(TODAY, datetime.min.time()).replace(hour=15, minute=29).timetuple()),
            }
        return out


async def synced(settings, provider):
    from app.services.instruments import refresh_instruments

    await refresh_instruments(provider)
    svc = CandleService(provider, settings, now=lambda: NOW)
    market_sync._state = market_sync.SyncState()
    assert market_sync.start(svc)
    await market_sync._task
    return svc


async def test_sync_stores_history_and_todays_bar_from_quotes(settings):
    provider = QuotingProvider()
    svc = await synced(settings, provider)
    st = market_sync.status()
    assert st["status"] == "done", st
    assert st["equities"] == 2 and st["stored"] == 2 and st["latest_bar"] == TODAY.isoformat()
    # History stops at the previous trading day; today came from one quotes call.
    assert all(end <= date(2026, 10, 13) for _, _, _, end in provider.calls)
    assert provider.quote_calls == 1
    bar = get_conn().execute(
        "SELECT open, high, low, close, volume FROM candles WHERE symbol = 'NSE:SBIN-EQ' AND resolution = 'D' AND ts = ?",
        [datetime.combine(TODAY, datetime.min.time())],
    ).fetchone()
    assert bar == (148.0, 151.0, 147.0, 150.0, 20_000)

    # A whole-market scan reads the cache: no history calls at all.
    provider.calls.clear()
    rows = await svc.get_candles("NSE:SBIN-EQ", "1D", 400, max_age=market_sync.SCAN_MAX_AGE)
    assert provider.calls == [] and rows[-1]["close"] == 150.0


async def test_liquid_universe_filters_on_traded_value(settings, monkeypatch):
    await synced(settings, QuotingProvider())
    # The fake market trades ~25,000 shares a day at ~Rs 100: far below Rs 1 crore.
    assert await universes.members(universes.MARKET) == []
    monkeypatch.setattr(market_sync, "MIN_TRADED_VALUE", 0)
    assert {m["ticker"] for m in await universes.members(universes.MARKET)} == {"SBIN", "TCS"}
    assert any(u["id"] == universes.MARKET for u in universes.catalog())


async def test_scan_over_market_makes_no_api_calls(settings, monkeypatch):
    provider = QuotingProvider()
    svc = await synced(settings, provider)
    monkeypatch.setattr(market_sync, "MIN_TRADED_VALUE", 0)
    provider.calls.clear()
    symbols = await universes.members(universes.MARKET)
    job = scan_jobs.start(svc, universes.MARKET, "1D", [{"type": "rsi", "params": {"op": ">", "value": 0}}], symbols)
    await job.task
    assert job.view()["status"] == "done" and len(job.view()["matches"]) == 2
    assert provider.calls == []


async def test_split_drops_history_for_refetch(settings):
    # TCS's quote says yesterday closed at a tenth of what we stored: a split.
    provider = QuotingProvider()
    await synced(settings, provider)
    stored = get_conn().execute(
        "SELECT arg_max(close, ts) FROM candles WHERE symbol = 'NSE:TCS-EQ' AND ts < ?",
        [datetime.combine(TODAY, datetime.min.time())],
    ).fetchone()[0]
    provider.prev_close = {"NSE:TCS-EQ": stored / 10}
    await synced(settings, provider)
    con = get_conn()
    assert con.execute("SELECT count(*) FROM candles WHERE symbol = 'NSE:TCS-EQ'").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM coverage WHERE symbol = 'NSE:TCS-EQ'").fetchone()[0] == 0
    assert con.execute("SELECT count(*) FROM candles WHERE symbol = 'NSE:SBIN-EQ'").fetchone()[0] > 0


def test_market_api_needs_fyers_and_reports_status():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        st = client.get("/api/scanner/market").json()
        assert {"status", "equities", "stored", "liquid"} <= set(st)
        run = client.post("/api/scanner/run", json={"universe": universes.MARKET, "conditions": [{"type": "rsi"}]})
        assert run.status_code == 409
