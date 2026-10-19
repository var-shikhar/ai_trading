# Strategy 002: trap pullback with wholesale entry, 1h trading timeframe (long first)

Status: **spec, written before any test** (19 Oct 2026). Rules come from `notes/ytc_synthesis.md` (Tier 1). Decisions are in `CONTEXT.md` (decisions 5–6) and data in `DATA.md`. Nothing here has been backtested yet.

## Hypothesis
YTC's highest-quality with-trend setup is a pullback that **traps** counter-trend traders:
- it undercuts the prior swing low, then reclaims it (PAT p250, p496; blogs p34, p63–64, p231);
- entered at a **wholesale** price rather than after confirmation (Scalper p86–99, p140; PAT p273–282);
- managed in **two parts**, with the runner trailed (PAT p265, p311–318).

Our own evidence:
- 001: a confirmation buy-stop after a pullback in momentum stocks beat random entries by only 0.07–0.10R, too thin for costs. Trailing exits did all the work, and the YTC T1 exit lost.
- `02_timeframe_check`: on 1h, costs are about 0.3R per trade in cash and about 0.13R in futures.

**H2:** in momentum stocks, a trap pullback entered at a wholesale price, with YTC two-part management, earns enough above random entries with the same exits to clear costs on the 1h trading timeframe. At minimum it does so under the futures cost model.

**Falsified if** any of these holds:
1. Out-of-sample avgR ≤ 0 under the cost model being judged.
2. It doesn't beat the context-matched random baseline (same exits, same stop-distance distribution) out-of-sample, at p < 0.05 over 50 seeds.
3. One-step parameter changes flip the sign of out-of-sample avgR.
4. The trap filter adds nothing over the plain pullback in *both* periods. That falsifies the trap idea specifically, even if the strategy is profitable.

## Timeframes (decision 5: the timeframe is a parameter, tested on two stacks)
| Stack | Higher timeframe (context) | Trading timeframe (setup, stop, exits) | Entry layer | Data and periods |
|---|---|---|---|---|
| **H (primary)** | Daily | **1h** | 1h bars (no finer data with history) | `hourly.load_1h()`, 135 stocks, Nov 2023 → Oct 2026. In-sample = first 24 months (to 31 Oct 2025); out-of-sample = the last ~12 months |
| **D (comparison)** | Weekly | **Daily** | Daily bars; a 1h variant only for 2023-11 onward | `adjust.adjusted_panel()`, all liquid NSE stocks, 2005 → 2026. In-sample 2005–2018; out-of-sample 2019–2026 |

The same code runs both. Only the bar series and the bars-per-day constants differ.

## Universe and data (both stacks)
- **Prices:** split, bonus and demerger adjusted (`adjust.py`, `hourly.py`). Price returns; dividends excluded.
- **Tradeable on day d:** F&O-eligible on d, meaning the stock has futures in `fo_fut` on d. The 20-day median traded value must be ≥ ₹25 crore (stack H) or ≥ ₹10 crore (stack D), computed up to d−1. Stack H is limited to the 135 stocks with Yahoo 1h data, intersected with that rule.
- **Data flags:** a trade is skipped, and counted as skipped, if its holding period spans a date in `adjust.flagged_dates()`.
- **Survivorship:** stack D uses the full bhavcopy universe, including delisted names. Stack H's 135 names are today's survivors. That flatters stack H's absolute numbers but not its comparison with random entries, which share the same names.

## Definitions (known at the close of bar t; no lookahead)
- **Swings:** YTC 2-bar pivots on the trading timeframe, from `structure.raw_swings`. The alternating sequence is rebuilt as known on each bar, and a swing is confirmed 2 bars after its extreme. This needs a truncation test, as in 001.
- **SH:** the latest swing high in the sequence. **L0:** the swing low before SH.
- **PL:** the lowest low since SH. **Pullback bars:** bars since SH.
- **ATR:** 14-bar ATR on the trading timeframe.
- **Momentum context:** 126-day return percentile across the tradeable universe, using daily closes up to the previous day: `mom_pct ≥ 0.7` (as in 001). Stack H uses the daily value of the previous session.
- **Channel** (Scalper p86–99, adapted from p113): mid = SMA(close, 20); unit u = SMA(high − low, 20); inner lines at mid ± 2u. On stack H, the channel runs on 1h bars.

