"""Smoke test: run a few cells on a stack's in-sample period and check invariants."""

import sys

import numpy as np

import backtest as bt

stack = sys.argv[1] if len(sys.argv) > 1 else "H"
c = bt.STACK[stack]
for cell in (dict(setup="trap", entry="stop", exit="trail", scratch="none"),
             dict(setup="trap", entry="limit", exit="twopart", scratch="time"),
             dict(setup="plain", entry="hybrid", exit="twopart", scratch="follow")):
    p = bt.params_for(stack, **cell)
    tr = bt.run(stack, p, c["start"], c["is_end"])
    print("\n", cell, "trades", len(tr), "skips", tr.attrs["skips"])
    if tr.empty:
        continue
    s = bt.stats(tr, "cash")
    print({k: round(v, 3) for k, v in s.items()}, "| fut avgR", round(tr.r_fut.mean(), 3))
    print("exit reasons:", tr.reason.value_counts().head(6).to_dict())
    print("R quantiles cash:", tr.r_cash.quantile([0.01, 0.1, 0.5, 0.9, 0.99]).round(2).to_dict())
    assert (tr.p1 > tr.stop).all(), "entry below stop"
    worst = tr.r_cash.min()
    print("worst R", round(worst, 2), "| share < -1.5R:", round((tr.r_cash < -1.5).mean() * 100, 2), "%",
          "| p2 filled %", round(tr.p2_filled.mean() * 100, 1), "| planned risk used", round(tr.planned_risk_used.mean(), 3))
    print(tr[["symbol", "signal_ts", "entry_ts", "exit_ts", "entry_kind", "p1", "stop", "mode", "reason", "r_cash"]].head(4).to_string(index=False))
