"""Verify research/data/nse_bhav.duckdb: completeness, consistency, coverage.

1. Resume log: files vs no-file days, anything left to retry.
2. Calendar: every NIFTY 50 trading day (Fyers/Yahoo index history) has a
   cash-market file and an F&O file; trading days per year.
3. Universe: EQ symbols per year; names that stopped trading (delisted,
   merged or renamed) and how many of those were liquid; F&O stocks per year.
4. Prices: day returns from bhavcopy vs Yahoo for our 132 stocks.
"""

from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

import data
from universe import STOCKS

DB = Path(__file__).resolve().parents[1] / "data" / "nse_bhav.duckdb"
OUT = Path(__file__).resolve().parents[1] / "data" / "verify_bhav.txt"
con = duckdb.connect(str(DB), read_only=True)
lines = []


def say(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    lines.append(s)


say("## 1. resume log")
say(con.execute("SELECT kind, status, count(*) AS n, min(date), max(date) FROM fetched GROUP BY 1, 2 ORDER BY 1, 2").df().to_string(index=False))

say("\n## 2. calendar")
files = con.execute("SELECT date, kind FROM fetched WHERE status = 200").df()
files["date"] = pd.to_datetime(files["date"]).dt.date
cm_days = set(files[files.kind == "cm"].date)
fo_days = set(files[files.kind == "fo"].date)
idx = data.bars("NIFTY50", "2005-01-01")
idx_days = {d.date() for d in idx.index}
say(f"cm files {len(cm_days)}, fo files {len(fo_days)}, NIFTY trading days {len(idx_days)} ({min(idx_days)} .. {max(idx_days)})")
last = max(idx_days)
miss_cm = sorted(d for d in idx_days if d not in cm_days)
miss_fo = sorted(d for d in idx_days if d not in fo_days)
say(f"NIFTY days without a cm file: {len(miss_cm)} {miss_cm[:15]}")
say(f"NIFTY days without an fo file: {len(miss_fo)} {miss_fo[:15]}")
extra = sorted(d for d in cm_days if d not in idx_days and d <= last)
say(f"cm files on days NIFTY history lacks: {len(extra)} {extra[:15]}")
say("cm-only days:", sorted(cm_days - fo_days)[:15], "| fo-only days:", sorted(fo_days - cm_days)[:15])
per_year = pd.Series(sorted(cm_days)).map(lambda d: d.year).value_counts().sort_index()
say("cm trading days per year:", per_year.to_dict())

say("\n## 3. universe")
eq = con.execute("""
    SELECT symbol, min(date) AS first, max(date) AS last, count(*) AS days, median(value) AS med_value
    FROM cm_bhav WHERE series = 'EQ' GROUP BY 1
""").df()
say(f"EQ-series symbols ever: {len(eq)}")
yr = con.execute("SELECT year(date) AS y, count(DISTINCT symbol) FROM cm_bhav WHERE series = 'EQ' GROUP BY 1 ORDER BY 1").fetchall()
say("EQ symbols per year:", dict(yr))
eq["first"], eq["last"] = pd.to_datetime(eq["first"]).dt.date, pd.to_datetime(eq["last"]).dt.date
gone = eq[eq["last"] < last - pd.Timedelta(days=60)]
liquid = gone[gone.med_value >= 5e7]  # median traded value >= Rs 5 crore/day while listed
say(f"stopped trading (> 60 days before the end): {len(gone)}; of those with median value >= Rs 5 cr/day: {len(liquid)}")
say("largest by median traded value:", liquid.nlargest(25, "med_value")[["symbol", "first", "last"]].astype(str).values.tolist())
now_liquid = eq[(eq["last"] >= last - pd.Timedelta(days=10)) & (eq.med_value >= 5e7)]
say(f"currently trading with median value >= Rs 5 cr/day: {len(now_liquid)}; our research universe: {len(STOCKS)}, "
    f"of which found in bhavcopy: {len(set(STOCKS) & set(eq.symbol))}, missing: {sorted(set(STOCKS) - set(eq.symbol))}")
fo = con.execute("SELECT year(date) AS y, count(DISTINCT symbol) FROM fo_fut WHERE instrument = 'FUTSTK' GROUP BY 1 ORDER BY 1").fetchall()
say("F&O stocks (with futures) per year:", dict(fo))
lot = con.execute("SELECT min(date), count(DISTINCT symbol) FROM fo_fut WHERE lot_size IS NOT NULL").fetchone()
say("lot sizes available from", lot[0], "for", lot[1], "symbols")

say("\n## 4. prices vs Yahoo (day returns, our universe)")
cors, big, ca_days, n_days = [], 0, 0, 0
for s in STOCKS:
    b = con.execute("SELECT date, close, prevclose FROM cm_bhav WHERE symbol = ? AND series = 'EQ' ORDER BY date", [s]).df()
    if len(b) < 200:
        continue
    b["date"] = pd.to_datetime(b["date"])
    b = b.set_index("date")
    # bhavcopy return using NSE's own prevclose (adjusted on corporate-action days)
    rb = b["close"] / b["prevclose"] - 1
    y = data.bars(s, "2005-01-01")["close"].pct_change()
    j = pd.concat([rb.rename("b"), y.rename("y")], axis=1, sort=True).dropna()
    # bhavcopy is raw: split/bonus days show -50%..-90% there and ~0% in adjusted Yahoo
    ca = (j.b.abs() > 0.2) | (j.y.abs() > 0.2)
    ca_days += int(ca.sum())
    j = j[~ca]
    if len(j) > 200:
        cors.append(j.corr().iloc[0, 1])
        big += int(((j.b - j.y).abs() > 0.05).sum())
        n_days += len(j)
say(f"stocks compared {len(cors)}, corporate-action days excluded {ca_days}; median corr {np.median(cors):.4f}, "
    f"10th pct {np.percentile(cors, 10):.4f}, min {np.min(cors):.4f}; days with >5pp disagreement {big} of {n_days}")
OUT.write_text("\n".join(lines), encoding="utf-8")
