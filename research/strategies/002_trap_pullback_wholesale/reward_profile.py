"""Reward profile of 002's daily trades: stop distance, winners vs losers in R
and %, payoff ratio, how often trades reach 2R/3R/5R, holding time."""

from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parent / "out"
for per in ("in_sample", "out_of_sample"):
    t = pd.read_csv(OUT / f"trades_D_{per}.csv")
    print(f"\n== daily, {per}: {len(t)} trades")
    print(f"stop distance (risk) per trade: median {t.risk_frac.median() * 100:.1f}% of price "
          f"(25-75%: {t.risk_frac.quantile(.25) * 100:.1f}-{t.risk_frac.quantile(.75) * 100:.1f}%)")
    print(f"holding period: median {t.bars.median():.0f} trading days, mean {t.bars.mean():.1f}, 90th pct {t.bars.quantile(.9):.0f}")
    for m in ("cash", "fut"):
        r, pct = t[f"r_{m}"], t[f"pnl_pct_{m}"]
        w, lo = r[r > 0], r[r <= 0]
        print(f"[{m}] win {len(w) / len(r) * 100:.1f}% | avg winner {w.mean():+.2f}R ({pct[r > 0].mean():+.2f}%) | "
              f"avg loser {lo.mean():+.2f}R ({pct[r <= 0].mean():+.2f}%) | payoff (avg win/avg loss) {w.mean() / -lo.mean():.2f} | "
              f"expectancy {r.mean():+.3f}R ({pct.mean():+.2f}%)")
        print(f"      share of trades reaching >=1R {(r >= 1).mean() * 100:.1f}%, >=2R {(r >= 2).mean() * 100:.1f}%, "
              f">=3R {(r >= 3).mean() * 100:.1f}%, >=5R {(r >= 5).mean() * 100:.1f}% | best {r.max():+.1f}R | worst {r.min():+.1f}R | "
              f"median {r.median():+.2f}R")
    win_bars = t.loc[t.r_cash > 0, "bars"].median()
    loss_bars = t.loc[t.r_cash <= 0, "bars"].median()
    print(f"median holding: winners {win_bars:.0f} days, losers {loss_bars:.0f} days")
