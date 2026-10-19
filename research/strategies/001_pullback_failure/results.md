# Strategy 001: results. Verdict: DROP as a stand-alone strategy (15 Oct 2026)

**In one line:** the pullback-failure entry beats random entries with the same exits by about +0.07 to +0.10R per trade in both periods. But the absolute edge is small, most of the 2019–26 profit is market drift, and as a 10-slot, 1%-risk portfolio it loses money in-sample (−10% CAGR) and earns 1.5% CAGR out-of-sample, against 10–12% for the NIFTY 50 and about 19–24% for equal-weight buy & hold.

## Chosen parameters (pre-registered rule, in-sample only)
`chosen_params.json`, selected by `select_params.py` with the rule below (committed in `ed38d0e` before the v2 grid was run):
- context `mom` (126-day return ≥ 70th percentile);
- pullback ≤ **5** bars, depth 0.2–3.0 of the prior up leg, breaking the prior swing low allowed;
- buy-stop entry above the signal bar's high;
- stop 0.2% below the pullback low; trailing exit under each new confirmed swing low; 30-bar time exit; max risk 8%.

**In-sample grid v2** (causal features): 40 of 288 cells positive, and only 1 with `t_month` > 2. The region for (mom, depth 0.2–3.0 with break, trail, stop entry) is positive at all three durations:

| max pullback bars | n | avgR | win% | t | t_month |
|---|---|---|---|---|---|
| 3 | 4,443 | +0.059 | 27.9 | 1.64 | 1.22 |
| **5 (chosen)** | **5,698** | **+0.061** | **28.0** | **1.99** | **1.87** |
| 8 | 6,526 | +0.067 | 28.8 | 2.41 | 2.20 |

Same region with no momentum context: +0.017 / +0.032 / +0.043R.

## Out-of-sample 2019–2026: run once (`backtest.py final`, `out/eval_chosen.json`)
**Per-trade statistics.** Every signal is counted once with equal weight. Costs are 0.1% plus 0.05% slippage per side.

| | 2005–18 (in-sample) | 2019–26 (out-of-sample) |
|---|---|---|
| Trades | 5,698 | 4,706 |
| avgR | +0.061 | **+0.161** |
| Median R | −1.00 | −0.93 |
| Win rate | 28.0% | 28.8% |
| Profit factor (on %) | 1.04 | 1.26 |
| t (per trade) / t_month | 1.99 / 1.87 | 4.38 / 2.56 |
| Average holding | 10.5 bars | 10.5 bars |
| **Random, context-matched** (50 seeds): mean avgR [5th–95th pct] | −0.044 [−0.086, −0.002] | +0.092 [+0.039, +0.145] |
| Random, any liquid stock (50 seeds) | −0.036 [−0.080, +0.011] | +0.096 [+0.040, +0.135] |
| **Strategy minus matched random** | **+0.105R** (p < 0.02, 0 of 50 seeds) | **+0.069R** (p = 0.02, 1 of 50 seeds) |

The random baselines take the same number of entries per year, use the same buy-stop trigger above a random day's high, draw stop distances from the strategy's own distribution, and use the same trailing and time exits. "Context-matched" restricts them to stock-days in the top 30% by 6-month momentum.

**Out-of-sample avgR by year:**

| 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 YTD |
|---|---|---|---|---|---|---|---|
| −0.08 | +0.59 | +0.37 | −0.02 | +0.68 | +0.06 | −0.07 | −0.22 |

The profit comes from three strong-rally years. The last two years are negative. In-sample was the same pattern: 2008 −0.63, 2011 −0.37, 2018 −0.24.

**Portfolio** (`common/portfolio.py`: 1% risk per trade, at most 10 positions, at most 20% of equity in one position, cash only, tightest stop first):

| | 2005–18 | 2019–26 |
|---|---|---|
| Strategy CAGR / max drawdown | **−10.3% / −88.6%** | **+1.5% / −52.4%** |
| Trades taken / their avgR | 2,656 / +0.009 | 1,775 / +0.067 |
| Random matched, seed 0, CAGR | −12.6% | −10.2% |
| Random any, seed 0, CAGR | −12.8% | −2.7% |
| NIFTY 50 CAGR / max drawdown | 12.4% / −59.9% | 10.0% / −38.4% |
| Equal-weight universe, buy & hold | 24.4% / −59.7% | 19.2% / −36.4% |

