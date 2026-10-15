"""Lookahead test: features at bar t computed from data ending at t must
equal the same features computed from the full history."""

import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "common"))
import backtest  # noqa: E402
import data  # noqa: E402

COLS = ["sh", "l0", "pl", "prev_sh", "prev_l0", "trail_sl", "depth", "struct_up", "legs"]
rng = np.random.default_rng(1)
bad = checked = 0
for sym in ["RELIANCE", "SBIN", "TATASTEEL", "INFY", "YESBANK", "DLF"]:
    df = data.bars(sym, "2005-01-01")
    full = backtest.symbol_features(df)
    for t in rng.integers(300, len(df) - 1, 25):
        part = backtest.symbol_features(df.iloc[:t + 1]).iloc[-1][COLS]
        row = full.iloc[t][COLS]
        same = all((a == b) or (a != a and b != b) for a, b in zip(part.to_numpy(), row.to_numpy()))
        checked += 1
        if not same:
            bad += 1
            print("MISMATCH", sym, df.index[t].date(), dict(zip(COLS, zip(part, row))))
print(f"checked {checked} bars, mismatches {bad}")
sys.exit(1 if bad else 0)
