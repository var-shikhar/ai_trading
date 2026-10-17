"""Is 1h workable as a trading timeframe on NSE? (YTC PAT p453-454: the
lowest workable timeframe is set by swing size relative to costs.)

For each stock, on the same window (Yahoo 1h coverage, Nov 2023 ->):
- 1h bars (Yahoo, unadjusted; bars spanning a >25% jump are dropped),
- daily bars (Yahoo adjusted), and weekly bars resampled from daily:
  swing-leg size and duration (YTC 2-bar pivots, ex-post legs: this is a
  descriptive size measure, not a tradeable signal), legs per year, and
  cost / median leg (round trip 0.3%).
Also for 1h: bars per session, how much of the 1h range is the overnight
gap, and a check that 1h bars aggregate to the Yahoo daily bar.

    <app>/backend/.venv/Scripts/python.exe research/02_timeframe_check/analyze_tf.py
"""

import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0] / "common"))
import data  # noqa: E402
import structure  # noqa: E402

DB1H = HERE.parents[0] / "data" / "yf_1h.duckdb"
COST = 0.003  # round trip: 2 x (0.1% fees + 0.05% slippage)
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)


def legs_stats(df: pd.DataFrame) -> dict:
    lg = structure.legs(df, 2)
    if lg.empty:
        return {}
    a = lg["pct"].abs() / 100
    span_days = (df.index[-1] - df.index[0]).days / 365.25
    return {"legs": len(lg), "legs_per_year": len(lg) / span_days, "med_leg%": a.median() * 100,
            "p25_leg%": a.quantile(0.25) * 100, "med_bars": lg["bars"].median(),
            "cost_over_med_leg": COST / a.median(), "share_legs_under_3x_cost": (a < 3 * COST).mean()}


def main() -> None:
    con = duckdb.connect(str(DB1H), read_only=True)
    h = con.execute("SELECT * FROM bars_1h ORDER BY symbol, ts").df()
    con.close()
    rows, sess = [], []
    for sym, g in h.groupby("symbol"):
        if sym in data.INDEX_NAMES:
            continue
        g = g.set_index("ts")[["open", "high", "low", "close", "volume"]]
        g = g[~(g["close"].pct_change().abs() > 0.25)]  # split/bonus breaks in unadjusted data
        d = data.bars(sym, str(g.index[0].date()), str(g.index[-1].date()))
        if len(d) < 200 or len(g) < 1000:
            continue
        w = d.resample("W-FRI").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
        for tf, df in (("1h", g), ("D", d), ("W", w)):
            rows.append({"symbol": sym, "tf": tf, **legs_stats(df)})
        # session structure and overnight gap share
        day = g.index.normalize()
        per_day = g.groupby(day).size()
        first = g.groupby(day).head(1)
        prev_close = g["close"].groupby(day).last().shift().reindex(first.index.normalize()).to_numpy()
        gap = np.abs(first["open"].to_numpy() / prev_close - 1)
        rng = (g["high"] / g["low"] - 1)
        # daily from 1h vs Yahoo daily: compare day returns (adjustment-free)
        dc = g["close"].groupby(day).last()
        both = pd.concat([dc.pct_change().rename("h"), d["close"].pct_change().rename("d")], axis=1, sort=True).dropna()
        sess.append({"symbol": sym, "bars_per_day_mode": per_day.mode().iloc[0], "days_short": (per_day < per_day.mode().iloc[0]).mean(),
                     "med_gap%": np.nanmedian(gap) * 100, "med_1h_range%": rng.median() * 100,
                     "first_bar_range%": (first["high"] / first["low"] - 1).median() * 100,
                     "corr_daily_ret_1h_vs_yahoo": both.corr().iloc[0, 1] if len(both) > 50 else np.nan})
    R = pd.DataFrame(rows)
    S = pd.DataFrame(sess)
    R.to_csv(OUT / "legs_by_tf.csv", index=False)
    S.to_csv(OUT / "session_1h.csv", index=False)
    print(f"stocks: {R.symbol.nunique()}, window {h.ts.min()} .. {h.ts.max()}")
    print("\nSwing legs by timeframe (median across stocks):")
    print(R.groupby("tf")[["legs_per_year", "med_leg%", "p25_leg%", "med_bars", "cost_over_med_leg", "share_legs_under_3x_cost"]]
          .median().round(3).reindex(["1h", "D", "W"]).to_string())
    print("\n1h cost/median-leg distribution across stocks:", R[R.tf == "1h"].cost_over_med_leg.describe().round(3).to_dict())
    print("\n1h session structure (median across stocks):")
    print(S.drop(columns="symbol").median().round(3).to_string())
    print("\nworst daily-return agreement (1h aggregated vs Yahoo daily):")
    print(S.nsmallest(5, "corr_daily_ret_1h_vs_yahoo")[["symbol", "corr_daily_ret_1h_vs_yahoo"]].round(3).to_string(index=False))


if __name__ == "__main__":
    main()
