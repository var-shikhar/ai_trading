# Strategy 003: fully invested momentum book, with 002's trap + limit entry as the timing layer (daily, long)

Status: **spec, written before any test** (19 Oct 2026). It builds on:
- `01_market_analysis/report.md` §6: 12-1 momentum is the one robust effect found;
- `strategies/002_trap_pullback_wholesale/results.md`: the daily trap pullback with a limit entry beat random entries out-of-sample, but the book sat mostly in cash and lost to buy & hold.

## Why
- **002's problem was idle capital, not entry quality.** About 6 positions at 0.5% risk left the book mostly in cash, so it couldn't keep up with a market compounding about 18% a year.
- **003 fixes that:** always hold a momentum portfolio, and use 002's rules **unchanged** only to decide *when* a newly selected stock is bought.

**H3:**
1. A monthly top-N momentum book beats equal-weight buy & hold of the same universe after costs, on return per unit of drawdown.
2. Buying new names on 002's trap + limit signal, instead of at the next open, improves the book by more than random timing over the same waiting window does.

**Falsified if:**
1. The timed book isn't better than the same book with random entry days over the same waiting window, in-sample and in the seen period (see "Data periods"). This falsifies the timing layer.
2. The untimed momentum book doesn't beat equal-weight buy & hold on return/drawdown in-sample. This falsifies the book itself.
3. Results flip sign under one-step parameter changes.

## Data periods (honest about what has been seen)
- **In-sample: 2005–2018.** All selection happens here.
- **Seen period: 2019–Oct 2026.** It has already been examined by 001, 002 and the market analysis (momentum held in both halves there). 003's rules are fixed before running it, and it's run once and reported, but **it isn't a clean out-of-sample test**. It can reject H3, but it can't prove it.
- **True out-of-sample = forward paper trading** (`ROADMAP.md` Phase 4), from the date this spec is approved.

## Universe and data
- **Same universe as 002 stack D:** stocks that had futures that day, with 20-day median traded value ≥ ₹10 crore known by the previous session.
- **Prices:** adjusted bhavcopy, including delisted names (`adjust.py`), so there's no survivorship bias. Trades spanning a flagged date (`data_flags`) are excluded; the position is closed at the last clean close before the flag.
- **Index:** NIFTY 50 (Fyers before Sep 2007, then Yahoo).

## Rules
### Monthly selection (last trading day of each month, using that day's close)
- **Momentum score:** the return from 12 months ago to 1 month ago (`lookback` = 12-1). Variant: 6-1.
- **Target list:** the top `N` tradeable stocks by score (N = 15; variants 10 and 20).
- **Hold buffer:** a held stock stays while it ranks within the top `2N`. It's sold when it drops below rank 2N at a month end, or stops being tradeable.

### Entry for each new name in the target list (the experiment)
- **`B0` (untimed baseline):** buy at the next session's open.
- **`B1` (timed by 002):** from the next session, wait up to `W` trading days (W = 15; variants 10 and 20) for **002's daily entry, exactly as specified and chosen there**:
  - **Setup:** a trap pullback. The pullback undercut the prior swing low (L0) and a close reclaimed it, with pullback bars ≤ 8 and high < SH, on 2-bar causal swings.
  - **Entry:** limit orders at the channel mid (SMA20), with part 2 at mid − 2u, worked for 3 bars after each setup bar.
  - 002's momentum filter (`mom_pct ≥ 0.7`) is replaced by membership of the target list.
  - **If nothing fills by day W** (`fallback`):
    - `market` (default): buy at the open of day W+1, so the book stays invested;
    - variant `skip`: don't buy this month; the stock stays a candidate next month if it's still in the list.
- **`B2` (random timing, the control for B1):** for each new name, buy at the open of a random day within the same window. The waiting-time distribution is drawn from B1's actual waits, including fallbacks, over 50 seeds. That isolates the value of *where* B1 entered from the value of simply waiting.

### Exits (all books)
- **By rank only:** the stock is sold at the next open after the month end on which it leaves the top 2N (or stops being tradeable).
- **No price stops** in the core test. 002's structural stop and trail could be added later as a Tier 2 variant.

