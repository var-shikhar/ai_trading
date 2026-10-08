import numpy as np
import pandas as pd

from app.analysis.chart_patterns import detect, zigzag


def path(*legs, start=100.0):
    """Close prices walking linearly through (target, bars) legs."""
    closes = [start]
    for target, bars in legs:
        closes += list(np.linspace(closes[-1], target, bars + 1)[1:])
    return np.array(closes)


def frame(closes, wick=0.4):
    n = len(closes)
    opens = np.r_[closes[0], closes[:-1]]
    return pd.DataFrame(
        {
            "time": np.arange(n) * 86400 + 1_700_000_000,
            "open": opens,
            "high": np.maximum(opens, closes) + wick,
            "low": np.minimum(opens, closes) - wick,
            "close": closes,
            "volume": 1000,
        }
    )


def find(result, kind):
    return [p for p in result["patterns"] if p["type"] == kind]


def test_zigzag_alternates_and_marks_the_live_extreme():
    df = frame(path((120, 20), (105, 15), (125, 20), (115, 6)))
    h, l, c = (df[k].to_numpy() for k in ("high", "low", "close"))
    from app.analysis.studies import atr

    sw = zigzag(h, l, atr(df, 14).to_numpy(), 2.0)
    kinds = [s.kind for s in sw]
    assert all(a != b for a, b in zip(kinds, kinds[1:]))  # strictly alternating
    assert sw[-1].confirmed is False and all(s.confirmed for s in sw[:-1])
    highs = [s.price for s in sw if s.kind == "H"]
    assert max(highs) > 124


def test_double_top_confirmed_with_neckline_target():
    # rally, top ~130, dip to 118, retest ~130, break below 118
    df = frame(path((130, 30), (118, 12), (130.2, 12), (108, 20), start=95))
    tops = find(detect(df), "double_top")
    assert tops, "double top not found"
    t = tops[-1]
    assert t["status"] == "confirmed" and t["direction"] == "bearish"
    neck = t["lines"][0]["from"]["price"]
    assert abs(neck - 117.6) < 1.0  # dip low incl. wick
    assert abs(t["target"] - (neck - (130.6 - neck))) < 1.0


def test_double_bottom_forming_until_neckline_breaks():
    df = frame(path((80, 30), (92, 12), (80.3, 12), (86, 5), start=110))
    bottoms = find(detect(df), "double_bottom")
    assert bottoms and bottoms[-1]["status"] == "forming"


def test_head_and_shoulders():
    df = frame(path((120, 20), (110, 10), (132, 12), (110, 12), (120.5, 10), (100, 18), start=95))
    hs = find(detect(df), "head_shoulders")
    assert hs, "H&S not found"
    p = hs[-1]
    assert p["status"] == "confirmed" and len(p["points"]) == 5
    assert p["points"][2]["price"] > p["points"][0]["price"] + 5  # head above shoulders


def test_inverse_head_and_shoulders():
    df = frame(path((90, 20), (100, 10), (78, 12), (100, 12), (89.5, 10), (110, 18), start=115))
    assert find(detect(df), "inverse_head_shoulders")


def test_ascending_triangle_breaks_up():
    # flat tops ~120, rising lows 104 -> 109 -> 113, then breakout
    df = frame(path((120, 15), (104, 10), (120, 10), (109, 8), (120, 8), (113, 6), (120, 6), (130, 8), start=100))
    tri = find(detect(df, "high"), "ascending_triangle")
    assert tri, "ascending triangle not found"
    assert tri[-1]["status"] == "confirmed" and tri[-1]["direction"] == "bullish"


def test_bull_flag():
    # sharp pole 100 -> 125 in 10 bars, shallow drift down, breakout
    closes = path((125, 10), (120, 8), (132, 6), start=100)
    flags = find(detect(frame(closes, wick=0.3), "medium"), "bull_flag")
    assert flags, "bull flag not found"
    assert flags[-1]["status"] == "confirmed"
    assert flags[-1]["target"] > 140  # pole (~25) projected from the flag


def test_zones_cluster_repeated_swing_levels():
    legs = []
    for _ in range(4):
        legs += [(120, 8), (100, 8)]
    df = frame(path(*legs, (110, 4), start=100))
    zs = detect(df)["zones"]
    assert zs, "no zones"
    strongest = zs[0]
    assert strongest["touches"] >= 3
    assert {z["kind"] for z in zs} == {"support", "resistance"}


def test_short_or_flat_data_is_safe():
    assert detect(frame(np.full(10, 100.0)))["patterns"] == []
    assert detect(frame(np.full(300, 100.0)))["patterns"] == []


def test_endpoint(settings):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from tests.test_candles import service

    app.dependency_overrides[deps.get_candle_service] = lambda: service(settings)
    try:
        with TestClient(app) as client:
            body = client.get("/api/patterns/chart", params={"symbol": "NSE:SBIN-EQ", "tf": "1D", "limit": 300}).json()
            assert set(body) == {"swings", "patterns", "zones"}
            bad = client.get("/api/patterns/chart", params={"symbol": "X", "sensitivity": "extreme"})
            assert bad.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_overlapping_duplicates_are_merged():
    from app.analysis.chart_patterns import _dedupe

    def pat(kind, start, end, n=3):
        return {"type": kind, "start_time": start, "end_time": end, "points": [0] * n}

    out = _dedupe([pat("double_top", 0, 100), pat("double_top", 10, 110), pat("double_top", 300, 400),
                   pat("bull_flag", 0, 100)])
    assert [(p["type"], p["start_time"]) for p in out] == [("bull_flag", 0), ("double_top", 10), ("double_top", 300)]
