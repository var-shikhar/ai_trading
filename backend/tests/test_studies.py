import numpy as np
import pandas as pd
import pytest
import talib

from app.analysis import studies
from app.analysis.studies import STUDIES, STUDIES_BY_ID, compute, resolve_params


@pytest.fixture(scope="module")
def df():
    """600 bars of a noisy random walk with volume, 15m bars over several days."""
    rng = np.random.default_rng(42)
    close = 100 + rng.normal(0, 1, 600).cumsum()
    open_ = close + rng.normal(0, 0.3, 600)
    high = np.maximum(open_, close) + rng.uniform(0.1, 1.0, 600)
    low = np.minimum(open_, close) - rng.uniform(0.1, 1.0, 600)
    # 25 bars per day starting 09:15 (IST wall time as UTC epoch).
    times = [
        int(pd.Timestamp("2026-01-05 09:15").timestamp()) + (i // 25) * 86400 + (i % 25) * 900 for i in range(600)
    ]
    return pd.DataFrame(
        {"time": times, "open": open_, "high": high, "low": low, "close": close,
         "volume": rng.integers(1000, 5000, 600).astype(float)}
    )


def run(study_id, df, **params):
    s = STUDIES_BY_ID[study_id]
    return compute(s, df, resolve_params(s, params))


def tail_close(a, b, n=100, tol=1e-6):
    a, b = np.asarray(a, float)[-n:], np.asarray(b, float)[-n:]
    assert np.allclose(a, b, atol=tol, rtol=1e-6), (a[:5], b[:5])


def test_every_study_computes_all_outputs(df):
    for s in STUDIES:
        out = compute(s, df, resolve_params(s, {}))
        assert set(out) == {o.key for o in s.outputs}, s.id
        for key, series in out.items():
            assert len(series) == len(df), (s.id, key)
            assert np.isfinite(series.iloc[-50:].astype(float)).any(), (s.id, key)


def test_matches_talib_where_formulas_agree(df):
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("open", "high", "low", "close", "volume"))
    tail_close(run("sma", df, length=20)["ma"], talib.SMA(c, 20))
    tail_close(run("wma", df, length=20)["ma"], talib.WMA(c, 20))
    bb = run("bb", df, length=20, mult=2)
    upper, middle, lower = talib.BBANDS(c, 20, 2, 2)
    tail_close(bb["upper"], upper)
    tail_close(bb["basis"], middle)
    tail_close(bb["lower"], lower)
    tail_close(run("cci", df, length=20)["cci"], talib.CCI(h, l, c, 20), tol=1e-4)
    tail_close(run("willr", df, length=14)["r"], talib.WILLR(h, l, c, 14))
    tail_close(run("roc", df, length=9)["roc"], talib.ROC(c, 9))
    tail_close(run("mfi", df, length=14)["mfi"], talib.MFI(h, l, c, v, 14))
    # OBV: TA-Lib seeds with the first bar's volume; ours starts at 0 (TradingView).
    obv = run("obv", df)["obv"].to_numpy()
    assert np.allclose(np.diff(obv), np.diff(talib.OBV(c, v)))
    stoch = run("stoch", df, k_length=14, k_smooth=3, d_smooth=3)
    k, d = talib.STOCH(h, l, c, 14, 3, 0, 3, 0)
    tail_close(stoch["k"], k)
    tail_close(stoch["d"], d)


