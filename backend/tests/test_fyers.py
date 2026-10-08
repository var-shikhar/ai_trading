import json
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app.config import Settings
from app.providers.base import AuthRequired
from app.providers.fyers import FyersProvider, now_ist
from app.services import instruments, tokens
from tests.conftest import FakeProvider

pytestmark = pytest.mark.anyio

IST = timezone(timedelta(hours=5, minutes=30))
SETTINGS = Settings(fyers_app_id="APP-100", fyers_secret_key="SECRET")


def provider(handler) -> FyersProvider:
    return FyersProvider(SETTINGS, httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def epoch(*args) -> int:
    return int(datetime(*args, tzinfo=IST).timestamp())


def login():
    tokens.save_token("fyers", "TOKEN", now_ist() + timedelta(hours=1))


async def test_history_chunks_long_ranges_and_parses_ist():
    seen = []

    def handler(req: httpx.Request):
        seen.append(dict(req.url.params))
        assert req.headers["Authorization"] == "APP-100:TOKEN"
        return httpx.Response(
            200,
            json={"s": "ok", "candles": [[epoch(2026, 1, 5, 9, 15), 1, 2, 0.5, 1.5, 10]]},
        )

    login()
    candles = await provider(handler).get_history("NSE:SBIN-EQ", "15", date(2026, 1, 1), date(2026, 9, 1))

    assert len(seen) == 3  # 244 days / 100-day limit
    assert seen[0]["range_from"] == "2026-01-01"
    assert all(
        date.fromisoformat(p["range_to"]) - date.fromisoformat(p["range_from"]) < timedelta(days=100)
        for p in seen
    )
    assert seen[-1]["range_to"] == "2026-09-01"
    assert len(candles) == 1  # same candle from every chunk is de-duplicated
    assert candles[0].ts == datetime(2026, 1, 5, 9, 15)


async def test_daily_candles_normalised_to_midnight():
    def handler(req):
        return httpx.Response(
            200, json={"s": "ok", "candles": [[epoch(2026, 1, 5, 0, 0), 1, 2, 0.5, 1.5, 10]]}
        )

    login()
    candles = await provider(handler).get_history("NSE:SBIN-EQ", "D", date(2025, 1, 1), date(2026, 3, 1))
    assert candles[0].ts == datetime(2026, 1, 5)


async def test_no_data_returns_empty():
    login()
    p = provider(lambda req: httpx.Response(200, json={"s": "no_data", "candles": []}))
    assert await p.get_history("NSE:SBIN-EQ", "D", date(2026, 1, 1), date(2026, 1, 2)) == []


async def test_expired_token_clears_login():
    login()
    p = provider(lambda req: httpx.Response(200, json={"s": "error", "code": -16, "message": "x"}))
    with pytest.raises(AuthRequired):
        await p.get_history("NSE:SBIN-EQ", "D", date(2026, 1, 1), date(2026, 1, 2))
    assert not p.is_authenticated()


async def test_no_token_requires_login():
    p = provider(lambda req: httpx.Response(500))
    with pytest.raises(AuthRequired):
        await p.get_history("NSE:SBIN-EQ", "D", date(2026, 1, 1), date(2026, 1, 2))


async def test_exchange_auth_code_stores_token():
    def handler(req: httpx.Request):
        body = json.loads(req.content)
        assert body["code"] == "AUTHCODE"
        assert len(body["appIdHash"]) == 64
        return httpx.Response(200, json={"s": "ok", "access_token": "NEWTOKEN"})

    p = provider(handler)
    assert not p.is_authenticated()
    await p.exchange_auth_code("AUTHCODE")
    assert p.is_authenticated()
    assert "client_id=APP-100" in p.login_url("st") and "state=st" in p.login_url("st")


def master_row(name, inst_type, lot, tick, session, expiry, symbol, underlying):
    """A symbol master CSV row in Fyers' 21-column layout (unused columns blank)."""
    row = [""] * 21
    row[1], row[2], row[3], row[4], row[6], row[8], row[9], row[13] = (
        name, str(inst_type), str(lot), str(tick), session, expiry, symbol, underlying,
    )
    return ",".join(row)


def expiry_epoch(*args) -> str:
    return str(epoch(*args, 14, 30))


MASTERS = {
    "NSE_CM": [
        master_row("STATE BANK OF INDIA", 0, 1, 0.05, "0915-1530|1815-1915:", "", "NSE:SBIN-EQ", "SBIN"),
        master_row("NIFTY50-INDEX", 10, 0, 0.05, "0915-1530|1815-1915:", "", "NSE:NIFTY50-INDEX", "NIFTY"),
        master_row("SDL PY 5.75% 2026", 5, 1, 0.01, "0915-1530|:", "", "NSE:575PY26-SG", "575PY26"),  # bond: skipped
    ],
    "BSE_CM": [
        master_row("RELIANCE INDUSTRIES LTD.", 0, 1, 0.05, "0915-1530|:", "", "BSE:RELIANCE-A", "RELIANCE"),
    ],
    "NSE_FO": [
        master_row("NIFTY 27 Nov 99 FUT", 11, 75, 0.1, "0915-1530|:", expiry_epoch(2099, 11, 27), "NSE:NIFTY99NOVFUT", "NIFTY"),
        master_row("NIFTY 30 Oct 99 FUT", 11, 75, 0.1, "0915-1530|:", expiry_epoch(2099, 10, 30), "NSE:NIFTY99OCTFUT", "NIFTY"),
        master_row("NIFTY 26 Oct 00 FUT", 11, 75, 0.1, "0915-1530|:", expiry_epoch(2000, 10, 26), "NSE:NIFTY00OCTFUT", "NIFTY"),  # expired
        master_row("NIFTY 30 Oct 99 25000 CE", 14, 75, 0.05, "0915-1530|:", expiry_epoch(2099, 10, 30), "NSE:NIFTY99OCT25000CE", "NIFTY"),  # option
    ],
    "MCX_COM": [
        master_row("CRUDEOIL 19 Oct 99 FUT", 30, 1, 1.0, "0900-2330|1815-1915:", expiry_epoch(2099, 10, 19), "MCX:CRUDEOIL99OCTFUT", "CRUDEOIL"),
    ],
}


async def test_symbol_masters_kinds_sessions_and_continuous_aliases():
    def handler(req: httpx.Request):
        segment = req.url.path.rsplit("/", 1)[-1].removesuffix(".csv")
        return httpx.Response(200, text="\n".join(MASTERS[segment]) + "\n")

    found = {i.symbol: i for i in await provider(handler).fetch_instruments()}
    assert set(found) == {
        "NSE:SBIN-EQ", "NSE:NIFTY50-INDEX", "BSE:RELIANCE-A",
        "NSE:NIFTY99NOVFUT", "NSE:NIFTY99OCTFUT", "MCX:CRUDEOIL99OCTFUT",
        "NSE:NIFTY1!", "MCX:CRUDEOIL1!",
    }
    assert found["NSE:SBIN-EQ"].ticker == "SBIN" and found["NSE:SBIN-EQ"].kind == "EQ"
    assert found["NSE:NIFTY50-INDEX"].name == "NIFTY50" and found["NSE:NIFTY50-INDEX"].kind == "INDEX"
    assert found["BSE:RELIANCE-A"].exchange == "BSE"
    fut = found["NSE:NIFTY99OCTFUT"]
    assert fut.kind == "FUT" and fut.lot_size == 75 and fut.expiry == date(2099, 10, 30)
    crude = found["MCX:CRUDEOIL99OCTFUT"]
    assert crude.kind == "COM" and (crude.session_start, crude.session_end) == ("09:00", "23:30")
    # Continuous alias points at the nearest expiry, not the later one.
    alias = found["NSE:NIFTY1!"]
    assert alias.actual == "NSE:NIFTY99OCTFUT" and alias.ticker == "NIFTY1!" and alias.kind == "FUT"
    assert found["MCX:CRUDEOIL1!"].actual == "MCX:CRUDEOIL99OCTFUT"


async def test_instrument_search_ranking():
    await instruments.refresh_instruments(FakeProvider())
    symbols = [r["symbol"] for r in instruments.search("sbi")]
    assert symbols[0] == "NSE:SBIN-EQ"
    assert "NSE:SBICARD-EQ" in symbols
    assert instruments.search("nifty")[0]["kind"] == "INDEX"


async def test_search_kind_filter_and_continuous_first():
    from app.providers.base import Instrument

    class Futures(FakeProvider):
        async def fetch_instruments(self):
            return [
                Instrument("NSE:NIFTY50-INDEX", "NIFTY50", "NIFTY 50", "NSE", "INDEX", underlying="NIFTY"),
                Instrument("NSE:NIFTY99NOVFUT", "NIFTY99NOVFUT", "NIFTY 27 Nov 99 FUT", "NSE", "FUT",
                           expiry=date(2099, 11, 27), underlying="NIFTY"),
                Instrument("NSE:NIFTY99OCTFUT", "NIFTY99OCTFUT", "NIFTY 30 Oct 99 FUT", "NSE", "FUT",
                           expiry=date(2099, 10, 30), underlying="NIFTY"),
                Instrument("NSE:NIFTY1!", "NIFTY1!", "NIFTY futures · continuous", "NSE", "FUT",
                           expiry=date(2099, 10, 30), underlying="NIFTY", actual="NSE:NIFTY99OCTFUT"),
            ]

    await instruments.refresh_instruments(Futures())
    futs = [r["symbol"] for r in instruments.search("nifty", kind="FUT")]
    assert futs == ["NSE:NIFTY1!", "NSE:NIFTY99OCTFUT", "NSE:NIFTY99NOVFUT"]
    assert instruments.search("nifty", kind="INDEX")[0]["symbol"] == "NSE:NIFTY50-INDEX"


async def test_refresh_if_stale_reloads_incomplete_list():
    from app.providers.base import Instrument

    class Partial(FakeProvider):  # only stocks, as after a failed refresh
        async def fetch_instruments(self):
            return [Instrument("NSE:SBIN-EQ", "SBIN", "SBI", "NSE", "EQ")]

    class Full(FakeProvider):
        def __init__(self):
            super().__init__()
            self.fetched = 0

        async def fetch_instruments(self):
            self.fetched += 1
            return [
                Instrument("NSE:SBIN-EQ", "SBIN", "SBI", "NSE", "EQ"),
                Instrument("NSE:NIFTYBEES-EQ", "NIFTYBEES", "NIFTY ETF", "NSE", "ETF"),
                Instrument("NSE:NIFTY50-INDEX", "NIFTY50", "NIFTY 50", "NSE", "INDEX"),
                Instrument("NSE:NIFTY99OCTFUT", "NIFTY99OCTFUT", "NIFTY FUT", "NSE", "FUT", expiry=date(2099, 10, 30)),
                Instrument("MCX:CRUDEOIL99OCTFUT", "CRUDEOIL99OCTFUT", "CRUDE", "MCX", "COM", expiry=date(2099, 10, 19)),
            ]

    full = Full()
    full.name = Partial.name
    await instruments.refresh_instruments(Partial())
    await instruments.refresh_if_stale(full)  # refreshed today, but incomplete
    assert full.fetched == 1
    await instruments.refresh_if_stale(full)  # complete now: no refetch
    assert full.fetched == 1


async def test_rate_limited_requests_are_retried(monkeypatch):
    import app.providers.fyers as fy

    monkeypatch.setattr(fy, "RETRY_BASE_SECONDS", 0)
    calls = []

    def handler(req):
        calls.append(1)
        if len(calls) < 3:
            return httpx.Response(429, json={"s": "error", "code": 429, "message": "request limit reached"})
        return httpx.Response(200, json={"s": "ok", "candles": [[epoch(2026, 1, 5, 0, 0), 1, 2, 0.5, 1.5, 10]]})

    login()
    candles = await provider(handler).get_history("NSE:SBIN-EQ", "D", date(2026, 1, 1), date(2026, 1, 10))
    assert len(calls) == 3 and len(candles) == 1
