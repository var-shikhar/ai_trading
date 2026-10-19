"""1h bars, adjusted consistently with the daily bhavcopy panel.

Yahoo's 1h history is adjusted inconsistently (some bonuses applied, the
BAJFINANCE 2025 split only half, the SIEMENS 2025 demerger not at all:
common/check_1h_splits.py). So Yahoo's adjustment is undone and ours applied:

  y(d)  = last 1h close of day d / NSE raw close of day d   (Yahoo's scale)
  y~(d) = rolling median of y over 5 sessions (removes the small gap between
          the last bar's close and NSE's official closing price)
  adjusted 1h price = Yahoo price / y~(d) * cum_factor(d)

cum_factor comes from adjust.adjusted_panel(), so daily and 1h use exactly the
same split/bonus/demerger factors. A centred median is fine here: these are
historical corporate facts, not trading signals. Days whose Yahoo scale moves
by more than 2% from the smoothed scale are dropped (bad or partial bars).

    from hourly import load_1h
    bars = load_1h(["RELIANCE", "BAJFINANCE"])   # dict symbol -> DataFrame (ts index)
"""

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

import adjust

DB1H = Path(__file__).resolve().parents[1] / "data" / "yf_1h.duckdb"


def load_1h(symbols: list[str] | None = None, panel: pd.DataFrame | None = None) -> dict[str, pd.DataFrame]:
    con = duckdb.connect(str(DB1H), read_only=True)
    q = "SELECT * FROM bars_1h" + (f" WHERE symbol IN ({','.join('?' * len(symbols))})" if symbols else "") + " ORDER BY symbol, ts"
    h = con.execute(q, symbols or []).df()
    con.close()
    if panel is None:
        panel = adjust.adjusted_panel()
    raw_close = panel.assign(raw_close=panel["close"] / panel["cum_factor"]).set_index(["canon", "date"])[["raw_close", "cum_factor"]]
    out = {}
    for sym, g in h.groupby("symbol"):
        g = g.set_index("ts").sort_index()
        day = g.index.normalize()
        last = g["close"].groupby(day).last()
        try:
            ref = raw_close.loc[sym].reindex(last.index)
        except KeyError:
            continue
        y = last / ref["raw_close"]
        ys = y.rolling(5, center=True, min_periods=3).median()
        good = (np.abs(np.log(y / ys)) < 0.02) & ref["cum_factor"].notna()
        scale = (ref["cum_factor"] / ys).where(good)
        m = scale.reindex(day).to_numpy()
        adj = g.copy()
        for c in ("open", "high", "low", "close"):
            adj[c] = g[c].to_numpy() * m
        adj["volume"] = g["volume"].to_numpy() / m
        adj = adj[np.isfinite(m)]
        adj.attrs["dropped_days"] = int((~good).sum())
        out[sym] = adj
    return out


if __name__ == "__main__":
    # validate: day returns from adjusted 1h (last bar) vs adjusted bhavcopy, all stocks
    pan = adjust.adjusted_panel(adjust.load_canon())
    bars = load_1h(panel=pan)
    pidx = pan.set_index(["canon", "date"])["close"]
    rows = []
    for s, b in bars.items():
        dc = b["close"].groupby(b.index.normalize()).last()
        ref = pidx.loc[s].reindex(dc.index)
        j = pd.DataFrame({"h": dc.pct_change(), "d": ref.pct_change()}).dropna()
        if len(j) > 100:
            rows.append({"symbol": s, "corr": j.h.corr(j.d), "days": len(j), "dropped": b.attrs["dropped_days"],
                         "off5pp": int(((j.h - j.d).abs() > 0.05).sum())})
    r = pd.DataFrame(rows)
    print(f"stocks {len(r)}: median corr {r['corr'].median():.4f}, min {r['corr'].min():.4f}; "
          f"days off >5pp {r.off5pp.sum()}; dropped days total {r.dropped.sum()}")
    print(r.nsmallest(6, "corr").round(4).to_string(index=False))
    print(r[r.symbol.isin(["BAJFINANCE", "SIEMENS", "TRENT", "CONCOR", "RELIANCE", "HDFCBANK"])].round(4).to_string(index=False))
