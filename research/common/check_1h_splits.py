"""Are Yahoo 1h bars split-adjusted? Look at bars around known ex-dates."""

from pathlib import Path

import duckdb

con = duckdb.connect(str(Path(__file__).resolve().parents[1] / "data" / "yf_1h.duckdb"), read_only=True)
for sym, d in (("BAJFINANCE", "2025-06-16"), ("HDFCBANK", "2025-08-26"), ("RELIANCE", "2024-10-28"),
               ("SIEMENS", "2025-04-07"), ("TRENT", "2026-06-04")):
    df = con.execute(f"""SELECT ts, open, close FROM bars_1h WHERE symbol = ?
                         AND ts BETWEEN DATE '{d}' - INTERVAL 3 DAY AND DATE '{d}' + INTERVAL 1 DAY ORDER BY ts""", [sym]).df()
    day_last = df.groupby(df.ts.dt.date).close.last()
    print(sym, d, "daily last 1h close:", {str(k): round(v, 1) for k, v in day_last.items()})
