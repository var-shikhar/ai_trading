"""Compact summary of out/eval.json and out/sensitivity.csv."""

import json
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent / "out"
ev = json.loads((OUT / "eval.json").read_text())
print("B0:", ev["B0"], "\nB1:", ev["B1"])
for per in ("in_sample", "seen"):
    r = ev[per]
    print(f"\n== {per}: benchmarks", {k: round(v, 1) for k, v in r["benchmarks"].items()})
    for cost in ("cash", "fut"):
        c = r[cost]
        for k in ("B0", "B1"):
            m = c[k]
            print(f"  {cost:4s} {k}: CAGR {m['cagr%']:+.1f}% maxDD {m['maxdd%']:.1f}% CAGR/DD {m['cagr_dd']:.2f} "
                  f"Sharpe {m['sharpe']:.2f} mean/month {m['mean_month%']:.2f}% positions {m['positions']}")
        t = c["timing"]
        print(f"  {cost:4s} B2 mean/month {c['B2_mean_month%_mean']:.2f}% (B2 CAGR/DD {c['B2_cagr_dd_mean']:.2f}); "
              f"p(B1 vs B2) month {c['p_b1_vs_b2_month']:.2f}, CAGR/DD {c['p_b1_vs_b2_cagr_dd']:.2f}; "
              f"entry improvement median {t.get('entry_improvement%_median', float('nan')):.2f}%; "
              f"no signal {t.get('no_signal%', float('nan')):.0f}%; B1-B0 {t.get('b1_minus_b0_month%', float('nan')):+.2f}%/month "
              f"(t {t.get('t_month_b1_vs_b0', float('nan')):.2f})")
        print(f"  {cost:4s} by year B0 {c['by_year_B0%']}\n  {cost:4s} by year B1 {c['by_year_B1%']}")
s = pd.read_csv(OUT / "sensitivity.csv")
pd.set_option("display.width", 250)
cols = [c for c in s.columns if c.endswith(("B1_cagr", "B1_dd", "B1_cagr_dd", "B0_cagr_dd", "b1_minus_b2_month%"))]
print("\nsensitivity:\n", s[["variant"] + cols].round(3).to_string(index=False))
