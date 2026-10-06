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


async def test_symbol_master_filters_kinds():
    master = {
        "NSE:SBIN-EQ": {"exInstType": 0, "tradeStatus": 1, "exSymbol": "SBIN", "exSymName": "SBI",
                        "exchangeName": "NSE", "minLotSize": 1, "tickSize": 0.05},
        "NSE:NIFTY50-INDEX": {"exInstType": 10, "tradeStatus": 1, "exSymbol": "NIFTY50",
                              "exSymName": "NIFTY"},
        "NSE:582RJ27-SG": {"exInstType": 5, "tradeStatus": 1, "exSymbol": "582RJ27"},
    }
    p = provider(lambda req: httpx.Response(200, json=master))
    result = {i.symbol: i.kind for i in await p.fetch_instruments()}
    assert result == {"NSE:SBIN-EQ": "EQ", "NSE:NIFTY50-INDEX": "INDEX"}


async def test_instrument_search_ranking():
    await instruments.refresh_instruments(FakeProvider())
    symbols = [r["symbol"] for r in instruments.search("sbi")]
    assert symbols[0] == "NSE:SBIN-EQ"
    assert "NSE:SBICARD-EQ" in symbols
    assert instruments.search("nifty")[0]["kind"] == "INDEX"
