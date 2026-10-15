# Market analysis: base rates for NSE swing trading

Source: `analyze.py`, with raw output in `out/summary.txt` and the CSVs in `out/`. Updated 15 Oct 2026, after the swing lookahead fix (see "Corrections" at the end).

**Data:** 132 NSE large and mid caps, 643,166 stock-days, Yahoo adjusted daily bars, 2005-01-03 to 2026-10-14. On the 58 overlapping symbols, daily returns correlate 0.98–0.997 with the app's Fyers cache. All forward returns are close to close, before costs. The round-trip cost we assume is about 0.3% (0.1% fees plus 0.05% slippage, per side).

**Survivorship bias:** the universe is mostly today's names plus some fallen ones (YESBANK, IDEA, ZEEL, VEDL…). Companies that were fully delisted are missing. Every *long* number below is therefore flattered. Read the differences between conditions as more trustworthy than the levels.

## 1. Drift: the bar to beat (section A)
| | value |
|---|---|
| Median stock buy & hold CAGR | **17.0%** (10th–90th percentile 8.1–27.9%; 3 of 132 negative) |
| NIFTY 50 CAGR since 2005 | 11.8% (price index, no dividends) |
| Average stock-day forward return, 5 / 10 / 20 days | 0.46% / 0.91% / **1.84%** |
| Forward 20-day win rate | 56.4% |

**Implication:** a long-only rule that is simply in the market earns about +1.8% per 20 days with no skill. Any strategy has to be judged by its *excess* over random entries with the same exposure, not by being profitable. Profitable is the default here, and it's inflated by survivorship.

## 2. Regime filters (B) and YTC structure (C): little edge
- **200-day average:** being above your own 200-day SMA doesn't help. With NIFTY up, stocks above vs below it earn 2.00% vs 1.46% per 20 days. With NIFTY down, it's 1.24% vs 2.15%, the opposite way. The index regime (NIFTY above or below its 200-day) flips sign between periods: in 2005–18 "index up" was better (2.12% vs 1.51%); in 2019–26 it was worse (1.42% vs 2.37%). **Not a reliable filter.** In strategy 001 it raised in-sample avgR (mostly by skipping 2008) but not out-of-sample.
- **YTC daily structure** (2-bar swings, HH+HL = up): up 2.01%, range 1.81%, down 1.67% per 20 days. The spread is about 0.35%, about one round-trip cost. In 2019–26 it all but vanishes (1.67 / 1.61 / 1.73).
- **The structure state barely persists:** after 20 bars, an "up" stock is still "up" 33% of the time, against 31% for any stock. On daily bars the label is closer to noise than to a regime.
- **Weekly + daily alignment:** weekly up + daily up gives 2.07%, weekly down + daily down 1.71%. Small, and survivorship-flattered on the long side.

**Implication:** don't build a strategy on trend-state filters. Use them, if at all, as a minor tilt, and test whether they add anything.

## 3. Volatility (D)
- Higher-ATR stocks earn more per 20 days: 2.36% for the top quintile vs 1.49% for the bottom. But risk-adjusted that is roughly flat (forward vol 36.5% vs 23.5%).
- Volatility clusters: past and next 20-day vol correlate 0.50.

**Implication:** risk-based sizing (fixed % risk per stop distance) is sensible. High-vol names aren't an edge in themselves.

## 4. Pullbacks (E): the shape is real, the tradeable edge is not
These describe *completed* swing legs (an ex-post view):
- Up legs: median +8.0% over 4 bars. Pullbacks: median depth 91% of the prior up leg, median 3 bars.
- Chance that the next up leg makes a new high, by pullback depth:

| depth | under 25% | 25–38% | 38–50% | 50–62% | 62–79% | 79–100% | over 100% (broke the low) |
|---|---|---|---|---|---|---|---|
| continues | 89% | 77% | 70% | 64% | 60% | 55% | 37% |

- By duration: 64% after pullbacks of ≤ 3 bars, 49% after 4–5, 35% after 6–8, 21% after 9–13.
- **Partly mechanical:** a shallow pullback leaves price near the high, so a "new high" needs only a small move. Depth and duration are also only fully known once the pullback has ended.
- **The tradeable test:** buy at the close of the bar where the pullback's low is confirmed, using only swings known at that bar. Excess return over 20 days: **−0.02%** (n = 71,107); 2005–18 +0.09%, 2019–26 −0.21%. By bars since the high: ≤ 3 bars +0.03%, 4–5 bars 0.00%, 6–8 bars −0.37%. *The previous version reported +0.19%. That figure came from ex-post swings and was biased upward (see Corrections).*

**Implication:** YTC's depth and duration describe strong vs weak trends well after the fact. On their own, as a daily-close entry, they carry no excess return. Any pullback strategy has to earn its keep from the entry trigger and the exit, and has to beat random entries with the same exits (strategy 001 tests exactly this).

