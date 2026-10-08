import pandas as pd
import pytest
import talib

from app.analysis import candlestick
from app.analysis.candlestick import PATTERNS, detect, outcome_stats

pytestmark = pytest.mark.anyio


def frame(bars):
    """bars: list of (open, high, low, close); times are 1, 2, 3, ..."""
    return pd.DataFrame(
        [(i + 1, o, h, l, c, 1000) for i, (o, h, l, c) in enumerate(bars)],
        columns=["time", "open", "high", "low", "close", "volume"],
    )


# Steady decline: small red candles, each lower than the last.
DOWNTREND = [(110 - 2 * i, 110.5 - 2 * i, 108.5 - 2 * i, 109 - 2 * i) for i in range(12)]
# Steady rise.
UPTREND = [(90 + 2 * i, 91.5 + 2 * i, 89.5 + 2 * i, 91 + 2 * i) for i in range(12)]


def bullish_engulfing_after(trend):
    last_close = trend[-1][3]
    return trend + [
        (last_close, last_close + 0.3, last_close - 1.2, last_close - 1.0),  # small red
        (last_close - 1.3, last_close + 1.5, last_close - 1.4, last_close + 1.2),  # big green engulfs it
    ]


def test_catalog_covers_every_talib_pattern():
    talib_patterns = set(talib.get_function_groups()["Pattern Recognition"])
    assert {p.func for p in PATTERNS} == talib_patterns
    assert len({p.id for p in PATTERNS}) == len(PATTERNS)


def test_bullish_engulfing_after_downtrend_is_in_context():
    df = frame(bullish_engulfing_after(DOWNTREND))
    hits = [h for h in detect(df, ["engulfing"])]
    assert len(hits) == 1
    hit = hits[0]
    assert hit["direction"] == "bullish"
    assert hit["time"] == len(df)  # completes on the engulfing candle
    assert hit["prior_trend"] == "down"
    assert hit["in_context"] is True
    assert hit["move_pct"] is None  # nothing after it yet


def test_same_pattern_after_uptrend_is_out_of_context():
    df = frame(bullish_engulfing_after(UPTREND))
    hit = detect(df, ["engulfing"])[0]
    assert hit["direction"] == "bullish"
    assert hit["prior_trend"] == "up"
    assert hit["in_context"] is False


def test_context_rules_per_pattern_kind():
    hammer = candlestick.PATTERNS_BY_ID["hammer"]
    assert candlestick._fits_context(hammer, "bullish", "down")
    assert not candlestick._fits_context(hammer, "bullish", "up")
    methods = candlestick.PATTERNS_BY_ID["rising_falling_3"]  # continuation
    assert candlestick._fits_context(methods, "bullish", "up")
    assert not candlestick._fits_context(methods, "bullish", "down")
    doji = candlestick.PATTERNS_BY_ID["doji"]  # indecision fits any trend
    assert candlestick._fits_context(doji, "neutral", "up")


def test_one_sided_patterns_get_fixed_direction():
    # Gravestone doji: TA-Lib reports +100 but it's a bearish signal.
    g = candlestick.PATTERNS_BY_ID["gravestone_doji"]
    assert candlestick._direction(g, 100) == "bearish"
    assert candlestick._direction(candlestick.PATTERNS_BY_ID["engulfing"], -100) == "bearish"


def test_outcome_move_and_stats():
    bars = bullish_engulfing_after(DOWNTREND)
    close = bars[-1][3]
    # Five more bars after the pattern, ending 10% higher.
    bars += [(close, close + 1, close - 1, close + 0.5)] * 4 + [(close, close * 1.1 + 1, close - 1, close * 1.1)]
    hit = next(h for h in detect(frame(bars), ["engulfing"]) if h["direction"] == "bullish")
    assert hit["move_pct"] == pytest.approx(10.0, abs=0.01)

    hits = [
        {"pattern": "engulfing", "direction": "bullish", "move_pct": 2.0},
        {"pattern": "engulfing", "direction": "bullish", "move_pct": -1.0},
        {"pattern": "engulfing", "direction": "bearish", "move_pct": -3.0},
        {"pattern": "doji", "direction": "neutral", "move_pct": -4.0},
        {"pattern": "hammer", "direction": "bullish", "move_pct": None},  # too recent
    ]
    stats = {(s["pattern"], s["direction"]): s for s in outcome_stats(hits)}
    assert stats[("engulfing", "bullish")]["win_rate"] == 50.0
    assert stats[("engulfing", "bullish")]["avg_move_pct"] == 0.5
    assert stats[("engulfing", "bearish")]["win_rate"] == 100.0  # fell, as predicted
    assert stats[("engulfing", "bearish")]["avg_move_pct"] == 3.0
    assert stats[("doji", "neutral")]["win_rate"] is None
    assert stats[("doji", "neutral")]["avg_move_pct"] == 4.0
    assert ("hammer", "bullish") not in stats


async def test_patterns_endpoint(settings):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from tests.test_candles import service

    app.dependency_overrides[deps.get_candle_service] = lambda: service(settings)
    try:
        with TestClient(app) as client:
            catalog = client.get("/api/patterns/candlestick/catalog").json()
            assert len(catalog["patterns"]) == 61

            chart = client.get("/api/chart", params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 300}).json()
            times = {c["time"] for c in chart["candles"]}

            body = client.get(
                "/api/patterns/candlestick",
                params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 300, "all_patterns": True, "in_context": False},
            ).json()
            assert body["hits"], "synthetic data should trigger some patterns"
            assert all(h["time"] in times for h in body["hits"])  # only visible bars

            only = client.get(
                "/api/patterns/candlestick",
                params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 300, "patterns": "doji,engulfing", "in_context": False},
            ).json()
            assert {h["pattern"] for h in only["hits"]} <= {"doji", "engulfing"}

            in_ctx = client.get(
                "/api/patterns/candlestick",
                params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 300, "all_patterns": True},
            ).json()
            assert all(h["in_context"] for h in in_ctx["hits"])

            bad = client.get("/api/patterns/candlestick", params={"symbol": "X", "patterns": "nope"})
            assert bad.status_code == 400
    finally:
        app.dependency_overrides.clear()
