"""Summarise a copy of the app's Fyers candle cache: symbols, resolutions,
date ranges, bar counts. Usage: inspect_fyers.py [path-to-duckdb]
Works on a copy only (opening with a WAL replays it into the copy)."""

import sys
from pathlib import Path

import duckdb

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "data" / "fyers_snapshot" / "market.duckdb"
con = duckdb.connect(str(path))
print("tables:", [r[0] for r in con.execute("SHOW TABLES").fetchall()])
df = con.execute("""
    SELECT resolution, count(DISTINCT symbol) AS symbols, min(ts) AS first, max(ts) AS last, count(*) AS bars
    FROM candles GROUP BY 1 ORDER BY 1
""").df()
print(df.to_string(index=False))
intr = con.execute("""
    SELECT symbol, resolution, min(ts) AS first, max(ts) AS last, count(*) AS bars
    FROM candles WHERE resolution <> 'D' GROUP BY 1, 2 ORDER BY 2, 1
""").df()
print(intr.to_string(index=False))
