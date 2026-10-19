# Strategy 002: results (19 Oct 2026)

**Verdict:**
- **Daily trading timeframe: REVISE.** There's a real but small per-trade edge that survives out-of-sample and beats random entries. The trap filter and the wholesale entry both add value. But as a portfolio it falls well short of buy & hold.
- **1h trading timeframe: DROP (falsified).** It loses money out-of-sample and does worse than random entries.

Rules are in `spec.md`, fixed before any test, plus amendment 1 (a 0.5 × ATR minimum stop), made before the grid. The parameters were chosen mechanically in-sample (`select`, `out/chosen_*.json`, committed before the out-of-sample run), and the out-of-sample test was **run once** per stack. Raw numbers are in `out/eval_*.json`, `out/grid_*.csv` and `out/sensitivity_*.csv`.

## Step 0: diagnostic on 001's fills (`diag_001_fills.py`)
Where 001's buy-stop entries filled in the daily channel, z = (fill − mid)/u, known at the signal bar:

| | at/below mid ("wholesale") | above mid ("retail") | difference |
|---|---|---|---|
| 2005–18 | +0.097R (n = 1,967) | +0.042R (n = 3,731) | wholesale +0.055R |
| 2019–26 | +0.109R (n = 1,860) | +0.194R (n = 2,846) | **retail better** by 0.085R |

001's random-entry trades show the same flip, so this is regime-driven: buying strength paid in the 2019–26 bull run. It gave no clear support either way. The real test is the grid below.

## In-sample grids (36 cells per stack; `out/grid_D.csv`, `out/grid_H.csv`)
**Daily (2005–2018, 487 stocks that had futures, including delisted names):**
- **The trap pullback beats the plain pullback in every entry/exit pair.** Trap cells: −0.06 to +0.06R on cash. Plain cells: −0.15 to −0.05R.
- **Limit and hybrid (wholesale) entries beat the buy-stop.** For trap + trail + no scratch: limit +0.064R, hybrid +0.053R, buy-stop +0.024R (cash).
- **The follow-through scratch hurts in every combination.** The time scratch hurts slightly.
- **The trail beats the two-part exit** (+0.064R vs +0.034R for trap + limit), consistent with 001.

**1h (Nov 2023 – Oct 2025, 135 stocks):**
- **All 36 cells lose on cash costs** (−0.12 to −0.45R).
- **Under futures costs only 4 cells are positive** (+0.05R, `t_month` ~0.45), all plain pullback + limit/hybrid + trail.
- **The trap filter is *worse* than the plain pullback on 1h.**

**Chosen by the pre-registered rule:**
- **Daily:** trap / limit / trail / none (26 qualifying cells; also the best cell).
- **1h:** plain / limit / trail / none (4 qualifying cells).

## Out-of-sample, run once
### Daily, 2019 – Oct 2026 (trap pullback, limit entry, trailing exit)
| | Cash (0.32% round trip) | Futures (0.13%) |
|---|---|---|
| Trades | 2,256 | 2,256 |
| Avg per trade | **+0.038R / +0.22%** | **+0.102R / +0.39%** |
| Win rate / profit factor (on %) | 25.5% / 1.11 | 26.3% / 1.21 |
| t per trade / `t_month` | 0.79 / 2.33 | 2.10 / 2.87 |
| Random, matched (same momentum filter, entry, exits; 50 seeds) | −0.037R [−0.093, +0.032]; **p = 0.04** | +0.023R; **p = 0.04** |
| Random, any stock | −0.036R; p = 0.00 | +0.026R; p = 0.00 |
| **Portfolio CAGR / max drawdown** (0.5% risk, ≤ 3% open risk, ≤ 10 positions) | **+2.6% / −37%** | **+7.1% / −29%** |
| Equal-weight buy & hold (same stocks) | +18.4% / −42% | |
| NIFTY 50 | +10.0% / −38% | |

- **In-sample, for comparison:** +0.064R cash / +0.119R futures (`t_month` 2.39 / 2.76), p = 0.00 against random. Portfolio −2.5% / +0.7% CAGR, against 19.2% for equal-weight buy & hold.
- **By year, out-of-sample (cash avgR):** 2019 −0.13, 2020 +0.99, 2021 +0.23, 2022 −0.13, 2023 +0.42, 2024 0.00, 2025 −0.08, 2026 −0.37. Like 001, the profit sits in strong-rally years, and **the last two years are negative.**
- **Caution on the statistics:** under cash costs the per-trade t is only 0.79, while `t_month` is 2.33. The months are consistently positive, but a few large losses in busy months make the per-trade average noisy. Under futures costs both clear 2.

