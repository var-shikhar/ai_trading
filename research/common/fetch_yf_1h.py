"""Download 1h NSE bars from Yahoo into research/data/yf_1h.duckdb.

    research/.venv/Scripts/python.exe research/common/fetch_yf_1h.py

Yahoo serves only the last ~730 days of 60-minute bars. This script
*appends* (upsert on symbol + bar start), so re-running it every few months
grows the archive beyond Yahoo's window. Re-run at least once a year or
history is lost for good.

Bars are stored **unadjusted** (auto_adjust=False): adjusted intraday
prices would change on every new dividend and break appended history.
Split/bonus adjustment is applied at load time (see data.py) using the
daily adjusted vs raw ratio. ts = bar start, IST wall clock, naive.
NSE 1h bars run 09:15, 10:15, ..., 15:15 (the last one is 15 minutes long).
"""

import sys
import time
from pathlib import Path

import duckdb
import pandas as pd
import yfinance as yf

from universe import INDICES, STOCKS

DB = Path(__file__).resolve().parents[1] / "data" / "yf_1h.duckdb"


def main() -> None:
    con = duckdb.connect(str(DB))
    con.execute(
        "CREATE TABLE IF NOT EXISTS bars_1h (symbol VARCHAR, ts TIMESTAMP, open DOUBLE, high DOUBLE, low DOUBLE,"
        " close DOUBLE, volume BIGINT, PRIMARY KEY (symbol, ts))"
    )
    tickers = {**{s: f"{s}.NS" for s in STOCKS}, **INDICES}
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    missing = []
    for name, yt in tickers.items():
        if only and name not in only:
            continue
        try:
            df = yf.download(yt, interval="60m", period="730d", auto_adjust=False, progress=False, threads=False)
        except Exception as e:  # network hiccup: skip, rerun later
            print(name, "failed", e)
            missing.append(name)
            continue
        if df is None or df.empty:
            missing.append(name)
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.rename(columns=str.lower).reset_index()
        df = df.rename(columns={df.columns[0]: "ts"})
        ts = pd.to_datetime(df["ts"])
        df["ts"] = (ts.dt.tz_convert("Asia/Kolkata") if ts.dt.tz is not None else ts).dt.tz_localize(None)
        df = df[["ts", "open", "high", "low", "close", "volume"]].dropna()
        df = df[(df["high"] > 0) & (df["close"] > 0)]
        df["symbol"] = name
        df["volume"] = df["volume"].fillna(0).astype("int64")
        con.register("df", df)
        con.execute("INSERT OR REPLACE INTO bars_1h SELECT symbol, ts, open, high, low, close, volume FROM df")
        con.unregister("df")
        n = con.execute("SELECT count(*), min(ts) FROM bars_1h WHERE symbol = ?", [name]).fetchone()
        print(f"{name}: +{len(df)} fetched, {n[0]} stored from {n[1]}", flush=True)
        time.sleep(0.3)
    print("missing:", missing)
    con.close()


if __name__ == "__main__":
    main()
