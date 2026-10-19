"""Look up NSE symbol changes for the given symbols (old or new side), and
their last bhavcopy dates. Usage: lookup_symbol.py SYM [SYM ...]"""

import sys
from pathlib import Path

import duckdb

d = Path(__file__).resolve().parents[1] / "data"
syms = sys.argv[1:] or ["TATAMOTORS", "LTIM"]
con = duckdb.connect(str(d / "nse_ref.duckdb"), read_only=True)
q = ",".join("?" * len(syms))
print(con.execute(f"SELECT * FROM symbol_changes WHERE old_symbol IN ({q}) OR new_symbol IN ({q}) ORDER BY effective",
                  syms + syms).df().to_string(index=False))
print(con.execute(f"SELECT symbol, subject, ex_date FROM corp_actions WHERE symbol IN ({q}) AND ex_date >= DATE '2024-01-01' ORDER BY ex_date",
                  syms).df().to_string(index=False))
con.close()
con = duckdb.connect(str(d / "nse_bhav.duckdb"), read_only=True)
print(con.execute(f"SELECT symbol, min(date), max(date) FROM cm_bhav WHERE series = 'EQ' AND symbol IN ({q}) GROUP BY 1", syms).df().to_string(index=False))
# candidates listed recently with the same ISIN prefix family are hard to guess: show new EQ symbols since 2025-06
print(con.execute("""SELECT symbol, min(date) AS first FROM cm_bhav WHERE series = 'EQ' GROUP BY 1
                     HAVING min(date) >= DATE '2025-06-01' AND (symbol LIKE 'TM%' OR symbol LIKE 'LT%') ORDER BY 2""").df().to_string(index=False))