### 1h, Nov 2025 – Oct 2026 (plain pullback, limit entry, trailing exit)
| | Cash | Futures |
|---|---|---|
| Trades | 1,838 | 1,838 |
| Avg per trade | **−0.656R** | **−0.344R** |
| `t_month` | −5.30 | −2.83 |
| Random, matched | −0.537R; p = 1.00 (**worse than random**) | −0.262R; p = 0.96 |
| Portfolio CAGR | −48% | −27% |
| Benchmarks | NIFTY −12.4%, equal-weight −5.2% (a falling market) | |

## Sensitivity (`out/sensitivity_*.csv`, one change at a time, both periods)
- **Daily:**
  - **Out-of-sample under futures costs, every variant is positive** (+0.052 to +0.110R; `t_month` 2.4–2.9).
  - **Under cash costs, 18 of 19 are positive.** Halving `max_bars` flips it to −0.009R. A 1.0 × ATR minimum stop drops it to +0.007R.
  - **In-sample under cash costs,** the 1.0 × ATR minimum stop turns negative (−0.024R).
  - **The sign is robust under futures costs and marginal under cash costs.**
  - `t1_gate` and `nochase` are inactive for this cell (no T1 with a trailing exit; no-chase only applies to buy-stops), so those rows equal the chosen cell.
- **1h:** every variant is negative out-of-sample under both cost models.

## Against the pass criteria (spec)
| Criterion | Daily | 1h |
|---|---|---|
| Out-of-sample avgR > 0 (judged cost model: cash for daily, futures for 1h) | ✅ +0.038R (futures +0.102R) | ❌ −0.344R |
| Beats matched random out-of-sample, p < 0.05 | ✅ p = 0.04 (borderline, both cost models) | ❌ worse than random |
| Out-of-sample `t_month` > 2 | ✅ 2.33 (futures 2.87) | ❌ |
| Portfolio return per unit of drawdown beats equal-weight buy & hold | ❌ cash 0.07, futures 0.24, vs 0.44 | ❌ |
| No sign flips under one-step sensitivity | ✅ futures / ⚠ cash (1 marginal flip) | ❌ |
| Trap adds value over plain pullback (falsification 4) | ✅ in-sample, in all 18 entry/exit/scratch pairs (out-of-sample not run for plain, by protocol) | ❌ on 1h the trap is worse |

## Interpretation
1. **What YTC got right, on daily NSE bars:**
   - **Trap pullbacks** (undercut the prior swing low, then reclaim it) beat plain pullbacks.
   - **Wholesale limit entries** beat confirmation buy-stops.
   - **Trailing the runner** beats a fixed first target.
   
   All three show up clearly in-sample, and the chosen combination holds out-of-sample against random entries. That's the first YTC-based rule set in this project to pass the random-entry test out-of-sample.
2. **Why it still isn't a strategy to trade:**
   - **The edge is small:** +0.04R per trade on cash, +0.10R on futures.
   - **Capital sits idle.** At 0.5% risk per trade, with open risk capped at 3% (about 6 positions) and a 20% weight cap, the book is mostly in cash. The average risk actually used was 0.42%. So it can't match a fully invested equal-weight portfolio in a market that compounded 18% a year.
   - **The futures version does better** (+7.1% CAGR, −29% drawdown) but still trails NIFTY (10%) on return, though with a smaller drawdown.
3. **Recent weakness.** 2025 and 2026 are negative, as in 001. That could be regime or decay. There isn't enough data to tell yet.
4. **1h doesn't work for this approach on NSE.**
   - Costs relative to 1h swings, and a choppy, falling out-of-sample year, sink it.
   - The trap filter fails on 1h, probably because 2-bar pivots on 1h bars are mostly noise.
   - That agrees with `02_timeframe_check`: costs are about 0.3R per 1h trade in cash.

## What to do next (revise, don't deploy)
1. **Fix the capital-use problem rather than hunting for more per-trade edge.** Use 002's daily trap + limit entry as the *timing* layer inside a fully invested momentum book, the "later candidate" in `ROADMAP.md`. Its entries were better than random in both periods; the question is whether better timing improves a momentum book against equal-weight buy & hold. That's a new spec (strategy 003). 002's rules would be reused unchanged, not re-tuned on this out-of-sample period.
2. **Futures as the vehicle,** if it's ever traded: costs roughly double the per-trade edge. Lot sizes and margin need checking (Phase 3).
3. **Tier 2 filters, one at a time, on the daily stack:** room to weekly S/R, the earnings blackout, the smoothness watchlist. These are new in-sample tests on 2005–18 only. The 2019–26 period has now been used, so any later "improvement" judged on it would be overfitting.
4. **Drop 1h as a trading timeframe** for this approach. A 1h *entry layer* under daily setups is still untested, but that's a separate question.
5. **Survivorship and data:**
   - The daily stack includes delisted stocks (bhavcopy), so its comparison is fair.
   - The 1h stack is survivors only.
   - All prices are price returns; dividends would add about 1–1.5% a year to buy & hold and slightly less to the strategy.