## 5. Breakouts and breakout failures (F)
| close beyond prior N-day high | n | excess forward 20 days |
|---|---|---|
| 20 days | 27,358 | +0.11% |
| 55 days | 17,638 | +0.10% |
| 250 days | 10,306 | 0.00% |

- Downside breaks are mildly negative (−0.45% for 20-day lows).
- **46% of 20-day up-breakouts fail within 3 bars** (the close is back below the level). If the breakout holds, the forward 20-day return is +4.2%; if it fails, −0.6%. But that is known only after the fact.
- **Trading the failure:** entering at the failure bar returns +0.90% over the next 10 days, which is about drift (0.91%). There's no BOF edge.
- The weekly trend makes no difference to breakout failure rates (46–47% across states).

**Implication:** plain Donchian breakouts and BOF fades have no stand-alone edge on daily NSE large caps. This matches the hand-off's conclusion: the Part Time Larry-style breakout scanners in the app are tools, not edges.

## 6. Short-term reversal and momentum (G): the two effects that survive
**5-day reversal.** Excess return over the next 5 days, by deciles of the past 5-day return:

| | biggest losers (D1) | D2 | D9 | biggest winners (D10) |
|---|---|---|---|---|
| all | +0.22% | +0.17% | −0.19% | −0.28% |
| 2005–18 | +0.30% | | | −0.40% |
| 2019–26 | +0.09% | | | −0.09% |
| above 200-day SMA only | +0.31% | | | −0.19% |

The long side (D1, +0.22% per 5 days) is below the ~0.3% round trip. The effect is **real but decaying**: from 0.7% D1–D10 per 5 days before 2019 to 0.18% after.

**12-1 month momentum.** Next-month return by momentum quintile: Q1 1.68% → Q5 2.10% (+0.4% a month top vs bottom). It holds in both halves: 2005–18 1.79 → 2.22, 2019–26 1.53 → 1.92. It isn't monotonic within the middle quintiles, but Q5 > Q1 in both periods.

**Implication:** momentum is the most robust effect found, but it's small per month, so it suits monthly rotation (low turnover) better than short swing trades, where costs eat it. Short-term reversal works only as a timing tilt *within* strong stocks, and it is fading.

## 7. Gaps (H)
- 21% of days have a gap of at least 1%.
- **Gap-ups fade during the day:** 1–2% gaps go −0.49% from open to close, 2–4% gaps −1.16%, over 4% −3.00%. Gap-downs recover: +0.50%, +1.20%, +4.07%. 49–68% of gaps fill the same day.
- Over the next 5 days gap-ups still slightly outperform (+0.20% to +0.45%). The fade is intraday only.

**Implication:** don't chase gap opens with market orders. Buy-stop entries that fill at a gap-up open get the worst intraday price, which is relevant for 001's entry. Fading opening gaps is a possible separate intraday idea, but it needs intraday data and intraday costs.

## 8. Calendar and index (I, J)
- NIFTY 50 mean daily return by weekday: Monday −0.01%, Tuesday +0.04%, Wednesday +0.17%, Thursday +0.02%, Friday +0.04%. Weekend rows are a handful of special sessions (6 since 2005). It's noise-sized; no edge.
- Daily-return autocorrelation: NIFTY 0.037, median stock 0.021. Essentially a random walk at lag 1.
- NIFTY breakouts underperform the index's own drift (20-day: +0.89% vs +1.10% base).
- NIFTY by its own weekly trend: forward 20 days, up 0.47%, range 1.73%, down 0.81%. "Up" is the *worst* state for the index.

## What this means for strategy design
1. **Benchmark against random entries with the same exits and exposure.** Drift plus survivorship makes almost any long rule look profitable.
2. **Momentum is the one robust effect.** It's small, so keep turnover low.
3. **Pullback geometry alone has no tradeable edge** on daily closes. A pullback strategy needs a trigger and an exit that add value, or a lower-timeframe entry (YTC's actual method).
4. **Regime and structure filters are weak and unstable.** Don't expect them to rescue a strategy.
5. **Costs (~0.3% round trip) are the same size as most effects.** Anything with a short holding period must clear that first.

## Corrections (15 Oct 2026)
`structure.find_swings` cleans the swing list ex-post: it keeps one of two consecutive same-kind swings, which drops about 19% of swings using later bars. The structure state (section C) and the "tradeable" pullback number (E) were read bar by bar from that list. Both now use the swing sequence as known on each bar (`structure.raw_swings`; test in `common/test_structure.py`).
- Section C barely changed.
- The pullback-low excess fell from +0.19% to −0.02%.
- The depth and duration continuation tables are unchanged. They are descriptive by design.

Yahoo's NIFTY 50 (^NSEI) history starts 2007-09-17, so "since 2005" index figures (CAGR, the index regime in B, section J) previously covered only 2007-09 onward, and the index regime was missing for 2005–07. `common/data.py` now fills the earlier part from the app's Fyers cache, which is identical on the overlap (`common/check_index.py`). The NIFTY CAGR since 2005 moved from 9.1% to 11.8%. The B regime tables changed, but the conclusion (the regime flips between periods) didn't.