Benchmarks come from `out/benchmarks.json`. NIFTY 50 before Sep 2007 comes from the Fyers cache, because Yahoo's history starts 2007-09-17. The equal-weight numbers are heavily survivorship-biased.

`reconcile_portfolio.py` shows why the portfolio is so much worse than the per-trade numbers. The P&L reconciles to the equity curve exactly, so the simulator is not at fault:
1. **The 20% weight cap binds.** The median stop is 3.4% away, so 1% risk would need about 29% of equity. Actual risk per trade averages 0.48% of equity, while costs stay the same.
2. **Which trades the portfolio takes is not random.** Slots free up when trades are stopped out, which clusters in falling markets. So the portfolio takes more of the trades entered into weakness: its trades average +0.009R, against +0.061R for all signals (in-sample).
3. **The win rate is 26–28%, and the median trade is a full −1R loss.** Losing streaks with about 10 open positions compound into deep drawdowns, as in 2008 and 2011.

## Sensitivity (`backtest.py sens`, `out/sensitivity.csv`): one change at a time, both periods
| variant | in-sample n | in-sample avgR | in-sample t_month | out-of-sample n | out-of-sample avgR | out-of-sample t_month |
|---|---|---|---|---|---|---|
| **chosen** | 5,698 | +0.061 | 1.87 | 4,706 | +0.161 | 2.56 |
| mom_min 0.6 / 0.8 | 7,514 / 3,868 | +0.034 / +0.069 | 1.21 / 1.97 | 6,167 / 3,160 | +0.140 / +0.147 | 2.44 / 2.39 |
| max_pb_bars 3 / 8 | 4,443 / 6,526 | +0.059 / +0.067 | 1.22 / 2.20 | 3,691 / 5,429 | +0.157 / +0.153 | 2.10 / 2.68 |
| depth_min 0 / 0.38 | 5,753 / 5,196 | +0.059 / +0.049 | 1.76 / 1.91 | 4,790 / 4,291 | +0.158 / +0.149 | 2.53 / 2.52 |
| depth ≤ 1.0, no break | 4,632 | +0.042 | 0.85 | 3,634 | +0.163 | 1.82 |
| depth_max 1.5 / 5.0 | 5,300 / 5,728 | +0.059 / +0.059 | 1.47 / 1.85 | 4,287 / 4,727 | +0.157 / +0.163 | 2.15 / 2.59 |
| max_bars 15 / 60 | 6,550 / 5,399 | **+0.007** / +0.073 | 0.67 / 1.98 | 5,430 / 4,454 | +0.070 / +0.168 | 1.56 / 2.61 |
| max_risk 5% / 12% | 5,025 / 5,861 | +0.086 / +0.057 | 1.50 / 1.98 | 4,422 / 4,744 | +0.134 / +0.161 | 2.09 / 2.57 |
| index filter (NIFTY above its 200-day SMA) | 4,329 | +0.139 | 1.74 | 3,585 | +0.148 | 1.63 |
| min_room 1 / 2 | 3,157 / 906 | +0.019 / +0.077 | 1.37 / 1.01 | 2,695 / 826 | +0.097 / +0.033 | 1.78 / 0.81 |
| exit swing (all at prior swing high) | 8,900 | **−0.086** | −4.87 | 7,322 | **−0.083** | −3.40 |
| exit half | 5,553 | −0.007 | 0.61 | 4,615 | +0.037 | 1.44 |
| context none / structure / both | 18,035 / 8,159 / 3,034 | +0.032 / +0.006 / +0.020 | 1.05 / −0.93 / −0.43 | 14,619 / 6,381 / 2,418 | +0.104 / +0.104 / +0.133 | 2.04 / 0.54 / 1.56 |
| entry at the next open | 8,900 | −0.017 | 1.35 | 7,194 | +0.055 | 1.79 |

The index filter row was re-run after the NIFTY history fix. The run before the fix wrongly treated 2005–07 as "index down".

