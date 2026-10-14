import numpy as np
import pandas as pd
import pytest

from app.backtest import engine, signals
from tests.test_chart_patterns import frame, path

pytestmark = pytest.mark.anyio

DAY = 86400


def bars(rows):
    """rows: (open, high, low, close); one per day."""
    return pd.DataFrame(
        {
            "time": [1_700_006_400 + i * DAY for i in range(len(rows))],
            "open": [r[0] for r in rows],
            "high": [r[1] for r in rows],
            "low": [r[2] for r in rows],
            "close": [r[3] for r in rows],
            "volume": 1000,
        }
    )


def symbol(df, entry_at=(), exit_at=(), liquidity=1.0):
    d = engine.prepare(df, [], [])
    d.entry = np.zeros(len(df), bool)
    d.entry[list(entry_at)] = True
    d.exit = np.zeros(len(df), bool)
    d.exit[list(exit_at)] = True
    d.liquidity = np.full(len(df), liquidity)
    return d


def no_costs(**kw):
    return engine.Rules(cost_pct=0, slippage_pct=0, capital=100_000, sizing="fixed", size_value=10_000, **kw)


def window(df):
    return int(df["time"].iloc[0]), int(df["time"].iloc[-1])


def test_entry_fills_next_open_and_closes_at_end():
    df = bars([(100, 101, 99, 100), (102, 105, 101, 104), (104, 108, 103, 107), (107, 110, 106, 109)])
    out = engine.run({"A": symbol(df, entry_at=[0])}, no_costs(stop_type="none", target_type="none"), *window(df))
    (t,) = out["trades"]
    assert t.entry_price == 102  # bar 1 open, not bar 0 close
    assert t.exit_price == 109 and t.reason == "end"
    assert t.qty == 98  # floor(10000 / 102)
    assert t.pnl == pytest.approx((109 - 102) * 98)
    assert out["equity"][-1][1] == pytest.approx(100_000 + t.pnl)


def test_stop_target_gaps_and_same_bar_rule():
    # stop 5% below 100 = 95, target 2R = 110
    rules = no_costs(stop_type="pct", stop_value=5, target_type="r", target_value=2)
    stopped = bars([(100, 100, 100, 100), (100, 101, 99, 100), (99, 100, 94, 96)])
    (t,) = engine.run({"A": symbol(stopped, [0])}, rules, *window(stopped))["trades"]
    assert t.reason == "stop" and t.exit_price == 95 and t.r == pytest.approx(-1)

    gapped = bars([(100, 100, 100, 100), (100, 101, 99, 100), (90, 92, 88, 91)])
    (t,) = engine.run({"A": symbol(gapped, [0])}, rules, *window(gapped))["trades"]
    assert t.exit_price == 90  # gap through the stop fills at the open

    target = bars([(100, 100, 100, 100), (100, 101, 99, 100), (104, 112, 103, 111)])
    (t,) = engine.run({"A": symbol(target, [0])}, rules, *window(target))["trades"]
    assert t.reason == "target" and t.exit_price == 110 and t.r == pytest.approx(2)

    both = bars([(100, 100, 100, 100), (100, 101, 99, 100), (100, 115, 90, 100)])
    (t,) = engine.run({"A": symbol(both, [0])}, rules, *window(both))["trades"]
    assert t.reason == "stop"  # conservative when both are inside one bar


def test_rule_and_time_exits_fill_next_open():
    df = bars([(100, 101, 99, 100)] + [(100 + i, 102 + i, 99 + i, 101 + i) for i in range(1, 8)])
    rules = no_costs(stop_type="none", target_type="none")
    (t,) = engine.run({"A": symbol(df, [0], exit_at=[3])}, rules, *window(df))["trades"]
    assert t.reason == "rule" and t.exit_price == df["open"][4]
    timed = no_costs(stop_type="none", target_type="none", max_bars=2)
    (t,) = engine.run({"A": symbol(df, [0])}, timed, *window(df))["trades"]
    assert t.reason == "time" and t.bars == 2 and t.exit_price == df["open"][3]


def test_trailing_stop_ratchets():
    rows = [(100, 100, 100, 100), (100, 101, 99, 100), (110, 120, 109, 119), (118, 119, 107, 108)]
    df = bars(rows)
    rules = no_costs(stop_type="none", target_type="none", trail_type="pct", trail_value=10)
    (t,) = engine.run({"A": symbol(df, [0])}, rules, *window(df))["trades"]
    assert t.reason == "stop" and t.exit_price == pytest.approx(108)  # 120 high - 10%


def test_short_side_profits_when_price_falls():
    df = bars([(100, 100, 100, 100), (100, 101, 99, 100), (95, 96, 89, 90)])
    rules = no_costs(side="short", stop_type="pct", stop_value=5, target_type="pct", target_value=10)
    (t,) = engine.run({"A": symbol(df, [0])}, rules, *window(df))["trades"]
    assert t.reason == "target" and t.exit_price == 90 and t.pnl > 0


def test_max_positions_prefers_liquid_and_cash_adds_up():
    df = bars([(100, 101, 99, 100), (100, 103, 99, 102), (102, 104, 101, 103)])
    data = {
        "LIQUID": symbol(df, [0], liquidity=10.0),
        "THIN": symbol(df.copy(), [0], liquidity=1.0),
    }
    rules = no_costs(stop_type="none", target_type="none", max_positions=1)
    out = engine.run(data, rules, *window(df))
    assert [t.symbol for t in out["trades"]] == ["LIQUID"]

    costly = engine.Rules(capital=100_000, sizing="pct_equity", size_value=50, stop_type="none",
                          target_type="none", cost_pct=0.1, slippage_pct=0.05, max_positions=2)
    out = engine.run({"A": symbol(df, [0]), "B": symbol(df.copy(), [0])}, costly, *window(df))
    assert out["equity"][-1][1] == pytest.approx(100_000 + sum(t.pnl for t in out["trades"]), abs=0.05)
    assert all(t.pnl < (t.exit_price - t.entry_price) * t.qty for t in out["trades"])  # costs charged


