# Strategy 001: results (IN PROGRESS, paused 14 Oct 2026)

Status: the in-sample grid is done. **The out-of-sample run and the sensitivity analysis have not been run yet.** Nothing below has been validated out of sample.

## In-sample grid, 2005–2018 (`out/grid_in_sample.csv`, log in `out/grid_log.txt`)
- **Coverage:** 288 cells: context × pullback duration × depth/break × exit × entry. Costs and slippage included; daily OHLC path rule for intrabar order.
- **Mostly negative:** only **41 of 288 cells are positive**. Median avgR by exit: trail −0.03, half −0.11, swing (all at prior swing high) −0.20. By entry: stop −0.06, open −0.16.
- **Best region:** stop entry (break of the pullback bar's high), a swing-low **trailing** exit, and pullbacks of **up to 8 bars**.

| context | ≤ bars | depth | broke L0 allowed | n | avgR | win% | PF | t |
|---|---|---|---|---|---|---|---|---|
| mom | 8 | 0.2–3.0 | yes | 6,113 | +0.102 | 28.5 | 1.12 | 3.40 |
| mom | 8 | 0.2–1.0 | no | 4,530 | +0.097 | 27.6 | 1.08 | 2.60 |
| both | 8 | 0.2–3.0 | yes | 3,324 | +0.080 | 27.2 | 1.09 | 1.96 |
| mom | 5 | 0.2–3.0 | yes | 5,294 | +0.075 | 27.4 | 1.08 | 2.27 |
| none | 8 | 0.2–3.0 | yes | 19,548 | +0.074 | 27.4 | 1.11 | 4.55 |

Early reading:
- **Expectancy is small:** at most about +0.1R per trade. It comes from a low win rate (≈27%) with large trailed winners, i.e. trend capture, not from the setup's precision.
- **YTC's fixed T1 at the prior swing high loses money** on daily NSE bars. The room to the prior high is typically under 1R (median ≈ 0.8R).
- **Momentum context adds little** over no context (+0.10 vs +0.07R), and YTC up-structure adds nothing.
- The open-ended edge (+0.07R even with no context) may mostly be the long-only drift plus a trailing exit. **The random-entry baseline is the key test**, and it hasn't run yet.

## Next steps (when resuming)
1. Fix `chosen_params.json` from the broad region (mom, ≤8 bars, depth 0.2–3.0 with break allowed, trail, stop entry), then run `backtest.py final`: out-of-sample 2019–26, random-entry baseline, portfolio CAGR/drawdown vs NIFTY 50 and equal-weight buy & hold.
2. Run `backtest.py sens`, including `max_bars` 60, `min_room` 1–2 and the index filter.
3. If it doesn't beat the random baseline out of sample, mark H1 falsified for daily bars. Candidates for 002: a 1h lower-timeframe trigger, room to weekly S/R instead of the prior swing high, and a plain momentum + short-term-reversal hybrid suggested by the market analysis.
