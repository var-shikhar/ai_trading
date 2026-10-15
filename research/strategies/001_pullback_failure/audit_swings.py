"""Audit: does find_swings' de-duplication leak future information?

find_swings() keeps the list alternating H/L: when two swings of the same
kind come in a row, only the more extreme one survives. In real time the
first one was confirmed (and would have been used) before the second one
existed. Dropping it means the backtest "knows" it will be superseded.

This counts how often that happens and how often a dropped swing LOW was
traded through before the replacement low was confirmed (i.e. a real-time
trailing stop at that low would have been hit).
"""

import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "common"))
import data  # noqa: E402
import structure  # noqa: E402


def raw_swings(h, l, n=2):
    size = len(h)
    raw = []
    for i in range(n, size - n):
        if h[i] > h[i - n:i].max():
            j = i
            while j + 1 < size and h[j + 1] == h[i]:
                j += 1
            if j + n < size and h[i] > h[j + 1:j + 1 + n].max():
                raw.append(("H", j, h[i], j + n))
        if l[i] < l[i - n:i].min():
            j = i
            while j + 1 < size and l[j + 1] == l[i]:
                j += 1
            if j + n < size and l[i] < l[j + 1:j + 1 + n].min():
                raw.append(("L", j, l[i], j + n))
    return sorted(set(raw), key=lambda s: (s[1], s[0]))


tot = {"H": 0, "L": 0}
dropped = {"H": 0, "L": 0}
broken_low = 0
for s, df in data.panel(start="2005-01-01").items():
    h, l = df["high"].to_numpy(), df["low"].to_numpy()
    raw = raw_swings(h, l)
    kept = {(x.kind, x.i) for x in structure.find_swings(h, l, 2)}
    for k, i, px, known in raw:
        tot[k] += 1
        if (k, i) not in kept:
            dropped[k] += 1
            if k == "L":
                # was this low broken after it was confirmed? (a trail there would have stopped out)
                after = l[known + 1:]
                if len(after) and (after < px).any():
                    broken_low += 1
print("raw swings:", tot)
print("dropped by de-dup:", dropped, {k: round(dropped[k] / tot[k] * 100, 1) for k in tot})
print("dropped swing lows later broken (real-time trail would have exited):", broken_low)