def test_signals_have_no_lookahead():
    """Every condition's value at bar i must not change when later bars are removed."""
    rng = np.random.default_rng(7)
    closes = 100 + rng.normal(0, 1.5, 420).cumsum()
    df = frame(np.maximum(closes, 5))
    df["volume"] = rng.integers(500, 3000, len(df))
    params = {
        "consolidation": {"bars": 10, "pct": 6},
        "breakout": {"bars": 10, "pct": 8},
        "rsi": {"op": "<", "value": 45},
        "price_vs_ma": {"length": 50},
        "ma_cross": {"fast": 10, "slow": 30, "within": 3},
        "macd_cross": {"within": 2},
        "volume_spike": {"multiple": 1.5},
        "high_low_52w": {"kind": "high", "within_pct": 5},
        "candle_pattern": {"within": 2, "direction": "any", "in_context": False},
        "chart_pattern": {"within": 1},
    }
    assert set(params) == set(signals.SIGNALS)
    for name, p in params.items():
        full = signals.SIGNALS[name](df, p).fillna(False).astype(bool).to_numpy()
        for i in range(300, len(df), 23):
            cut = signals.SIGNALS[name](df.iloc[: i + 1].copy(), p).fillna(False).astype(bool).to_numpy()
            assert cut[i] == full[i], f"{name} looks ahead at bar {i}"


def test_breakout_signal_matches_scanner():
    from app.analysis import scanner

    flat = np.r_[np.linspace(90, 100, 40), 100 + np.sin(np.arange(15)) * 0.8, 104.0]
    df = frame(flat)
    p = {"bars": 15, "pct": 2.5, "direction": "up"}
    assert bool(signals.breakout(df, p).iloc[-1]) == scanner.breakout(df, p)[0] is True


async def test_backtest_job_end_to_end(settings):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from tests.test_candles import service

    svc = service(settings)
    app.dependency_overrides[deps.get_candle_service] = lambda: svc
    try:
        with TestClient(app) as client:
            body = {
                "name": "RSI dip",
                "universe": "symbol",
                "symbol": "NSE:SBIN-EQ",
                "start": "2025-01-01",
                "entry": [{"type": "rsi", "params": {"op": ">", "value": 0}}],  # always on: exercise the full loop
                "stop_type": "pct",
                "stop_value": 5,
                "target_type": "r",
                "target_value": 2,
            }
            job = client.post("/api/backtests", json=body).json()
            import time

            for _ in range(200):
                job = client.get(f"/api/backtests/jobs/{job['id']}").json()
                if job["status"] in ("done", "error"):
                    break
                time.sleep(0.05)
            assert job["status"] == "done", job
            result = client.get(f"/api/backtests/{job['result_id']}").json()
            s = result["summary"]
            assert s["trades"] == len(result["trades"]) > 0
            assert result["equity"][0][0] >= 1735689600  # starts at the start date
            assert {"cagr_pct", "max_drawdown_pct", "win_rate_pct", "profit_factor"} <= set(s)
            assert client.get("/api/backtests").json()[0]["id"] == job["result_id"]

            bad = client.post("/api/backtests", json={**body, "entry": [{"type": "near_zone"}]})
            assert bad.status_code == 400 and "zones" in bad.json()["detail"]
            no_stop = client.post("/api/backtests", json={**body, "stop_type": "none"})
            assert no_stop.status_code == 422  # R target needs a stop
            client.delete(f"/api/backtests/{job['result_id']}")
            assert client.get("/api/backtests").json() == []
    finally:
        app.dependency_overrides.clear()


async def test_chart_backtest_runs_on_chart_bars(settings):
    from fastapi.testclient import TestClient

    from app import deps
    from app.main import app
    from tests.test_candles import service

    svc = service(settings)
    app.dependency_overrides[deps.get_candle_service] = lambda: svc
    try:
        with TestClient(app) as client:
            body = {
                "symbol": "NSE:SBIN-EQ",
                "tf": "1D",
                "bars": 300,
                "entry": [{"type": "rsi", "params": {"op": ">", "value": 0}}],
                "stop_type": "pct",
                "stop_value": 5,
                "target_type": "r",
                "target_value": 2,
            }
            r = client.post("/api/backtests/chart", json=body)
            assert r.status_code == 200, r.text
            res = r.json()
            assert res["summary"]["trades"] == len(res["trades"]) > 0
            assert "buy_hold_return_pct" in res["summary"]
            assert res["from"] <= res["trades"][0]["entry_time"] <= res["to"]
            assert len(res["buy_hold"]) == res["bars_tested"]
            assert client.get("/api/backtests").json() == []  # chart runs aren't saved
            bad_tf = client.post("/api/backtests/chart", json={**body, "tf": "7m"})
            assert bad_tf.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_periods_per_year():
    from app.backtest.metrics import periods_per_year

    assert periods_per_year("1D") == 252
    assert periods_per_year("15m") == 252 * 25
    assert periods_per_year("1h") == 252 * 6.25
