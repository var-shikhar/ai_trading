# Strategy 003: results (19 Oct 2026). Verdict: DROP

**In one line:** neither part of H3 survives. The untimed monthly momentum book doesn't beat equal-weight buy & hold. 002's trap + limit timing looked strong in-sample (it beat random timing, p = 0.00, and halved the drawdown) but showed no value in 2019–2026 (p = 0.62 against random timing).

Rules are in `spec.md`, fixed before testing, plus amendment 1 (the measurement window: in-sample from 31 Jan 2006, the seen period from 31 Dec 2018). Selection was mechanical, in-sample only (`out/chosen.json`). The seen period was run once. Raw outputs: `out/eval.json`, `out/grid_B0.csv`, `out/grid_B1.csv`, `out/sensitivity.csv`. Universe: stocks with futures and ≥ ₹10 crore traded per day, delisted names included, adjusted NSE bhavcopy.

## In-sample grid (31 Jan 2006 – 2018, cash costs)
**B0, the untimed book** (equal-weight buy & hold: 15.5% CAGR, −73% max drawdown):

| N | lookback | CAGR | max drawdown | CAGR/DD |
|---|---|---|---|---|
| 10 | 12-1 | 10.9% | −76% | 0.14 |
| 10 | 6-1 | **14.4%** | −68% | 0.21 |
| 15 | 12-1 | 9.8% | −77% | 0.13 |
| 15 | 6-1 | 11.2% | −65% | 0.17 |
| 20 | 12-1 | 10.2% | −75% | 0.14 |
| 20 | 6-1 | 12.7% | −66% | 0.19 |

**No cell beats buy & hold's CAGR, so H3(1) is rejected in-sample.** Per the rule, N = 15 / 12-1 was carried forward for the record. Momentum books crashed in 2008 (−72%) and 2011 (−27%).

**B1, timed by 002** (on the N = 15 / 12-1 book; B2 = random entry day over the same window, 50 seeds):

| window | fallback | CAGR | max drawdown | CAGR/DD | B1 − B2 (per month) | p vs B2 | no signal in window |
|---|---|---|---|---|---|---|---|
| 10 | market | 11.7% | −67% | 0.17 | +0.04% | 0.40 | 68% |
| **10** | **skip** | **12.5%** | **−40%** | **0.31** | **+0.35%** | **0.00** | 81% |
| 15 | market | 12.3% | −66% | 0.19 | +0.09% | 0.20 | 58% |
| 15 | skip | 11.4% | −51% | 0.22 | +0.19% | 0.12 | 75% |
| 20 | market | 11.8% | −67% | 0.18 | +0.08% | 0.12 | 51% |
| 20 | skip | 14.2% | −51% | 0.28 | +0.31% | 0.00 | 63% |

**Chosen: W = 10, skip.** With "skip", most selected names are never bought: 002's signal is rare and no signal came in 81% of cases. So B1 holds fewer stocks and more cash. B2 skips just as often, so the timing advantage over B2 is genuine in-sample. B1's drawdown advantage (2008: −37% vs −72%) comes largely from that cash.

## Seen period (31 Dec 2018 – Oct 2026), run once
| | Cash costs | Futures costs |
|---|---|---|
| **B0** untimed book: CAGR / max drawdown / CAGR/DD | **17.8% / −42% / 0.42** | 18.2% / −42% / 0.43 |
| **B1** timed book | **11.2% / −38.5% / 0.29** | 11.5% / −38.5% / 0.30 |
| B2 random timing (mean of 50) | CAGR/DD 0.34 | 0.35 |
| **B1 vs B2** | **p = 0.62** (monthly), 0.72 (CAGR/DD) | the same |
| B1 − B0 | −0.59%/month (t −1.94) | −0.60%/month |
| Equal-weight buy & hold | 18.4% / −41% / **0.44** | |
| NIFTY 50 | 9.9% / −38% | |

**By year (cash):**

| | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|
| B0 | 12.0% | 9.5% | 42.8% | 2.3% | 47.3% | 31.1% | 1.9% | 1.7% |
| B1 | 15.7% | 3.2% | 7.4% | 0.4% | 20.9% | 17.8% | 17.3% | 6.5% |

B1 held cash through the 2021 and 2023–24 rallies, but did better in the weak 2025–26.

## Sensitivity (`out/sensitivity.csv`)
- **Seen period:** B1's CAGR/DD is below B0's in every variant (0.06–0.46 against 0.27–0.56).
- **B1 − B2 in the seen period** ranges from −0.17% to +0.10% a month across the window and fallback variants. That's no consistent timing value.
- **In-sample, the B1 timing value is positive in every variant tested** (+0.04% to +0.35%/month). The in-sample result is robust; it just doesn't carry over.
- **Wider buffers (3N) and N − 5 help B0 in both periods.** That's an observation only. It wasn't pre-registered, and the seen period mustn't be used to pick it.

## Against the pass criteria
| Criterion | Result |
|---|---|
| Book CAGR/DD > equal-weight buy & hold, in-sample **and** seen | ❌ B0 0.13 vs 0.21 in-sample, 0.42 vs 0.44 seen. B1 0.31 vs 0.21 in-sample ✅, but 0.29 vs 0.44 seen ❌ |
| B1 beats B2 (p < 0.05) in-sample **and** seen | ❌ p = 0.00 in-sample, **0.62 seen** |
| B1 doesn't lower CAGR/DD vs B0 | ✅ in-sample (0.31 vs 0.13), ❌ seen (0.29 vs 0.42) |
| No sign flips under sensitivity | ❌ the timing value flips sign in the seen period |

## Interpretation
1. **Momentum alone isn't an edge on this universe, once delisted stocks are included.**
   - The market analysis found top-quintile momentum beat the bottom quintile by about 0.4% a month. A concentrated top-15 book doesn't convert that into beating an equal-weight hold of the same stocks: it lagged by 5.7 points a year in 2006–18 and roughly matched in 2019–26.
   - Equal-weight buy & hold is itself a strong benchmark here. It's mildly flattered because stocks that delisted keep their last price instead of going to zero.
2. **002's timing filter acted mostly as a market-exposure switch.**
   - With "skip" it bought only the ~20% of names that set up a trap pullback within 10 days, so it held more cash.
   - That helped in the 2006–18 bear phases and hurt in the 2019–24 rallies.
   - Its edge over random timing in-sample didn't repeat. Together with 002's own weakness in 2025–26, that suggests the entry edge is regime-dependent or decaying.
3. **Across 001, 002 and 003, the per-trade timing effects are real but small, and none of them turns into beating buy & hold after costs** on a survivorship-free NSE universe.

## What this means for the project
- **Nothing from 001–003 should be deployed or paper-traded as a return-seeking strategy.**
- **What *is* reliable and reusable:**
  - the data pipeline (survivorship-free adjusted bhavcopy, adjusted 1h, F&O futures);
  - the testing harness (causal features, truncation tests, random baselines, pre-registered selection, portfolio simulation);
  - the finding that trap pullbacks and wholesale limit entries beat plain pullbacks and confirmation entries on daily bars.
- **Possible directions** (for the user to choose; each would be a new spec):
  - **(a) Risk reduction instead of return.** B1-style cash switching cut drawdowns in-sample. Test it explicitly as a drawdown-control overlay on an index or equal-weight holding, judged on drawdown and return per unit of drawdown, with a fresh pre-registration.
  - **(b) Edges from outside price action:** post-earnings drift, results-day gaps, or sector/index relative strength with an index-futures hedge. These need new data, such as an earnings calendar.
  - **(c) Intraday on Fyers 15m data**, if the user wants to pursue YTC's native timeframe (the opening-range and gap ideas from the blogs).
  - **(d) Stop searching for alpha here.** Use the app for screening and discretionary support, and use buy-and-hold (index or equal-weight) as the core.
