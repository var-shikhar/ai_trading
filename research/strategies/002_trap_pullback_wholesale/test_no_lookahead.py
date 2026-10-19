"""Lookahead test for 002's bar features (both stacks): features at bar t
computed from bars ending at t must equal those from the full history.
Daily context (momentum, eligibility, liquidity) is built from values shifted
to the previous session in features.daily_context and is not re-tested here.

    test_no_lookahead.py H     (or D, once its features are built)
"""

import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import features  # noqa: E402

COLS = ["sh", "sh_i", "l0", "pl", "trail_sl", "bars_since", "atr", "mid", "u"]
stack = sys.argv[1] if len(sys.argv) > 1 else "H"
fe = features.build(stack)
rng = np.random.default_rng(3)
syms = rng.choice(sorted(fe), size=min(6, len(fe)), replace=False)
bad = checked = 0
for s in syms:
    bars = fe[s][["open", "high", "low", "close"]]
    full = features.bar_features(bars)
    for t in rng.integers(200, len(bars) - 1, 20):
        part = features.bar_features(bars.iloc[:t + 1]).iloc[-1][COLS].to_numpy(dtype=float)
        row = full.iloc[t][COLS].to_numpy(dtype=float)
        checked += 1
        if not np.allclose(part, row, equal_nan=True, rtol=1e-12, atol=1e-9):
            bad += 1
            print("MISMATCH", s, bars.index[t], dict(zip(COLS, zip(part, row))))
print(f"stack {stack}: checked {checked} bars, mismatches {bad}")
sys.exit(1 if bad else 0)
