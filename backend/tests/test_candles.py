from calendar import timegm
from datetime import datetime, timedelta

import pytest

from app.services.candles import CandleService
from tests.conftest import FakeProvider

pytestmark = pytest.mark.anyio

# Tuesday evening, after market close.
NOW = datetime(2026, 10, 6, 20, 0)


def service(settings, provider=None, now=NOW):
    return CandleService(provider or FakeProvider(), settings, now=lambda: now)


def as_dt(bar):
    return datetime(1970, 1, 1) + timedelta(seconds=bar["time"])


async def test_daily_fetches_once_then_serves_from_db(settings):
    provider = FakeProvider()
    svc = service(settings, provider)

    first = await svc.get_candles("NSE:SBIN-EQ", "1D", 100)
    assert len(first) == 100
    assert len(provider.calls) == 1

    again = await svc.get_candles("NSE:SBIN-EQ", "1D", 100)
    assert again == first
    assert len(provider.calls) == 1  # past days are final, nothing re-fetched


async def test_resampled_1h_matches_native_1h(settings):
    provider = FakeProvider()
    svc = service(settings, provider)

    resampled = await svc.get_candles("NSE:SBIN-EQ", "1h", 70)
    assert {c[1] for c in provider.calls} == {"15"}  # built from base, no '60' fetch

    native = await provider.get_history("NSE:SBIN-EQ", "60", as_dt(resampled[0]).date(), NOW.date())
    native_rows = [
        {"time": timegm(c.ts.timetuple()), "open": c.open, "high": c.high, "low": c.low,
         "close": c.close, "volume": c.volume}
        for c in native
    ]
    assert resampled == native_rows[-70:]
    # Session-aligned hours: 09:15, 10:15, ... 15:15
    assert as_dt(resampled[-1]).time().strftime("%H:%M") == "15:15"
    assert as_dt(resampled[-2]).time().strftime("%H:%M") == "14:15"


async def test_older_than_window_uses_native_timeframe(settings):
    settings.intraday_base_days = 30
    provider = FakeProvider()
    svc = service(settings, provider)

    bars = await svc.get_candles("NSE:SBIN-EQ", "1h", 7 * 60)  # ~60 trading days

    resolutions = {c[1] for c in provider.calls}
    assert resolutions == {"15", "60"}
    window_start = NOW.date() - timedelta(days=30)
    for _, res, start, end in provider.calls:
        if res == "60":
            assert end < window_start
        else:
            assert start >= window_start

    times = [b["time"] for b in bars]
    assert times == sorted(times) and len(times) == len(set(times))
    assert len(bars) == 7 * 60


async def test_weekly_and_monthly_bars_are_complete(settings):
    svc = service(settings)
    weekly = await svc.get_candles("NSE:SBIN-EQ", "1W", 20)
    assert len(weekly) == 20
    assert all(as_dt(b).weekday() == 0 for b in weekly)  # Monday-labelled
    daily = await svc.get_candles("NSE:SBIN-EQ", "1D", 200)
    week_start = as_dt(weekly[0])
    days = [d for d in daily if week_start <= as_dt(d) < week_start + timedelta(days=7)]
    assert len(days) == 5
    assert weekly[0]["open"] == days[0]["open"]
    assert weekly[0]["close"] == days[-1]["close"]
    assert weekly[0]["volume"] == sum(d["volume"] for d in days)

    monthly = await svc.get_candles("NSE:SBIN-EQ", "1M", 6)
    assert len(monthly) == 6
    assert all(as_dt(b).day == 1 for b in monthly)


async def test_today_refreshes_only_after_interval(settings):
    provider = FakeProvider()
    market_open = datetime(2026, 10, 6, 11, 0)
    clock = {"now": market_open}
    svc = CandleService(provider, settings, now=lambda: clock["now"])

    await svc.get_candles("NSE:SBIN-EQ", "15m", 50)
    assert len(provider.calls) == 1

    clock["now"] = market_open + timedelta(seconds=30)
    await svc.get_candles("NSE:SBIN-EQ", "15m", 50)
    assert len(provider.calls) == 1  # within refresh interval

    clock["now"] = market_open + timedelta(seconds=90)
    await svc.get_candles("NSE:SBIN-EQ", "15m", 50)
    assert len(provider.calls) == 2
    _, _, start, end = provider.calls[-1]
    assert start == end == market_open.date()  # only today re-fetched


async def test_scrolling_back_fetches_only_missing_range(settings):
    provider = FakeProvider()
    svc = service(settings, provider)
    recent = await svc.get_candles("NSE:SBIN-EQ", "1D", 50)
    first_day = as_dt(recent[0]).date()

    older = await svc.get_candles("NSE:SBIN-EQ", "1D", 50, end=first_day - timedelta(days=1))
    assert len(older) == 50
    assert older[-1]["time"] < recent[0]["time"]
    _, _, start, end = provider.calls[-1]
    assert end <= first_day + timedelta(days=7)  # didn't re-download the recent range


async def test_chart_endpoint_trims_warmup_and_reports_history_end(settings, monkeypatch):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app

    svc = service(settings)
    app.dependency_overrides[deps.get_candle_service] = lambda: svc
    try:
        with TestClient(app) as client:
            body = client.get("/api/chart", params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 100}).json()
            assert len(body["candles"]) == 100
            assert body["has_more"] is True
            for key in ("ema20", "ema50", "ema200", "rsi14"):
                series = body["indicators"][key]
                assert len(series) == 100  # warm-up bars cover even EMA 200
                assert series[0]["time"] == body["candles"][0]["time"]

            # Fake history starts in 2000; 1300 months back reaches past it.
            body = client.get("/api/chart", params={"symbol": "NSE:SBIN-EQ", "tf": "1M", "limit": 900}).json()
            assert body["has_more"] is False
    finally:
        app.dependency_overrides.clear()
