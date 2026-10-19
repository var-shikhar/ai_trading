# Trading research (branch `trading_research`)

The goal is to find swing-trading strategies for NSE stocks: research them first, then backtest them honestly. Each strategy is a separate, self-contained study; later strategies can use different data, timeframes and rules.

## Process (per strategy)
1. **Market analysis.** Measure base rates on the data before designing anything (`01_market_analysis/`).
2. **Hypothesis.** Ground it in the analysis plus a source (YTC, Part Time Larry, our own ideas). Write `spec.md` *before* testing, with exact rules and what would falsify the idea.
3. **In-sample search (2005–2018).** Run a coarse grid. Pick parameters from a broad robust region, not the single best cell.
4. **Out-of-sample check (2019–2026).** Run once with the chosen parameters. Compare against buy & hold *and* against random entries that use the same exits.
5. **Sensitivity.** Perturb each parameter one at a time, in both periods.
6. **Decision.** Pursue (paper trade, then wire into the app's scanner/backtester), revise, or drop. Record the reasons in `results.md`.

## Rules of the road
- No lookahead. Swings count only once confirmed, and orders are placed for the next bar. Bar-by-bar code uses `structure.raw_swings` (never `find_swings`, which cleans its list ex-post), and every feature set gets a truncation test.
- **Costs:** 0.1% per side, plus 0.05% slippage per side.
- **Risk:** 1% per trade, at most 10 positions, no leverage.
- Long only, unless a strategy uses F&O.
- **Survivorship bias:** the universe is mostly today's names, which overstates long results. Judge strategies against the random-entry baseline as well as against the index.
- Data and books stay out of git: `research/data/` and `strategy reference/` are ignored. Re-create the data with `common/fetch_yf.py`.

## Running
```
# once: research venv with yfinance + pypdf (separate from the app's venv)
<app>/backend/.venv/Scripts/python.exe -m venv research/.venv
research/.venv/Scripts/python.exe -m pip install yfinance pypdf duckdb pandas
research/.venv/Scripts/python.exe research/common/fetch_yf.py          # daily NSE history -> research/data/yf.duckdb

# analysis and backtests use the app's venv (pandas, numpy, TA-Lib)
<app>/backend/.venv/Scripts/python.exe research/01_market_analysis/analyze.py
<app>/backend/.venv/Scripts/python.exe research/strategies/001_pullback_failure/backtest.py grid|final|sens
<app>/backend/.venv/Scripts/python.exe research/strategies/001_pullback_failure/select_params.py      # grid -> chosen_params.json (pre-registered rule)
<app>/backend/.venv/Scripts/python.exe research/strategies/001_pullback_failure/test_no_lookahead.py  # truncation test for the features
<app>/backend/.venv/Scripts/python.exe research/common/test_structure.py                             # truncation test for trend_state
```

## Index
| Path | What |
|---|---|
| `ROADMAP.md` | phased plan from research to deployment, with gates |
| `DATA.md` | data sources (Yahoo daily/1h, NSE bhavcopy cash + F&O, Fyers copy), coverage, rebuild commands |
| `notes/ytc_synthesis.md` | **start here:** all YTC sources joined up with our results, ranked rules for strategy 002 (hourly→daily) |
| `notes/ytc.md` | YTC Price Action Trader concepts (vols 2–3), mapped to daily/weekly swing trading, with page refs |
| `notes/ytc_vol4_6.md` | YTC PAT vols 1, 3 (rest), 4–6: entry zone, management, risk, process, production requirements |
| `notes/ytc_scalper.md` | YTC Scalper: lower-timeframe entry (channel/limit entries), scratching, exits |
| `notes/ytc_blogs.md` | YTC blog posts 1–150: S/R selection, traps, acceptance/rejection, time stops |
| `common/` | PDF extraction (`extract_pdf.py`) and page viewer (`pages.py <from> <to> [ytc / scalper / blogs]`), data loading and fetchers (`data.py`, `fetch_yf.py`, `fetch_yf_1h.py`, `fetch_nse_bhav.py`, `clean_fyers_copy.py`, `universe.py`), YTC swings/trend (`structure.py`), portfolio simulation and stats (`portfolio.py`) |
| `02_timeframe_check/` | is 1h workable? swing size vs costs on 1h / daily / weekly, 1h session structure, cash vs futures costs (`report.md`) |
| `01_market_analysis/` | base rates: drift, regimes, structure state, volatility, pullback depth/duration, breakouts/BOF, reversal and momentum, gaps. Findings in `report.md`, raw output in `out/summary.txt` |
| `strategies/002_trap_pullback_wholesale/` | strategy 002: YTC trap pullback, wholesale (limit/hybrid) entry, two-part exit; 1h trading timeframe (daily as comparison). **Verdict: daily REVISE (beats random OOS, loses to buy & hold as a portfolio); 1h DROP.** `spec.md`, `results.md` |
| `strategies/001_pullback_failure/` | strategy 001: YTC PB/CPB failure in strong stocks. `spec.md`, `backtest.py`, `results.md`. **Verdict: dropped** (small timing edge over random entries; loses to buy & hold as a portfolio) |

## Sources
- Lance Beggs: *YTC Price Action Trader* (6 volumes in 1), *YTC Scalper*, and the YTC blog collection (posts 1–150). All read in full; see `notes/`. The PDFs stay local.
- Part Time Larry (YouTube): Python tooling patterns (TA-Lib candlestick scanners, breakout/consolidation screeners, backtesting). Its scanner ideas (consolidation, breakouts, candlestick patterns) already exist in the app. The analysis here tested breakouts and found no stand-alone edge on daily NSE large caps.
