"""Validate adjust.py against Yahoo (adjusted) for our 132-stock universe.

- adjusted bhavcopy close-to-close returns vs Yahoo returns on ALL days
  (no corporate-action exclusion now): correlation, days off by >5pp;
- every inferred split inside the universe: what Yahoo shows that day
  (about 0% means Yahoo also adjusted it, so it was a real split; a big
  move means it was a real crash, wrongly adjusted away);
- known crashes that must survive (not be adjusted away);
- inferred splits by liquidity.
"""

import numpy as np
import pandas as pd

import adjust
import data
from universe import STOCKS

eq = adjust.load_canon()
print("rows loaded:", len(eq), "symbols:", eq.canon.nunique(), f"mem {eq.memory_usage(deep=True).sum() / 1e6:.0f} MB")
f = adjust.build(eq)
print("factors:", len(f), f.kind.value_counts().to_dict())
pan = adjust.adjusted_panel(eq)
pan = pan[pan.canon.isin(STOCKS)]
cors, off, n = [], [], 0
for s, g in pan.groupby("canon"):
    g = g.set_index("date")
    b = g["close"].pct_change()
    y = data.bars(s, "2005-01-01")["close"].pct_change()
    j = pd.concat([b.rename("b"), y.rename("y")], axis=1, sort=True).dropna()
    if len(j) < 200:
        continue
    cors.append(j.b.corr(j.y))
    n += len(j)
    bad = j[(j.b - j.y).abs() > 0.05]
    off += [(s, d.date(), round(r.b, 3), round(r.y, 3)) for d, r in bad.iterrows()]
print(f"universe stocks {len(cors)}: median corr {np.median(cors):.4f}, min {np.min(cors):.4f}; "
      f"days off by >5pp: {len(off)} of {n}")
print("largest disagreements:", sorted(off, key=lambda x: -abs(x[2] - x[3]))[:15])

inf = f[(f.source == "inferred") & f.symbol.isin(STOCKS)]
rows = []
for r in inf.itertuples():
    y = data.bars(r.symbol, "2005-01-01")["close"].pct_change()
    rows.append((r.symbol, r.ex_date.date(), round(r.factor, 3), round(float(y.get(r.ex_date, np.nan)), 3)))
print(f"\ninferred splits inside the universe: {len(rows)} (Yahoo's return that day; ~0 = real split)")
print(rows)
crash = [x for x in rows if np.isfinite(x[3]) and abs(x[3]) > 0.15]
print("inferred events where Yahoo shows a real move (false positives):", crash)

for sym, d in (("YESBANK", "2020-03-06"), ("YESBANK", "2018-09-21"), ("IDEA", "2019-08-14"), ("DHFL", "2019-06-04"),
               ("RCOM", "2017-11-30"), ("JPASSOCIAT", "2012-01-02"), ("SATYAMCOMP", "2009-01-07")):
    hit = f[(f.symbol == sym) & (f.ex_date >= pd.Timestamp(d) - pd.Timedelta(days=3)) & (f.ex_date <= pd.Timestamp(d) + pd.Timedelta(days=3))]
    print(f"crash check {sym} {d}: {'ADJUSTED AWAY ' + hit.to_dict('records').__str__() if len(hit) else 'kept as a real move'}")

con_val = eq.groupby("canon")["value"].median()
inf_all = f[f.source == "inferred"].copy()
inf_all["med_value_cr"] = inf_all.symbol.map(con_val) / 1e7
print("\ninferred splits by median traded value (Rs cr/day):",
      pd.cut(inf_all.med_value_cr, [0, 0.1, 1, 5, 50, 1e6]).value_counts().sort_index().to_dict())

fl = adjust.flagged_dates()
fl["med_value_cr"] = fl.symbol.map(con_val) / 1e7
liq = fl[fl.med_value_cr >= 5]
print(f"\ndata flags: {len(fl)} ({fl.reason.str.split(' ').str[0].value_counts().to_dict()}); "
      f"in liquid names (median >= Rs 5 cr/day): {len(liq)}")
print(liq.sort_values("med_value_cr", ascending=False).head(20).to_string(index=False))
print("\nby source:", f.source.value_counts().to_dict())
print(f[f.source == "yahoo"].head(20).to_string(index=False))
