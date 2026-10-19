"""Why were these corporate actions missed? Show gap, nearest nice ratio,
share-volume and traded-value ratios around each date."""

import numpy as np
import pandas as pd

import adjust

NICE = adjust.NICE + [1 / x for x in adjust.NICE]
eq = adjust.load_eq()
for sym, d in (("ITC", "2005-09-21"), ("HINDALCO", "2005-08-30"), ("UPL", "2005-09-27"), ("JINDALSTEL", "2009-09-14"),
               ("TORNTPHARM", "2006-02-20"), ("HAVELLS", "2005-08-04"), ("M&M", "2005-09-01"), ("DIVISLAB", "2009-07-30"),
               ("JINDALSTEL", "2008-01-21")):
    s = eq[eq.symbol == sym].set_index("date").sort_index()
    if pd.Timestamp(d) not in s.index:
        print(sym, d, "no bhav row on that date; nearby:", list(s.loc[pd.Timestamp(d) - pd.Timedelta(days=5):pd.Timestamp(d) + pd.Timedelta(days=5)].index.date))
        continue
    pos = s.index.get_loc(pd.Timestamp(d))
    prev = s.iloc[pos - 1]
    row = s.iloc[pos]
    gap, day = row.open / prev.close, row.close / prev.close
    nice = min(NICE, key=lambda x: abs(np.log(gap / x)))
    vb, va = s.volume.iloc[pos - 20:pos].median(), s.volume.iloc[pos:pos + 20].median()
    tb, ta = s.value.iloc[pos - 20:pos].median(), s.value.iloc[pos:pos + 20].median()
    print(f"{sym} {d}: prev close {prev.close}, open {row.open}, close {row.close}; gap {gap:.3f} day {day:.3f}; "
          f"nearest nice {nice:.3f} (miss {abs(np.log(gap / nice)):.3f}); shares x{va / vb:.2f} (expect {1 / nice:.2f}); value x{ta / tb:.2f}")
