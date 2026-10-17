"""Keep only market-data tables in the local copy of the app's cache.

The app's market.duckdb also holds login tokens and user data (tokens,
watchlists, drawings). Research needs none of that, so the copy is rebuilt
with only candles, instruments, coverage and universe_members. The
sibling app's own file is never opened by this script.
"""

from pathlib import Path

import duckdb

d = Path(__file__).resolve().parents[1] / "data" / "fyers_snapshot"
src, dst = d / "market.duckdb", d / "fyers_market.duckdb"
KEEP = ("candles", "instruments", "coverage", "universe_members")
dst.unlink(missing_ok=True)
con = duckdb.connect(str(dst))
con.execute(f"ATTACH '{src.as_posix()}' AS src (READ_ONLY)")
for t in KEEP:
    con.execute(f"CREATE TABLE {t} AS SELECT * FROM src.{t}")
    print(t, con.execute(f"SELECT count(*) FROM {t}").fetchone()[0])
con.execute("DETACH src")
con.close()
for f in (src, Path(str(src) + ".wal")):
    f.unlink(missing_ok=True)
print("kept", dst.name, "; removed the raw copy (with tokens/user data)")