## Rules (long side)

### Setup on bar t (all must hold)
1. **Context:** `mom_pct ≥ mom_min` (0.7).
2. **In a pullback:** high[t] < SH, and pullback bars ≤ `max_pb_bars`.
3. **Pullback type** (`setup`):
   - **`trap`** (Tier 1 rule 1): PL < L0 (the pullback undercut the prior swing low), and close[t] > L0 (reclaimed). It is armed on the first bar that closes back above L0. If price closes below PL − 1 ATR, the setup is void.
   - **`plain`** (the comparison): PL ≥ L0, with depth (SH − PL)/(SH − L0) between 0.2 and 1.0.
4. **Liquidity and eligibility:** as in Universe. No open position in the stock.

### Entry (`entry`, Tier 1 rule 2), working from bar t+1 for at most `entry_window` bars
- **`stop`** (control, 001's entry): a buy-stop at high[t] + 0.05%.
- **`limit`** (wholesale): a limit buy at the channel mid; part 2 at mid − 2u.
  - Each part is half of the position.
  - **Only part 1 is required.** If only part 1 fills, the position is half-size. Sizing uses the full position's risk, so a part-2 fill never exceeds the planned risk.
- **`hybrid`** (Scalper p140): the limit as above. If price never trades down to the mid and instead closes above high[t], the order converts to the `stop` entry.
- **No-chase** (Tier 1 rule 3, always on):
  - A buy-stop isn't filled if the bar opens above the trigger by more than 0.5 ATR. It's skipped and logged.
  - A limit only fills at or below its price. Gaps down through a limit fill at the open, which is the better price.
- **Gap-day rule (stack H only):** no entries during the first 1h bar of a session that opened more than 0.5 daily ATR away from the prior close. Orders resting overnight are kept but can't fill on that bar.

### Stop
PL − 0.1 ATR. The trade is skipped if the stop is more than `max_risk` (8%) below the entry.

### Exits (`exit`, Tier 1 rule 4)
- **`trail`** (001's best): one part, with the stop raised to 0.1 ATR below each newly confirmed swing low.
- **`twopart`** (the YTC design, never tested by us):
  - Part 1 exits at T1 = SH, but only if T1 − entry ≥ 1R. Otherwise the whole position trails.
  - When T1 fills, part 2's stop moves to breakeven plus costs, then trails as in `trail`.
- **Always:** a time exit at the close after `max_bars` bars (30 for stack D; 35 for stack H, about 5 sessions).

### Scratch (`scratch`, Tier 1 rule 5)
- `none`.
- **`time`:** exit at the close of bar k if the trade's best excursion is below +0.5R (k = 3 for stack D; 7 for stack H, about one session).
- **`follow`:** exit at the close if, by the bar after entry, price closes back below the entry trigger (stop entries) or below part 1's fill (limit entries).

### Fills and path (as in 001)
- Orders are placed at bar close for the next bar.
- Gaps through stops fill at the open.
- Within a bar, the OHLC path rule applies: if the open is nearer the high, O→H→L→C; otherwise O→L→H→C.
- The overnight gap is just the open of the first bar of the next session.

### Costs (both reported for every result; `02_timeframe_check/report.md`)
- **Cash:** 0.1% fees + 0.05% slippage per side, about 0.32% round trip.
- **Futures:** about 0.13% round trip (STT 0.02% sell side, plus fees, plus 0.05% slippage per side). Lot sizes are ignored in this research stage (fractional positions); lot feasibility is checked in Phase 3. **To be verified with the broker before production.**

### Portfolio
- 0.5% of equity risked per trade (0.25% per part).
- Total open risk ≤ 3%; positions at breakeven or better count as zero (PAT p486).
- At most 10 positions, at most 20% of equity per position, cash only.
- Same-bar signals are taken tightest stop first.
- **Report:** the portfolio results, and the risk actually used.

## Testing protocol (pre-registered)
0. **Diagnostic, before any 002 code** (cheap; daily; existing 001 trades): bucket 001's trades by where they filled in the daily channel, z = (fill − mid)/u. If fills above mid ("retail") have clearly worse R, that supports `limit`/`hybrid`. Either way it's recorded in `results.md`.
1. **Lookahead tests:** truncation tests for the features and the swing sequence, on both stacks.
2. **In-sample grid**, per stack, both cost models:
   - setup {trap, plain} × entry {stop, limit, hybrid} × exit {trail, twopart} × scratch {none, time, follow} = **36 cells**;
   - `max_pb_bars` fixed at 8 for stack D and 12 for stack H; `entry_window` 3 / 7; `mom_min` 0.7.
3. **Selection rule** (fixed now, applied mechanically by a `select_params.py`):
   1. Judge with the **futures** cost model for stack H and the **cash** model for stack D (the realistic vehicle for each).
   2. Keep the cells with `t_month` > 0 and n ≥ 300 trades in-sample.
   3. For each (entry, exit) pair, take the mean `t_month` across the setup × scratch cells; pick the pair with the highest mean. That favours a broad region over a single cell.
   4. Within the pair, pick setup and scratch by the highest `t_month`. Ties go to the simpler option (plain over trap, none over time over follow).
   5. If nothing qualifies in step 2, the stack has no in-sample region. Record it, and still run that stack's out-of-sample test with entry=stop, exit=trail, setup=trap, scratch=none, for the record.
4. **Out-of-sample: run once** per stack, with the chosen cell, under both cost models.
5. **Baselines** (50 seeds each):
   - `random_matched`: random tradeable stock-bars with `mom_pct ≥ 0.7`, the same entry-trigger mechanics, the stop-distance distribution taken from the strategy, and the same exits and scratch.
   - `random_any`: the same without the momentum filter.
   - Benchmarks: NIFTY 50 and equal-weight buy & hold over the same window.
6. **Sensitivity** (one step at a time, both periods): `mom_min` ±0.1; `max_pb_bars` ±1 step; `entry_window` ±; the stop buffer 0.05/0.2 ATR; `max_bars` half/double; the T1 gate 0.75R/1.5R; the no-chase threshold 0.25/1.0 ATR; the channel period 14/30; the gap-day rule on/off (stack H).
7. **Statistics:** n, avgR, win%, profit factor, t, `t_month` (clustered by entry month), all in R after costs. Portfolio CAGR, max drawdown and Sharpe, with the risk actually used. Results by year, exit reasons, the share of skipped trades and why, and limit fill rates with missed-winner rates.

## Pass criteria (`ROADMAP.md` Phase 2)
All of these must hold for a stack to pass:
- out-of-sample avgR > 0 under its judged cost model;
- it beats `random_matched` out-of-sample at p < 0.05;
- out-of-sample `t_month` > 2 (stack D); for stack H, with only about 12 out-of-sample months, `t_month` > 2 is aspirational and **p vs random < 0.05 is the binding test**;
- portfolio return per unit of drawdown beats equal-weight buy & hold;
- no sign flips under one-step sensitivity.

## Known limits
- **Stack H's history is short:** 3 years and one market regime (2023–26). Its out-of-sample year can confirm or reject, but not prove robustness. The 20-year stack D carries the robustness question.
- **No lower timeframe below 1h with history.** On stack H the entry layer is the trading timeframe itself. 15m from Fyers would be the next step (`ROADMAP.md` Phase 1).
- **The trap and channel rules approximate YTC's discretionary reading** (`notes/ytc_synthesis.md` §8).
- **Long only for now.** The F&O short mirror image is a separate test afterwards, with its own spec section, because drift and survivorship make long results unusable for shorts.
- **Tier 2 filters are not in this spec.** Room to weekly S/R, the earnings blackout, the smoothness watchlist and the others will be tested one at a time only after the Tier 1 core has a verdict.
