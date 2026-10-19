"""003 checks: (1) truncation test for the monthly momentum scores; (2) smoke run
of B0 and B1 with invariants (holdings count, cash share, positions)."""

import numpy as np
import pandas as pd

import backtest as bt

P = bt.panel()
fe = bt.bt002.features.build("D")
rng = np.random.default_rng(5)
month_ends = np.flatnonzero(P.month_last)
bad = checked = 0
for d in rng.choice(month_ends[month_ends > 300], 12, replace=False):
    for j in rng.choice(len(P.syms), 15, replace=False):
        s = P.syms[j]
        c = fe[s]["close"]
        c = c[c.index <= P.dates[d]]  # data truncated at the month end
        if len(c) < 260 or c.index[-1] != P.dates[d]:
            continue
        for lb, (a, b) in {"12-1": (21, 252), "6-1": (21, 126)}.items():
            trunc = c.iloc[-1 - a] / c.iloc[-1 - b] - 1
            full = P.score[lb][d, j]
            checked += 1
            if not np.isclose(trunc, full, equal_nan=True):
                bad += 1
                print("MISMATCH", s, P.dates[d].date(), lb, trunc, full)
print(f"score truncation test: {checked} checks, {bad} mismatches")

for entry in ("B0", "B1"):
    b = bt.Book(entry=entry)
    res = bt.simulate(b, "2010-01-01", "2012-12-31")
    m = bt.metrics(res)
    pos = res["positions"]
    print(entry, {k: round(v, 3) for k, v in m.items()})
    if entry == "B1":
        w = res["waits"]
        print("  waits: median", np.median(w[w >= 0]) if (w >= 0).any() else None, "| fallback share",
              round(float(np.mean(w == b.window)) * 100, 1), "% | n entries", len(w))
    print(pos.head(5).to_string(index=False))
