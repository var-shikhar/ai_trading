"""Download daily NSE history from Yahoo Finance into research/data/yf.duckdb.

Run with the research venv (it has yfinance):
    research/.venv/Scripts/python.exe research/common/fetch_yf.py

Prices are split/dividend adjusted (auto_adjust). The universe is today's
NIFTY 50 plus ~90 other large/mid caps, including names that have since left
the index or collapsed, to soften (not remove) survivorship bias.
"""

import sys
import time
from pathlib import Path

import duckdb
import pandas as pd
import yfinance as yf

from universe import INDICES, STOCKS

DB = Path(__file__).resolve().parents[1] / "data" / "yf.duckdb"
START = "2005-01-01"


def main() -> None:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB))
    con.execute(
        "CREATE TABLE IF NOT EXISTS daily (symbol VARCHAR, ts DATE, open DOUBLE, high DOUBLE, low DOUBLE,"
        " close DOUBLE, volume BIGINT, PRIMARY KEY (symbol, ts))"
    )
    tickers = {**{s: f"{s}.NS" for s in STOCKS}, **INDICES}
    missing = []
    for name, yt in tickers.items():
        if con.execute("SELECT count(*) FROM daily WHERE symbol = ?", [name]).fetchone()[0] and "--refresh" not in sys.argv:
            continue
        try:
            df = yf.download(yt, start=START, auto_adjust=True, progress=False, threads=False)
        except Exception as e:  # network hiccup: skip, rerun later
            print(name, "failed", e)
            missing.append(name)
            continue
        if df is None or df.empty:
            missing.append(name)
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df.rename(columns=str.lower).reset_index().rename(columns={"Date": "ts", "date": "ts"})
        df = df[["ts", "open", "high", "low", "close", "volume"]].dropna()
        df = df[(df["high"] > 0) & (df["close"] > 0)]
        df["symbol"] = name
        df["ts"] = pd.to_datetime(df["ts"]).dt.date
        df["volume"] = df["volume"].fillna(0).astype("int64")
        con.execute("DELETE FROM daily WHERE symbol = ?", [name])
        con.register("df", df)
        con.execute("INSERT INTO daily SELECT symbol, ts, open, high, low, close, volume FROM df")
        con.unregister("df")
        print(f"{name}: {len(df)} bars from {df['ts'].min()}")
        time.sleep(0.3)
    print("missing:", missing)
    con.close()


if __name__ == "__main__":
    main()
