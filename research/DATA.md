# Research data: sources, coverage, how to rebuild

Everything lives in `research/data/` (git-ignored). Each source below can be rebuilt with the script shown. Status as of 17 Oct 2026.

| Dataset | File | Source | Coverage | Rebuild |
|---|---|---|---|---|
| Daily OHLCV, adjusted | `yf.duckdb` | Yahoo (open) | 132 stocks + NIFTY/BANKNIFTY, 2005→ | `common/fetch_yf.py` |
| **1h OHLCV, unadjusted** | `yf_1h.duckdb` | Yahoo (open) | same universe, **last ~730 trading days only** (from Nov 2023) | `common/fetch_yf_1h.py` (appends; re-run at least once a year so history keeps growing) |
| **NSE cash-market bhavcopy** | `nse_bhav.duckdb` → `cm_bhav` | NSE archives (open, no login) | every security traded each day, **including later-delisted ones**, 2005→, raw prices | `common/fetch_nse_bhav.py 2005-01-01` (resumable) |
| **NSE F&O futures** | `nse_bhav.duckdb` → `fo_fut` | NSE archives | stock and index futures each day (the F&O-eligible list per date); lot size from Jul 2024 only | same script |
| Fyers cache (market tables only) | `fyers_snapshot/fyers_market.duckdb` | copy of the app's cache | 58 daily symbols back to 1998; little intraday (15m RELIANCE 8 months, SBIN 2 months, NIFTY 2 years) | copy `market.duckdb` and `.wal` from the app read-only, then `common/clean_fyers_copy.py` (strips login tokens and user tables) |

## What each one is for
- **Stage A (daily rules, 2005–2026):** Yahoo daily now. Then the bhavcopy universe, to remove survivorship bias: delisted and fallen stocks are included, and liquidity filters are applied per date.
- **Stage B (1h entry layer):** Yahoo 1h, about 3 years.
  - Enough for an in-sample / out-of-sample split of about 2 years / 1 year, or a walk-forward. **Not** enough for 20-year robustness.
  - Daily rules are validated on 20 years first; the 1h layer is only tested as an *entry refinement* on top of them.
  - Fyers can serve longer 1h history, but it needs the shared login; the user would run that download.
- **F&O shorts and hedges:** `fo_fut` gives futures prices, so it provides the basis, the roll cost and the eligible list. Lot sizes before Jul 2024 need another source: NSE's historical lot-size circulars, or the market-lot file per expiry.
- **Live / paper trading:** none of the above. That needs the app's Fyers feed (Phase 4 in `ROADMAP.md`).

## Caveats
- **Bhavcopy prices are raw.** Splits, bonuses and dividends aren't adjusted (RELIANCE had 1:1 bonuses in 2017 and 2024). Before using them for returns, build an adjustment from NSE's corporate-actions data, or use `prevclose` jumps (on the day after a corporate action, NSE sets the adjusted previous close).
- **Yahoo 1h:** bars start 09:15 and are hourly to 15:15 (the last bar is 15 minutes). It's unadjusted on purpose so appended history stays consistent; adjustment happens at load time.
- **Licensing:** NSE bhavcopies are public downloads, intended for personal and research use. We don't redistribute the data; it stays local and git-ignored.

## NSE download status (17 Oct 2026)
- **Complete for 2005-01-03 to 2026-10-16:** 5,399 cash-market files and 5,397 F&O files. `common/verify_bhav.py` writes its report to `data/verify_bhav.txt`.
  - Every NIFTY trading day is covered except the Sunday session of 25 Jun 2006. F&O also lacks 9 Oct 2013 and 30 Mar 2021.
  - 4,454 EQ symbols in total. 1,624 stopped trading, of which 169 were liquid (≥ ₹5 cr a day): HDFC, SATYAMCOMP, RCOM, JPASSOCIAT, HDIL, IBULHSGFIN and others. Some of these are renames (INFOSYSTCH→INFY, TISCO→TATASTEEL, ZOMATO→ETERNAL), so a symbol-change map is needed.
  - **Prices vs Yahoo:** day returns correlate 0.996 (median; minimum 0.977) once 365 split/bonus days are excluded. The raw bhavcopy shows those days as −50% to −90%.
- **Weekend sessions:** fetched after the NSE block lifted (3 workers; see the Adjustment section below).

## Adjustment (split / bonus / demerger), 19 Oct 2026
- **`common/fetch_nse_ref.py`** writes `nse_ref.duckdb`: NSE's corporate actions (42,131 rows, 2005→) and symbol changes (1,067).
- **`common/adjust.py`** builds `adj_factors` and `data_flags` (rules in its docstring):
  - **Listed** splits and bonuses are kept only when the price confirms them.
  - **Our 132 stocks:** Yahoo's adjusted history decides the unlisted events. NSE's list is incomplete before about 2010; ITC 2005 (÷15) and HINDALCO 2005 were missing from it, for example.
  - **Other stocks:** only clean ≥2× ratios are inferred, and every inferred or unexplained jump is flagged. Backtests skip trades spanning a flagged date (`adjust.flagged_dates()`).
  - Dividends aren't adjusted (price returns).
  - Load once with `adjust.load_canon()` (stocks with median value ≥ ₹10 lakh/day; about 230 MB), then `adjust.adjusted_panel(eq)`.
- **Validation** (`common/validate_adjust.py`):
  - 1,542 factors: 1,322 listed, 21 confirmed by Yahoo, 199 inferred.
  - Our 132 stocks vs Yahoo: median correlation 0.996 on all days. 288 of 641,484 days differ by >5 points; the largest are Yahoo glitches (e.g. TRENT and CONCOR on 1 Jan, ZYDUSLIFE 2006).
  - **Crash checks:** YES Bank 2018/2020, IDEA 2019, DHFL 2019, RCOM 2017, JP Associates 2012 and Satyam 2009 all stay as real moves.
- **1h:** `common/hourly.py: load_1h()` undoes Yahoo's inconsistent 1h adjustment and applies the same factors as the daily panel.
  - Before: BAJFINANCE 2025 was only half-adjusted and the SIEMENS 2025 demerger not at all (`common/check_1h_splits.py`).
  - After: 135 stocks, median correlation of day returns with the adjusted daily panel 0.991 (minimum 0.974), 0 days off by >5 points, 34 bad bar-days dropped.
- **Renames:** `universe.CURRENT_SYMBOL` maps TATAMOTORS→TMPV (after the Oct 2025 demerger; the commercial-vehicle arm is TMCV) and LTIM→LTM. Yahoo's 1h history for these starts only at the new listing date.
- **Weekend sessions:** done; 14 files added, nothing left to retry.
