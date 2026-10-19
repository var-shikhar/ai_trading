# Is 1h workable as a trading timeframe on NSE? (17 Oct 2026)

`analyze_tf.py`, with output in `out/summary.txt` and the CSVs. Data: 132 stocks, Yahoo 1h (unadjusted) and daily/weekly, all on the same window, 2 Nov 2023 – 16 Oct 2026. YTC's test (PAT p453–454): the lowest workable timeframe depends on how big a typical swing is compared with costs.

## Swing size vs costs (YTC 2-bar swing legs, median across stocks)
| Trading timeframe | Swings per year | Median swing | 25th pct swing | Median bars per swing | Round trip 0.3% / median swing |
|---|---|---|---|---|---|
| **1h** | 363 | **2.0%** | 1.4% | 4 | **15%** (8–22% across stocks) |
| Daily | 54 | 6.0% | 4.2% | 4 | 5% |
| Weekly | 11 | 13.9% | 9.8% | 3 | 2% |

**What this means in R:** a structural stop is typically about half a swing. That puts costs at **about 0.3R per trade on 1h** in the cash market, against **about 0.09R on daily**. Strategy 001's whole edge over random entries was 0.07–0.10R. So a 1h strategy needs either a much larger edge per trade or cheaper execution.

## Costs depend on what we trade (to verify with the broker before production)
| | Cash delivery (our current model) | Stock futures |
|---|---|---|
| STT | 0.1% buy + 0.1% sell | 0.02% on sell only |
| Stamp, exchange fees, GST, brokerage | about 0.02% | about 0.01% (flat brokerage per order, large notional) |
| Slippage (our assumption) | 0.05% per side | 0.05% per side |
| **Round trip** | **about 0.32%** | **about 0.13%** |

With futures, 1h costs fall to **about 6% of a median swing (about 0.13R)**, close to daily-bar cash economics.

The trade-offs:
- **Lot sizes** mean a large notional per trade (often ₹5–15 lakh), which constrains position sizing at 0.5–1% risk.
- **Monthly expiries** mean rolls.
- **Only F&O-eligible stocks** can be traded this way; that's most of our universe, and `fo_fut` gives the list per date.

The user already allows F&O, so **002 will be tested under both cost models.**

## 1h data structure (median across stocks)
- **7 bars per session:** 09:15, 10:15, …, 15:15 (the last bar is 15 minutes). 1.9% of days are short (holidays, special sessions).
- **The first bar is special:** its median range is 1.34%, against 0.66% for a typical 1h bar. The median overnight gap is 0.35%, about half a typical bar. Rules on 1h need to treat the opening bar, and gaps through stops and limits, explicitly. This matches the sources' advice to wait for the first hour on gap days (`notes/ytc_synthesis.md` §4.7).
- **Agreement with Yahoo daily:** the median correlation of day returns, built from 1h bars vs Yahoo daily, is 0.986. The outliers come from corporate actions in the window: BAJFINANCE 0.49 (split and bonus 2025), SIEMENS 0.82 (demerger), TRENT 0.87, CONCOR 0.93. **The 1h loader must apply split, bonus and demerger adjustment** before any backtest.

## Conclusion
- **1h is workable, but only under conditions.** Costs are three times heavier relative to swings than on daily, so in the cash market an hourly strategy needs about three times 001's edge.
- **The 002 spec will therefore:**
  1. report every result under both cash and futures cost models;
  2. treat the opening bar and overnight gaps explicitly;
  3. run the same rules with daily as the trading timeframe (user decision 5) as the comparison;
  4. use a split-adjusted 1h loader.
