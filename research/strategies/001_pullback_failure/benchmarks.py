"""Benchmarks per period (backtest.benchmarks): NIFTY 50 and the equal-weight
universe, rebalanced daily and buy & hold. Writes out/benchmarks.json."""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import backtest  # noqa: E402

feats = backtest.build_features()
res = {name: backtest.benchmarks(feats, a, b)
       for name, (a, b) in {"in_sample": ("2005-01-01", backtest.IS_END), "out_of_sample": (backtest.OOS_START, "2026-12-31")}.items()}
(HERE / "out" / "benchmarks.json").write_text(json.dumps(res, indent=2))
print(json.dumps(res, indent=1, default=lambda x: round(float(x), 2)))
