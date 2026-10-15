"""Compare NIFTY 50 history: Yahoo (research cache) vs the app's Fyers cache."""

import duckdb
import pandas as pd

import data

c = duckdb.connect(str(data.APP_DB), read_only=True)
print(c.execute("SELECT symbol, min(ts), max(ts), count(*) FROM candles WHERE resolution = 'D' AND symbol LIKE '%INDEX%' GROUP BY 1").fetchall())
c.close()
fy = data.app_bars("NSE:NIFTY50-INDEX")
fy.index = pd.to_datetime(fy.index, unit="s") if not isinstance(fy.index, pd.DatetimeIndex) else fy.index
fy.index = fy.index.tz_localize(None).normalize() if fy.index.tz is not None else fy.index.normalize()
yf = data.bars("NIFTY50")
both = pd.concat([fy["close"].rename("fyers"), yf["close"].rename("yahoo")], axis=1).dropna()
print("overlap", both.index[0].date(), both.index[-1].date(), len(both))
print("daily return corr", both.pct_change().corr().iloc[0, 1].round(4), "median abs close diff %", ((both.fyers / both.yahoo - 1).abs().median() * 100).round(3))
print("fyers first rows:\n", fy.head(3))
