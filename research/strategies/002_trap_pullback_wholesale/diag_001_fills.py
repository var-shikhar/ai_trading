"""Spec step 0: did 001's confirmation (buy-stop) entries fill at "retail"
prices, and do those trades do worse? (Scalper p86-99: confirmation costs price.)

Channel on daily bars, known at the close of the signal bar (before the fill):
mid = SMA(close, 20), u = SMA(high - low, 20), z = (fill - mid) / u.
Same Yahoo adjusted series that 001 traded on. Results by z bucket, both
periods, with 001's random-entry trades (same mechanics) as a reference.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "common"))
import data  # noqa: E402

T001 = HERE.parent / "001_pullback_failure" / "out"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)


def channel(sym: str) -> pd.DataFrame:
    b = data.bars(sym, "2004-06-01")
    return pd.DataFrame({"mid": b["close"].rolling(20).mean(), "u": (b["high"] - b["low"]).rolling(20).mean()})


def add_z(tr: pd.DataFrame) -> pd.DataFrame:
    tr = tr.copy()
    tr["signal_date"] = pd.to_datetime(tr["signal_date"])
    z = np.full(len(tr), np.nan)
    for sym, idx in tr.groupby("symbol").groups.items():
        ch = channel(sym)
        sub = tr.loc[idx]
        m = ch.reindex(sub["signal_date"])
        z[tr.index.get_indexer(idx)] = ((sub["entry_px"].to_numpy() - m["mid"].to_numpy()) / m["u"].to_numpy())
    tr["z"] = z
    return tr


def summary(tr: pd.DataFrame) -> pd.DataFrame:
    b = pd.cut(tr["z"], [-np.inf, -2, -1, 0, 1, 2, np.inf])
    g = tr.groupby(b, observed=True)
    return pd.DataFrame({"n": g.size(), "avgR": g["r"].mean(), "win%": g["pnl_pct"].apply(lambda x: (x > 0).mean() * 100),
                         "avg%": g["pnl_pct"].mean()}).round(3)


lines = []
for per in ("in_sample", "out_of_sample"):
    for kind in ("", "_random_matched_seed0"):
        f = T001 / f"trades_chosen_{per}{kind}.csv"
        tr = add_z(pd.read_csv(f))
        label = f"{per} {'001 strategy' if not kind else 'random matched (seed 0)'}"
        lo, hi = tr[tr.z <= 0], tr[tr.z > 0]
        lines.append(f"## {label}: n={len(tr)}, share filled above mid (retail) {len(hi) / len(tr) * 100:.0f}%")
        lines.append(f"   avgR at/below mid {lo.r.mean():+.3f} (n={len(lo)}) | above mid {hi.r.mean():+.3f} (n={len(hi)}) | "
                     f"difference {lo.r.mean() - hi.r.mean():+.3f}R")
        lines.append(summary(tr).to_string())
txt = "\n".join(lines)
print(txt)
(OUT / "diag_001_fills.txt").write_text(txt, encoding="utf-8")
