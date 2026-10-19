"""Print a compact summary of out/eval_<stack>.json."""

import json
import sys
from pathlib import Path

for stack in sys.argv[1:] or ["D", "H"]:
    ev = json.loads((Path(__file__).resolve().parent / "out" / f"eval_{stack}.json").read_text())
    print(f"\n######## stack {stack}: {ev['params']['setup']}/{ev['params']['entry']}/{ev['params']['exit']}/{ev['params']['scratch']}")
    for per in ("in_sample", "out_of_sample"):
        r = ev[per]
        print(f"== {per}  skips {r['skips']}")
        print("   benchmarks", {k: round(float(v), 1) for k, v in r["benchmarks"].items()})
        for m in ("cash", "fut"):
            t = r[m]["trades"]
            pf = r[m]["portfolio"]
            rm, ra = r[m]["random_matched"], r[m]["random_any"]
            print(f"   {m:4s} n={t['n']} avgR={t['avgR']:+.3f} win={t['win%']:.1f}% avg%={t['avg%']:+.3f} PF={t['PF']:.2f} "
                  f"t={t['t']:.2f} t_month={t['t_month']:.2f}")
            print(f"        random_matched {rm['avgR_mean']:+.3f} [{rm['p05']:+.3f},{rm['p95']:+.3f}] p={rm['p_value']:.2f} | "
                  f"random_any {ra['avgR_mean']:+.3f} p={ra['p_value']:.2f}")
            print(f"        portfolio: CAGR {pf.get('cagr%', float('nan')):+.1f}% maxDD {pf.get('maxdd%', float('nan')):.1f}% "
                  f"taken {pf.get('trades_taken')} risk used {pf.get('avg_risk_used%', float('nan')):.2f}%")
        print("   by year (cash):", {y: (v["size"], round(v["mean"], 2)) for y, v in r["by_year"]["cash"].items()})
        print("   exits:", dict(list(r["exit_reasons"].items())[:5]))
