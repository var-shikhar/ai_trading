"""Load daily bars for research.

Source: research/data/yf.duckdb (Yahoo daily, adjusted, 2005+), built by
fetch_yf.py. The app's own cache (backend/data/market.duckdb, Fyers data)
only has ~1.7 years for most stocks, so it's used for cross-checks only.
"""

from functools import lru_cache
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
YF_DB = ROOT / "research" / "data" / "yf.duckdb"
# Market-data-only copy of the app's Fyers cache (common/clean_fyers_copy.py).
# The app's own file also holds login tokens and user data; research never reads it.
APP_DB = ROOT / "research" / "data" / "fyers_snapshot" / "fyers_market.duckdb"
INDEX_NAMES = ("NIFTY50", "BANKNIFTY")


@lru_cache(maxsize=1)
def _all() -> pd.DataFrame:
    con = duckdb.connect(str(YF_DB), read_only=True)
    df = con.execute("SELECT symbol, ts, open, high, low, close, volume FROM daily ORDER BY symbol, ts").df()
    con.close()
    df["ts"] = pd.to_datetime(df["ts"])
    return df


def symbols(include_indices: bool = False) -> list[str]:
    s = sorted(_all()["symbol"].unique())
    return s if include_indices else [x for x in s if x not in INDEX_NAMES]


def bars(symbol: str, start: str | None = None, end: str | None = None) -> pd.DataFrame:
    """One symbol, indexed by date, cleaned: drops zero-range/zero-volume
    stale rows that Yahoo sometimes carries (holidays, suspensions)."""
    df = _all()
    df = df[df["symbol"] == symbol].drop(columns="symbol").set_index("ts")
    if symbol == "NIFTY50" and APP_DB.exists():
        # Yahoo's ^NSEI only starts 2007-09-17. The Fyers cache has it from 1998
        # and matches Yahoo exactly on the overlap (common/check_index.py).
        early = app_bars("NSE:NIFTY50-INDEX")
        early.index = pd.to_datetime(early.index).normalize()
        df = pd.concat([early[early.index < df.index[0]], df])
    if symbol not in INDEX_NAMES:
        df = df[~((df["high"] == df["low"]) & (df["volume"] == 0))]
        # Yahoo misses some old splits/demergers (VOLTAS +932% in 2006, ABB
        # 2007, ...). A one-day move beyond 60% is treated as a data break:
        # history starts after the last one.
        jumps = df["close"].pct_change().abs() > 0.6
        if jumps.any():
            df = df[df.index > df.index[jumps.to_numpy()][-1]]
    if start:
        df = df[df.index >= start]
    if end:
        df = df[df.index <= end]
    return df.copy()


def panel(start: str | None = None, end: str | None = None, min_bars: int = 300) -> dict[str, pd.DataFrame]:
    out = {}
    for s in symbols():
        df = bars(s, start, end)
        if len(df) >= min_bars:
            out[s] = df
    return out


def app_bars(fyers_symbol: str) -> pd.DataFrame:
    """Daily bars from the app's Fyers cache, e.g. 'NSE:RELIANCE-EQ'."""
    con = duckdb.connect(str(APP_DB), read_only=True)
    df = con.execute(
        "SELECT ts, open, high, low, close, volume FROM candles WHERE symbol = ? AND resolution = 'D' ORDER BY ts",
        [fyers_symbol],
    ).df()
    con.close()
    return df.set_index("ts")
