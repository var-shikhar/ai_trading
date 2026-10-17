"""Compare market data in the worktree's old Fyers snapshot with the clean copy.
Reads only the candles table of each (never the tokens table)."""

from pathlib import Path

import duckdb

root = Path(__file__).resolve().parents[2]
old = root / "backend" / "data" / "market.duckdb"
new = root / "research" / "data" / "fyers_snapshot" / "fyers_market.duckdb"
q = "SELECT resolution, count(DISTINCT symbol), count(*), max(ts) FROM candles GROUP BY 1 ORDER BY 1"
for name, p in (("old snapshot", old), ("clean copy", new)):
    con = duckdb.connect(str(p), read_only=True)
    print(name, con.execute(q).fetchall())
    con.close()
con = duckdb.connect(":memory:")
con.execute(f"ATTACH '{old.as_posix()}' AS o (READ_ONLY)")
con.execute(f"ATTACH '{new.as_posix()}' AS n (READ_ONLY)")
only_old = con.execute("SELECT count(*) FROM (SELECT symbol, resolution, ts FROM o.candles EXCEPT SELECT symbol, resolution, ts FROM n.candles)").fetchone()[0]
only_new = con.execute("SELECT count(*) FROM (SELECT symbol, resolution, ts FROM n.candles EXCEPT SELECT symbol, resolution, ts FROM o.candles)").fetchone()[0]
print("bars only in old snapshot:", only_old, "| bars only in clean copy:", only_new)