def test_wilder_and_ema_studies_converge_to_talib(df):
    """Same formulas, different seeding of the first value: equal once warmed up."""
    h, l, c = (df[k].to_numpy(float) for k in ("high", "low", "close"))
    tail_close(run("atr", df, length=14)["atr"], talib.ATR(h, l, c, 14), tol=1e-6)
    tail_close(run("rsi", df, length=14)["rsi"], talib.RSI(c, 14), tol=1e-6)
    macd = run("macd", df, fast=12, slow=26, signal=9)
    line, signal, hist = talib.MACD(c, 12, 26, 9)
    tail_close(macd["macd"], line, tol=1e-6)
    tail_close(macd["signal"], signal, tol=1e-6)
    tail_close(macd["hist"], hist, tol=1e-6)
    dmi = run("adx", df, length=14, smoothing=14)
    tail_close(dmi["plus"], talib.PLUS_DI(h, l, c, 14), tol=1e-6)
    tail_close(dmi["minus"], talib.MINUS_DI(h, l, c, 14), tol=1e-6)
    tail_close(dmi["adx"], talib.ADX(h, l, c, 14), tol=1e-4)


def test_supertrend_sits_on_the_correct_side(df):
    st = run("supertrend", df, atr_length=10, factor=3)
    up, down = st["up"], st["down"]
    both = up.notna() & down.notna()
    assert not both.any()  # exactly one line per bar
    assert (up.notna() | down.notna()).iloc[20:].all()
    # Up-trend line is below the close, down-trend line above it.
    assert (up[up.notna()] < df["close"][up.notna()]).all()
    assert (down[down.notna()] > df["close"][down.notna()]).all()


def test_vwap_resets_each_session(df):
    vwap = run("vwap", df)["vwap"]
    tp = (df["high"] + df["low"] + df["close"]) / 3
    first_bars = df.index[::25]
    assert np.allclose(vwap[first_bars], tp[first_bars])  # new day: VWAP = first bar's price
    # Within a day it's the volume-weighted mean so far.
    day = df.iloc[25:50]
    expected = (tp[25:50] * day["volume"]).cumsum() / day["volume"].cumsum()
    assert np.allclose(vwap[25:50], expected)


def test_vwap_without_volume_is_empty(df):
    no_vol = df.assign(volume=0.0)
    assert run("vwap", no_vol)["vwap"].isna().all()


def test_resolve_params_defaults_and_clamps():
    rsi = STUDIES_BY_ID["rsi"]
    assert resolve_params(rsi, {}) == {"length": 14, "source": "close"}
    assert resolve_params(rsi, {"length": 0, "source": "nope"}) == {"length": 1, "source": "close"}
    assert resolve_params(rsi, {"length": "21.6"})["length"] == 22
    bb = STUDIES_BY_ID["bb"]
    assert resolve_params(bb, {"mult": 99})["mult"] == 10


def test_catalog_shape():
    cat = studies.catalog()
    assert len(cat) == len(STUDIES)
    rsi = next(s for s in cat if s["id"] == "rsi")
    assert rsi["levels"] == [70, 30] and rsi["overlay"] is False
    assert next(i for i in rsi["inputs"] if i["key"] == "source")["options"][0] == "close"


def test_chart_post_endpoint(settings):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from tests.test_candles import service

    app.dependency_overrides[deps.get_candle_service] = lambda: service(settings)
    try:
        with TestClient(app) as client:
            body = client.post(
                "/api/chart",
                json={
                    "symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 200,
                    "studies": [
                        {"uid": "a", "id": "ema", "params": {"length": 9}},
                        {"uid": "b", "id": "ema", "params": {"length": 21}},
                        {"uid": "c", "id": "macd"},
                    ],
                },
            ).json()
            assert len(body["candles"]) == 200
            assert body["studies"]["a"]["params"]["length"] == 9
            assert body["studies"]["a"]["outputs"]["ma"] != body["studies"]["b"]["outputs"]["ma"]
            assert set(body["studies"]["c"]["outputs"]) == {"hist", "macd", "signal"}
            assert len(body["studies"]["c"]["outputs"]["macd"]) == 200  # warm-up covers it

            bad = client.post("/api/chart", json={"symbol": "X", "studies": [{"uid": "x", "id": "nope"}]})
            assert bad.status_code == 400
            assert len(client.get("/api/studies/catalog").json()) == len(STUDIES)
    finally:
        app.dependency_overrides.clear()
