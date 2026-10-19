"""Summarise research/data/nse_bhav.duckdb (read-only)."""

import sys
from pathlib import Path

import duckdb

con = duckdb.connect(str(Path(__file__).resolve().parents[1] / "data" / "nse_bhav.duckdb"), read_only=True)
print(con.execute("SELECT kind, status, count(*), min(date), max(date), sum(rows) FROM fetched GROUP BY 1, 2 ORDER BY 1, 2").df().to_string(index=False))
print(con.execute("SELECT min(date), max(date), count(DISTINCT date), count(DISTINCT symbol) FROM cm_bhav WHERE series = 'EQ'").fetchall())
print(con.execute("SELECT min(date), max(date), count(DISTINCT date), count(DISTINCT symbol), max(lot_size) FROM fo_fut WHERE instrument = 'FUTSTK'").fetchall())
sym = sys.argv[1] if len(sys.argv) > 1 else "RELIANCE"
print(con.execute("SELECT * FROM cm_bhav WHERE symbol = ? AND series = 'EQ' ORDER BY date DESC LIMIT 4", [sym]).df().to_string(index=False))
print(con.execute("SELECT * FROM fo_fut WHERE symbol = ? ORDER BY date DESC, expiry LIMIT 4", [sym]).df().to_string(index=False))
print(con.execute("SELECT * FROM fo_fut WHERE symbol = ? ORDER BY date, expiry LIMIT 3", [sym]).df().to_string(index=False))