### Sizing and costs
- **Equal weight across held names.** New buys are sized at 1/N of current equity, and cash is used as available.
- **Monthly rebalance trades only for entries and exits.** There's no re-weighting of held names (that keeps turnover and costs down).
- **Cash between a stock's selection and its B1 fill earns 0%** (stated; liquid funds would earn about 6–7% a year).
- **Costs:**
  - **Cash delivery** (the natural vehicle for a monthly book): 0.1% fees + 0.05% slippage per side.
  - **Futures**, reported as a sensitivity: 0.065% per side. Rolls and lot sizes are ignored at this stage.
- **Long only.**

## Metrics
- Book: CAGR, max drawdown, CAGR/maxDD, Sharpe (daily marked to market), annual turnover, average number held, average cash share.
- **Timing value** per new position, B1 vs B0 and vs B2:
  - entry price relative to the B0 price (the next open after selection), in %;
  - return from that B0 price to the exit, so we can see whether B1 merely enters later or enters better;
  - the share of names B1 never filled before fallback.
- **Benchmarks:** equal-weight buy & hold of the universe (as in 002), NIFTY 50, and B0.
- **By year;** a month-clustered t-stat on monthly return differences, B1 − B0 and B1 − B2.

## Testing protocol (pre-registered)
1. **Lookahead:**
   - selection uses only month-end closes;
   - 002's features are already truncation-tested;
   - new code (ranking, buffer, timing window) gets a truncation test on the selection list.
2. **In-sample grid, 2005–2018:**
   - **B0:** N {10, 15, 20} × lookback {12-1, 6-1} = 6 cells.
   - **B1:** the chosen B0 × W {10, 15, 20} × fallback {market, skip} = 6 cells.
   - **B2:** for each B1 cell.
3. **Selection** (mechanical, a `select_params.py`):
   - **B0:** the highest in-sample CAGR/maxDD among cells whose CAGR beats equal-weight buy & hold. Ties go to N = 15, then 12-1. If no cell beats buy & hold, H3(1) is rejected in-sample. Record it, and still carry N = 15 / 12-1 forward for the record.
   - **B1:** the cell with the highest in-sample mean monthly return difference over its own B2 (the timing value). Ties go to W = 15, then `market`.
4. **Seen period 2019–2026:** run once with the chosen B0 and B1, plus B2 (50 seeds). Report with the caveat above.
5. **Sensitivity** (one step at a time, both periods): N ±5; lookback 12-1 ↔ 6-1; W ±5; fallback; the hold buffer 1.5N / 3N; cash vs futures costs; rebalancing on the first trading day of the month instead of the last.

## Pass criteria
- **The book (B0 or B1, whichever is carried forward):** CAGR/maxDD above equal-weight buy & hold in-sample **and** in the seen period, after cash costs.
- **The timing layer (B1):** beats B2 on the mean monthly return difference, with p < 0.05 against the 50 random seeds, in-sample **and** in the seen period. It must also not lower the book's CAGR/maxDD compared with B0.
- **No sign flips** under one-step sensitivity.
- **If it passes, the next step isn't deployment.** It's Phase 3, a Fyers re-check with lot sizes, then forward paper trading (Phase 4) as the first truly unseen test.

## Known limits
- **No clean out-of-sample period** remains in the history; see "Data periods".
- **Momentum books have deep crash drawdowns** (2008, 2020). With no price stops in the core, the drawdown comparison with buy & hold is the key number.
- **Turnover:** monthly top-N with a 2N buffer typically turns over 60–100% a year. At a 0.32% round trip, that's about 0.2–0.3% a year in costs. It's reported, not assumed.
- **0% cash yield while waiting** understates B1 slightly, and B1 with `skip` more so.
- **Long only.** A short leg (bottom momentum through futures) isn't in 003. The market analysis showed the bottom quintile still rose on average.

## Amendments
1. **Measurement window, 19 Oct 2026.** This was found after the first in-sample grid and before any seen-period run.
   - **The problem:** the in-sample window started on 1 Jan 2005, but 12-1 momentum needs 252 days of history. So every book was in cash at 0% until the first valid rebalance (31 Jan 2006). That counted in its CAGR. The buy & hold benchmark, computed from Jan 2005, earned that year (2005 was a strong year). The seen period had the same issue on a small scale (January 2019 in cash).
   - **Fix:** measurement starts at the first rebalance with valid scores: **in-sample 31 Jan 2006 – 31 Dec 2018; seen 31 Dec 2018 – Oct 2026.** The selection is on the 31 Dec 2018 close, using only data up to then. Benchmarks are computed over exactly the same windows.
   - No rule, parameter or selection criterion changed. The first grid is kept as `out/*_v0_window_flaw.*`.
