import asyncio
from datetime import date

import httpx
import numpy as np
import pandas as pd
import pytest

from app.analysis import scanner
from app.providers.base import Instrument
from app.services import scan_jobs, universes
from tests.conftest import FakeProvider
from tests.test_chart_patterns import frame, path

pytestmark = pytest.mark.anyio


def test_consolidation_and_breakout_like_part_time_larry():
    flat = np.r_[np.linspace(90, 100, 40), 100 + np.sin(np.arange(15)) * 0.8]
    df = frame(flat)
    ok, detail = scanner.consolidation(df, {"bars": 15, "pct": 2.5})
    assert ok and "Range" in detail
    up = frame(np.r_[flat, 104.0])
    assert scanner.breakout(up, {"bars": 15, "pct": 2.5, "direction": "up"})[0]
    assert not scanner.breakout(up, {"bars": 15, "pct": 2.5, "direction": "down"})[0]
    wide = frame(np.r_[np.linspace(80, 100, 16), 104.0])  # prior range too wide
    assert not scanner.breakout(wide, {"bars": 15, "pct": 2.5})[0]


def test_indicator_conditions():
    falling = frame(path((60, 60), start=100))
    assert scanner.rsi_level(falling, {"op": "<", "value": 30})[0]
    assert not scanner.rsi_level(falling, {"op": ">", "value": 70})[0]
    assert scanner.price_vs_ma(falling, {"ma": "ema", "length": 20, "op": "below"})[0]
    assert scanner.high_low_52w(falling, {"kind": "low", "within_pct": 3})[0]

    # 50/200 golden cross: long decline then a strong rally
    cross = frame(path((70, 250), (140, 120), start=100))
    found = any(scanner.ma_cross(cross.iloc[: n], {"fast": 50, "slow": 200, "within": 1})[0] for n in range(250, 371))
    assert found

    vol = frame(np.linspace(100, 110, 40))
    vol.loc[vol.index[-1], "volume"] = 5000
    ok, detail = scanner.volume_spike(vol, {"length": 20, "multiple": 2})
    assert ok and "5.0×" in detail


def test_evaluate_requires_all_conditions():
    df = frame(path((60, 60), start=100))
    ok, details = scanner.evaluate(df, [
        {"type": "rsi", "params": {"op": "<", "value": 30}},
        {"type": "price_vs_ma", "params": {"length": 20, "op": "below"}},
    ])
    assert ok and len(details) == 2
    ok, _ = scanner.evaluate(df, [
        {"type": "rsi", "params": {"op": "<", "value": 30}},
        {"type": "price_vs_ma", "params": {"length": 20, "op": "above"}},
    ])
    assert not ok


def test_presets_use_known_conditions():
    for p in scanner.PRESETS:
        assert all(c["type"] in scanner.CONDITIONS for c in p["conditions"]), p["id"]


class Registry(FakeProvider):
    async def fetch_instruments(self):
        return [
            Instrument("NSE:SBIN-EQ", "SBIN", "STATE BANK OF INDIA", "NSE", "EQ", underlying="SBIN"),
            Instrument("NSE:TCS-EQ", "TCS", "TCS", "NSE", "EQ", underlying="TCS"),
            Instrument("NSE:SBIN99OCTFUT", "SBIN99OCTFUT", "SBIN FUT", "NSE", "FUT", expiry=date(2099, 10, 30), underlying="SBIN"),
            Instrument("MCX:CRUDEOIL1!", "CRUDEOIL1!", "CRUDEOIL cont", "MCX", "COM", underlying="CRUDEOIL",
                       actual="MCX:CRUDEOIL99OCTFUT"),
        ]


async def test_universes_from_instruments_and_index_csv():
    from app.services.instruments import refresh_instruments

    await refresh_instruments(Registry())
    assert [m["symbol"] for m in await universes.members("fno")] == ["NSE:SBIN-EQ"]
    assert [m["symbol"] for m in await universes.members("mcx")] == ["MCX:CRUDEOIL1!"]
    custom = await universes.members("custom", ["sbin", "CRUDEOIL1!", "nope"])
    assert {m["symbol"] for m in custom} == {"NSE:SBIN-EQ", "MCX:CRUDEOIL1!"}

    csv_text = "Company Name,Industry,Symbol,Series,ISIN Code\nSBI,Financial Services,SBIN,EQ,X\nTCS,IT,TCS,EQ,Y\n"
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, text=csv_text)))
    n50 = await universes.members("nifty50", client=client)
    assert {(m["ticker"], m["industry"]) for m in n50} == {("SBIN", "Financial Services"), ("TCS", "IT")}
    # Cached for the day: no network needed the second time.
    offline = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    assert len(await universes.members("nifty50", client=offline)) == 2


async def test_scan_job_runs_over_universe(settings):
    from app.services.instruments import refresh_instruments
    from tests.test_candles import service

    await refresh_instruments(Registry())
    symbols = await universes.members("custom", ["SBIN", "TCS"])
    job = scan_jobs.start(service(settings), "custom", "1D", [{"type": "rsi", "params": {"op": ">", "value": 0}}], symbols)
    await job.task
    view = job.view()
    assert view["status"] == "done" and view["done"] == 2
    assert {m["ticker"] for m in view["matches"]} == {"SBIN", "TCS"}
    assert all(m["details"][0].startswith("RSI") for m in view["matches"])


def test_api_rejects_bad_requests():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        cat = client.get("/api/scanner/catalog").json()
        assert {"universes", "conditions", "presets"} <= set(cat)
        bad_tf = client.post("/api/scanner/run", json={"universe": "fno", "tf": "5m", "conditions": [{"type": "rsi"}]})
        assert bad_tf.status_code == 400
        bad_cond = client.post("/api/scanner/run", json={"universe": "fno", "conditions": [{"type": "magic"}]})
        assert bad_cond.status_code == 400
        assert client.get("/api/scanner/jobs/nope").status_code == 404
