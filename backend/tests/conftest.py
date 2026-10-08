from collections.abc import AsyncIterator
from datetime import date, datetime, time, timedelta

import pytest

from app import db
from app.config import Settings, get_settings
from app.providers.base import Candle, Instrument, MarketDataProvider, Tick


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.duckdb"))
    get_settings.cache_clear()
    db.close_conn()
    yield
    db.close_conn()
    get_settings.cache_clear()


@pytest.fixture
def anyio_backend():
    return "asyncio"


def bar_15m(ts: datetime) -> Candle:
    """Deterministic 15m bar derived from its timestamp."""
    n = ts.toordinal() * 100 + (ts.hour * 60 + ts.minute) // 15
    base = 100 + (n % 37)
    return Candle(ts, base, base + 2 + n % 3, base - 1 - n % 2, base + (n % 5) - 2, 1000 + n % 97)


HISTORY_START = date(2000, 1, 3)  # fake market has no data before this


def session_bars(day: date) -> list[Candle]:
    if day.weekday() >= 5 or day < HISTORY_START:
        return []
    start = datetime.combine(day, time(9, 15))
    return [bar_15m(start + timedelta(minutes=15 * i)) for i in range(25)]  # 09:15..15:15


def aggregate(bars: list[Candle], ts: datetime) -> Candle:
    return Candle(
        ts,
        bars[0].open,
        max(b.high for b in bars),
        min(b.low for b in bars),
        bars[-1].close,
        sum(b.volume for b in bars),
    )


class FakeProvider(MarketDataProvider):
    """Consistent synthetic market: every resolution is built from the same 15m bars."""

    name = "fake"
    supports_history = True

    def __init__(self):
        self.calls: list[tuple[str, str, date, date]] = []

    def is_authenticated(self) -> bool:
        return True

    async def get_history(self, symbol, resolution, start, end):
        self.calls.append((symbol, resolution, start, end))
        out = []
        day = start
        while day <= end:
            bars = session_bars(day)
            if bars:
                if resolution == "D":
                    out.append(aggregate(bars, datetime.combine(day, time.min)))
                else:
                    per = int(resolution) // 15
                    for i in range(0, len(bars), per):
                        chunk = bars[i : i + per]
                        out.append(aggregate(chunk, chunk[0].ts))
            day += timedelta(days=1)
        return out

    async def fetch_instruments(self):
        return [
            Instrument("NSE:SBIN-EQ", "SBIN", "STATE BANK OF INDIA", "NSE", "EQ"),
            Instrument("NSE:SBICARD-EQ", "SBICARD", "SBI CARDS", "NSE", "EQ"),
            Instrument("NSE:NIFTY50-INDEX", "NIFTY50", "NIFTY 50", "NSE", "INDEX"),
            Instrument("NSE:SETFNIF50-EQ", "SETFNIF50", "SBI NIFTY 50 ETF", "NSE", "ETF"),
        ]

    def stream_ticks(self, symbols) -> AsyncIterator[Tick]:
        raise NotImplementedError


@pytest.fixture
def settings():
    return Settings(intraday_base_days=730, refresh_seconds=60)
