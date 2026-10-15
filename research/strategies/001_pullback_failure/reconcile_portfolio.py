"""Reconcile portfolio.simulate's equity curve with the trades it took (sum of P&L, risk actually used, R by stop width)."""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "common"))
import backtest  # noqa: E402
import portfolio  # noqa: E402

feats = backtest.build_features()
closes = {s: f["close"] for s, f in feats.items()}
tr = pd.read_csv(HERE / "out" / "trades_chosen_in_sample.csv", parse_dates=["signal_date", "entry_date", "exit_date"])
pf = portfolio.simulate(tr, closes, risk_pct=1.0, max_pos=10, max_weight=0.2)
eq, tk = pf["equity"], pf["taken"]
print("equity start/end", eq.iloc[0], eq.iloc[-1])
print("taken avgR", tk.r.mean(), "all avgR", tr.r.mean())
print("taken risk_frac median", tk.risk_frac.median(), "all", tr.risk_frac.median())
# R by risk bucket (cost in R terms grows as the stop tightens)
tr["rb"] = pd.qcut(tr.risk_frac, 5)
print(tr.groupby("rb", observed=True).r.agg(["size", "mean"]).round(3))
# biggest one-day equity drops
d = eq.pct_change()
print("worst days:\n", d.nsmallest(10).round(4))
# trades with extreme pnl
print("pnl_pct extremes:\n", tr.nsmallest(5, "pnl_pct")[["symbol", "entry_date", "exit_date", "entry_px", "stop_px", "exit_px", "pnl_pct", "r"]])
# check marking: close vs entry price on the entry day for taken trades
bad = []
for _, row in tk.iterrows():
    c = closes[row.symbol]
    if row.entry_date in c.index:
        ratio = c.loc[row.entry_date] / row.entry_px
        if ratio < 0.7 or ratio > 1.4:
            bad.append((row.symbol, row.entry_date.date(), row.entry_px, c.loc[row.entry_date]))
print("entry-day close vs entry price mismatches:", len(bad), bad[:10])
tk = tk.copy()
tk["pnl"] = tk.qty * (tk.exit_px_net - tk.entry_px_net)
tk["pnl_eq"] = tk.pnl / tk.equity_at_entry * 100
tk["risk_eq"] = tk.qty * (tk.entry_px - tk.stop_px) / tk.equity_at_entry * 100
print("sum pnl", tk.pnl.sum(), "equity change", eq.iloc[-1] - 1_000_000)
print("pnl % of equity: mean", tk.pnl_eq.mean(), "risk % of equity: mean", tk.risk_eq.mean())
print("R implied by pnl/risk:", (tk.pnl_eq / tk.risk_eq).mean())
print("weight % median", (tk.qty * tk.entry_px / tk.equity_at_entry * 100).median())
print(tk.groupby(tk.entry_date.dt.year).pnl_eq.sum().round(1).to_dict())
