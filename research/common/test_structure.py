"""Lookahead test for trend_state: the state at bar t computed from data
ending at t must equal the state computed from the full history."""

import sys

import numpy as np

import data
import structure

COLS = ["sh1", "sh2", "sl1", "sl2", "trend"]
rng = np.random.default_rng(2)
bad = checked = 0
for sym in ["RELIANCE", "SBIN", "TATASTEEL", "YESBANK", "NIFTY50"]:
    df = data.bars(sym, "2005-01-01")
    full = structure.trend_state(df)
    for t in rng.integers(300, len(df) - 1, 40):
        part = structure.trend_state(df.iloc[:t + 1]).iloc[-1][COLS].tolist()
        row = full.iloc[t][COLS].tolist()
        checked += 1
        if not all(a == b or (a != a and b != b) for a, b in zip(part, row)):
            bad += 1
            print("MISMATCH", sym, df.index[t].date(), part, row)
print(f"checked {checked} bars, mismatches {bad}")
sys.exit(1 if bad else 0)