**Reading:**
- **Robust in sign:** every variant that keeps the trailing exit and the stop entry stays positive in both periods. No ±1-step change flips it.
- **Not robust in size or significance:** in-sample `t_month` stays under 2 for almost every variant.
- **The edge lives in the exit:** the YTC T1 exit (all at the prior swing high) loses in both periods (t_month −4.9 / −3.4), and a 15-bar time limit removes most of the edge. The setup is a way of being long in trending stocks with a trailing stop.
- **The momentum context adds about +0.03 to +0.06R** over no context in both periods. That is consistent with the market analysis (momentum is the most robust effect found).
- **YTC up-structure adds nothing:** it's worse than no context in-sample.
- **The stop entry beats entering at the next open** by about 0.08–0.11R in both periods. This matches the edge over random entries above: buying when the pullback fails is better than buying at a random point.

## Verdict: DROP 001 as a stand-alone strategy
Against the falsification criteria in `spec.md`:
1. **Out-of-sample avgR > 0 after costs: passed** (+0.161R, t_month 2.56). But in-sample it was only +0.061R (t_month 1.87), and the out-of-sample gain sits in 2020, 2021 and 2023. 2025–26 are negative.
2. **Beats the random-entry baseline with the same exits: passed, narrowly.** It's +0.07 to +0.10R per trade in both periods, at p ≈ 0.02 or better against 50 random seeds.
3. **No narrow parameter pocket: passed in sign, failed in significance.** Results keep their sign across one-step changes but rarely reach t_month > 2 in-sample.

It still fails as something to trade:
- **As a portfolio** with the risk rules in `README.md`, it loses heavily in 2005–18 (−10% CAGR, −89% drawdown) and makes 1.5% CAGR in 2019–26. Simply holding the NIFTY 50 (10–12%) or the equal-weight universe (19–24%) beats it by a wide margin.
- **Changing the sizing won't close that gap.** A +0.06–0.16R average at ~28% win rate, with costs at about 0.1R per trade, is too thin.
- **Survivorship bias flatters all of these long numbers.** The edge over random entries is the fairer measure, and it is small.

**What carries forward to strategy 002:**
- The stop entry above the signal bar, after a short pullback in a momentum stock, adds about +0.07 to +0.10R over random entries with the same exits. That's a usable *entry-timing* component.
- Momentum (6–12 month) is the selection effect that survives in every test.
- Trailing exits beat fixed targets at the prior swing high. YTC's T1 doesn't transfer to daily NSE bars.
- In portfolio terms, an always-in, low-turnover momentum book (where 001's timing would only decide *when* to add a name) is a better host for this edge than a 10-slot swing system that sits in cash between trades.

## Process notes and corrections (15 Oct 2026)
- **Swing lookahead found and fixed before any out-of-sample run.** `structure.find_swings` cleans its list ex-post: it keeps one of two consecutive same-kind swings, which drops 19% of swing highs and lows. 94% of the dropped lows were later traded through. Reading that list bar by bar hid levels that a real-time trailing stop would have used.
  - **Fix:** `structure.raw_swings`, with the alternating sequence rebuilt as known on each bar.
  - **Tests:** `test_no_lookahead.py` (features on truncated data: 150 of 150 bars identical) and `common/test_structure.py` (200 of 200).
  - **Audit:** `audit_swings.py`.
  - **Effect on the in-sample grid:** the v1 best cells fell from +0.10R (t 3.4) to +0.067R. The v1 grid is kept as `out/grid_*_v1_lookahead.*`.
- **Entry bar:** a close below the stop after the fill now counts as stopped out.
- **Added:** `t_month` (t-stat of mean R per entry month). Concurrent trades share market moves, and the per-trade t overstated significance by up to 2.5× here (out-of-sample, no context: t 5.1 vs t_month 2.0).
- **Added:** the context-matched random baseline, over 50 seeds.
- **NIFTY 50 history:** Yahoo starts 2007-09-17. `common/data.py` now splices in the Fyers cache before that date; it's identical on the overlap (`common/check_index.py`). The benchmarks in the original `final` run were computed with the short history and are replaced by `out/benchmarks.json` (the change is noted in `eval_chosen.json`). The strategy and random-baseline numbers don't depend on it.
