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
| `notes/ytc.md` | YTC Price Action Trader concepts, mapped to daily/weekly swing trading, with page refs |
| `common/` | data loading (`data.py`, `fetch_yf.py`, `universe.py`), YTC swings/trend (`structure.py`), portfolio simulation and stats (`portfolio.py`) |
| `01_market_analysis/` | base rates: drift, regimes, structure state, volatility, pullback depth/duration, breakouts/BOF, reversal and momentum, gaps. Findings in `report.md`, raw output in `out/summary.txt` |
| `strategies/001_pullback_failure/` | strategy 001: YTC PB/CPB failure in strong stocks. `spec.md`, `backtest.py`, `results.md`. **Verdict: dropped** (small timing edge over random entries; loses to buy & hold as a portfolio) |

## Sources
- Lance Beggs, *YTC Price Action Trader* (6 volumes in 1). The main source for 001. The PDF stays local.
- Part Time Larry (YouTube): Python tooling patterns (TA-Lib candlestick scanners, breakout/consolidation screeners, backtesting). Its scanner ideas (consolidation, breakouts, candlestick patterns) already exist in the app. The analysis here tested breakouts and found no stand-alone edge on daily NSE large caps.
