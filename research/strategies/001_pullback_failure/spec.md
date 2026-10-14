# Strategy 001: YTC pullback failure in strong stocks (daily, long only)

## Hypothesis
YTC's highest-probability setups in a steady trend are PB and CPB: the counter-trend pullback shows weakness and fails, and the counter-trend traders get trapped (Vol 3, PDF p234–240, p250).

The market analysis (`../../01_market_analysis/out/summary.txt`) found three relevant effects on NSE daily data:
1. Short and shallow pullbacks continue to new highs much more often (89% under 25% depth, 61% at 50–62%, 32% beyond 100%; ≤3 bars 64% vs 6–8 bars 35%).
2. 5-day losers bounce (decaying after 2019).
3. 12-1 month momentum persists (+0.4%/month top vs bottom quintile, stable across periods).

**H1:** buying the *failure* of a short, not-too-deep daily pullback, in a stock that is strong (medium-term momentum and/or YTC up-structure), has positive expectancy after costs. The stop is placed where the pullback idea is proven wrong (below the pullback low), and the targets are the prior swing high or a swing-low trail.

**Falsified if:**
- out-of-sample (2019+) average R ≤ 0 after costs; or
- it doesn't beat the random-entry baseline that uses the same exits and risk distances; or
- results only hold in a narrow parameter pocket (sensitivity flips sign under ±1 step changes).

## Timeframes (YTC mapping, PDF p471 uses the same for stocks)
- **Higher timeframe:** weekly, used only as a context variant here.
- **Trading timeframe:** daily. All setups and exits.
- **Lower timeframe:** not used yet (daily-bar triggers). Possible later: 1h triggers.

## Universe and data
132 NSE large and mid caps (today's NIFTY 50 plus former members and other liquid names), 2005–2026, adjusted daily bars. A stock is tradeable on a day when its 20-day average traded value is at least ₹5 crore.

## Definitions (all known at the close of bar t, no lookahead)
- **Swing high/low:** YTC 2-bar pivot, *confirmed 2 bars after the extreme*.
- **SH:** latest confirmed swing high. **L0:** the swing low before SH (start of the up leg). **PL:** the lowest low since SH (the pullback low so far).
- **Pullback depth:** (SH − PL) / (SH − L0). **Pullback duration:** bars since SH.
- **struct_up:** SH > previous SH and L0 > previous L0 (higher high and higher low).
- **mom_pct:** the stock's 126-day return percentile across the universe that day.

## Rules
**Setup on bar t (all must hold):**
1. Context, by parameter `context`:
   - `none`
   - `structure`: struct_up
   - `mom`: mom_pct ≥ `mom_min`
   - `both`
2. Duration: bars since SH ≤ `max_pb_bars`.
3. Depth: `depth_min` ≤ depth ≤ `depth_max`. Unless `allow_break`, PL must stay above L0 (PB). With `allow_break`, pullbacks that broke L0 are allowed: YTC's "PB that broke the prior swing low", with trapped shorts.
4. Still inside the pullback: high[t] < SH.
5. Liquidity filter passes. Optional: NIFTY 50 above its 200-day SMA (`index_filter`).

**Entry on bar t+1:**
- **`entry=stop`** (YTC pullback failure): buy-stop at high[t] + 0.05%. The fill is max(open, trigger) + slippage. If it doesn't trigger, re-evaluate at t+1's close.
- **`entry=open`** (earlier, "wholesale"): buy at the open of t+1.
- **Skip the trade if:**
  - it opens at or above SH (no room left);
  - it opens through the stop;
  - the stop is more than `max_risk` (8%) away;
  - the room to SH is less than `min_room` × risk (YTC's "acceptable R:R").

**Stop:** PL × (1 − 0.2%). It is fixed for `swing` exits and only ratchets up for `trail` exits.

**Exits, by parameter `exit`:**
- `swing`: all at T1 = SH (the prior swing high: YTC's first opposing order flow).
- `trail`: trail the stop to just below each newly confirmed daily swing low (YTC trailing part 2).
- `half`: half at T1, half trailed (YTC two-part position).
- Always: a time exit after `max_bars` (30) bars at the close.

**Fill and path conventions on daily bars:**
- Gaps through a stop fill at the open.
- When the stop and the target (or the entry trigger) both fall inside one bar, the order follows the standard OHLC path rule: open nearer the high means O→H→L→C, otherwise O→L→H→C.

**Costs:** 0.1% per side (brokerage, STT, charges) plus 0.05% slippage per side.

**Portfolio:** risk 1% of equity per trade (YTC's maximum, PDF p481), at most 10 positions, at most 20% of equity in one position, cash only (no leverage). Same-day signals are taken tightest stop first.

## Testing protocol
- **In-sample 2005–2018:** grid over context × duration × depth/break × exit × entry (`backtest.py grid`). Pick by robustness: a broad positive region, t-stat, trade count. Don't just take the single best cell.
- **Out-of-sample 2019–2026:** run **once** with the chosen parameters (`backtest.py final`).
- **Baselines:**
  - random entries with the same count per year, same trigger mechanics, same stop distances and the same exits (isolates the entry's value);
  - NIFTY 50 buy & hold;
  - equal-weight universe buy & hold.
- **Sensitivity:** one-at-a-time ± steps on every parameter, in both periods (`backtest.py sens`).

## Known gaps vs discretionary YTC
- No bar-by-bar reading of momentum or "weakness". Depth and duration stand in for it.
- No active scratching of trades that stall.
- No higher-timeframe S/R map: room is measured only to the prior swing high, not to weekly resistance.
- Long only: Indian cash equities can't be held short overnight.
- Survivorship bias in the universe overstates long results. The random-entry baseline shares that bias, so the *difference* is the fairer measure.
