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
