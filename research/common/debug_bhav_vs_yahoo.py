"""Where do bhavcopy and Yahoo day returns disagree? One stock, by year,
and the worst days side by side."""

import sys
from pathlib import Path

import duckdb
import pandas as pd

import data

sym = sys.argv[1] if len(sys.argv) > 1 else "SBIN"
con = duckdb.connect(str(Path(__file__).resolve().parents[1] / "data" / "nse_bhav.duckdb"), read_only=True)
b = con.execute("SELECT date, close, prevclose FROM cm_bhav WHERE symbol = ? AND series = 'EQ' ORDER BY date", [sym]).df()
print("duplicate dates:", b.date.duplicated().sum())
b["date"] = pd.to_datetime(b["date"])
b = b.set_index("date")
y = data.bars(sym, "2005-01-01")
j = pd.DataFrame({"b_ret": b.close / b.prevclose - 1, "b_ret_close": b.close.pct_change(), "y_ret": y.close.pct_change(),
                  "b_close": b.close, "y_close": y.close}).dropna()
print("corr bhav(prevclose) vs yahoo:", round(j.b_ret.corr(j.y_ret), 4), "| bhav(close-to-close) vs yahoo:", round(j.b_ret_close.corr(j.y_ret), 4))
print(j.groupby(j.index.year).apply(lambda g: round(g.b_ret.corr(g.y_ret), 3)).to_dict())
j["diff"] = (j.b_ret - j.y_ret).abs()
print(j.nlargest(8, "diff").round(4).to_string())
# is Yahoo shifted by a day?
print("corr with yahoo shifted -1/+1:", round(j.b_ret.corr(y.close.pct_change().shift(-1).reindex(j.index)), 3),
      round(j.b_ret.corr(y.close.pct_change().shift(1).reindex(j.index)), 3))
