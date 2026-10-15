# Hand-off: trading research (read this first)

Context for a new session taking over the research on branch `trading_research`.
Read this, then `research/README.md` (process and index), `research/notes/ytc.md`,
`research/01_market_analysis/out/summary.txt` and
`research/strategies/001_pullback_failure/{spec.md,results.md}`.

## The project
- **"Indicator"** is a web app for **swing trading Indian markets (NSE)**, built
  by the user for themselves and a closed group of invited friends. Repo:
  `https://github.com/var-shikhar/ai_trading`. It's live at
  `https://trade.prepmonkey.in`, on a 1 GB VPS behind Caddy.
- **Stack:**
  - Backend: FastAPI.
  - Market data: Fyers API v3. One shared, admin-controlled login.
  - Candle cache: DuckDB.
  - App data: Postgres on Neon (users, watchlists, alerts, strategies,
    backtests, signals, API keys).
  - Analysis: TA-Lib plus our own pattern code.
  - Frontend: React + TypeScript + Vite, charts with TradingView Lightweight
    Charts.
- **The app already has** charts, indicators, drawings, candlestick and chart
  patterns, a screener, watchlists, alerts, a portfolio backtester (Strategy
  Lab), a live strategy on the chart (TradingView-style, `POST
  /api/backtests/chart`), saved strategies, and a signals inbox. Agents can call
  the API with keys like `Authorization: Bearer ik_…`.
- **The app's main purpose is screening and backtesting.** Later, AI agents will
  generate signals from strategies that this research validates.

## The research goal
- **Find swing-trading strategies with a real edge on NSE stocks.** Research and
  find the strategy first, then backtest it honestly and look for a robust (not
  overfit) set of parameters. Don't just implement someone else's rules.
- **Work on one strategy at a time.** There will be several, and each can use
  different data, timeframes and rules. Keep each one self-contained under
  `research/strategies/NNN_name/`.
- **Sources:**
  - Lance Beggs, *YTC Price Action Trader*. Focus on the "All 6 Volumes" book.
    The PDFs are local only, in
    `C:\Users\varsh\Downloads\indicator\strategy reference\`. They're
    copyrighted: never commit them or quote long passages; summarise in our own
    words with page references.
  - Part Time Larry (YouTube): Python trading tooling and ideas.
  - Our own ideas, driven by the data.
- **YTC is intraday.** We swing trade on daily bars, with weekly bars for
  context and possibly 1h/15m for entries, so YTC concepts have to be adapted
  and tested, not assumed.
- **A strategy that passes** goes into the app later: as scanner and backtester
  conditions, saved as a strategy, and run by agents that post signals.

## Where things stand (2026-10-15)
Commits on `trading_research`: `d641e3b`, `06c3b81`.

1. **Market analysis is done.** Raw numbers are in
   `01_market_analysis/out/summary.txt` and the CSVs. **`report.md` was never
   written**: write it from `summary.txt`, with the key numbers and what they
   imply for strategy design.
   - **Data:** 132 NSE stocks, daily bars from Yahoo, 2005–2026. Checked
     against the Fyers cache, daily returns correlate 0.98–0.997.
   - **Holding is the bar to beat:** being in a stock earns +1.84% per 20 days.
     The median stock compounded 17% a year, the NIFTY 50 9%. Survivorship bias
     flatters long results.
   - **Little edge in:** regime filters (being above or below the 200-day
     average changes returns very little), YTC's up/range/down structure (about
     0.35% per 20 days, and the state barely persists), and breakouts beyond
     20/55/250-day highs (0–0.1% extra; 46% fail within 3 bars, and trading the
     failure loses too).
   - **YTC pullbacks point the right way, but the edge is thin:**
     - Chance the next leg makes a new high: 89% after pullbacks under 25%
       deep, 61% at 50–62%, 32% when the prior low breaks.
     - By duration: 64% after pullbacks of 3 bars or less, 35% after 6–8 bars.
     - The tradeable extra return is only +0.3–0.6% per 20 days, about equal to
       costs.
   - **What holds up:**
     - 12-month momentum: about +0.4% a month, stable in both halves of the data.
     - Short-term reversal is real but fading: about 0.7% per 5 days before
       2019, 0.18% after.
     - Gap-ups fade during the day (2–4% gaps lose −0.73% from open to close):
       don't chase gap opens. This could become a separate intraday idea.
2. **Strategy 001: buying a failed pullback** (`strategies/001_pullback_failure/`).
   - **Rules:** daily bars, long only.
     - Setup: after a confirmed swing high, a pullback of 8 bars or less with
       depth 20–300%, in a stock in the top 30% by 6-month return.
     - Entry: buy-stop above the previous bar's high.
     - Stop: 0.2% below the pullback low.
     - Exit: trail under each new confirmed swing low, or a 30-bar time exit.
     - Sizing: 1% risk per trade, at most 10 positions.
   - **In-sample grid (2005–18) only:** 41 of 288 combinations are positive.
     - With the momentum filter: 6,113 trades, +0.10R per trade, t = 3.4.
     - Without it: 19,548 trades, +0.07R per trade, t = 4.5.
     - The win rate is about 27%, so the edge comes from large trailed winners.
   - **Didn't work:**
     - YTC's fixed first target at the prior swing high: −0.20R per trade.
     - Entering at the next open instead of the buy-stop.
     - YTC's up-structure filter: no improvement.
   - **Not validated yet.** It could just be the market's drift plus a trailing
     stop.

## Next steps
1. **Fix the chosen parameters** in `strategies/001_pullback_failure/chosen_params.json`.
   Pick from a broad region of the grid that holds up, not the single best cell.
2. **Run `backtest.py final`** on 2019–2026 out-of-sample. Compare with the
   NIFTY 50, equal-weight buy & hold, and **a random-entry baseline that uses the
   same exits**; that baseline decides whether the edge is real. Run it once.
3. **Run `backtest.py sens`:** move each parameter one at a time, in both
   periods.
4. **Update `results.md`** with a clear verdict (pursue, revise or drop) and the
   reasons. Write `01_market_analysis/report.md`.
5. **Then propose strategy 002.** Candidates: momentum combined with
   pullback-entry timing; short-term reversal in strong stocks; and a 1h/15m
   entry inside a daily setup, YTC-style (needs Fyers intraday data in bulk).

## Open questions for the user (ask, don't assume)
1. **Long only (cash market),** or also short through F&O?
2. **Is Yahoo daily data acceptable,** or should the research be redone on Fyers
   history?
3. **Should strategy 002 use 1h/15m entries?** That needs a bulk download of
   Fyers intraday data.

## Environment and rules
- **Work only in the worktree** `C:\Users\varsh\Downloads\indicator-research`
  (branch `trading_research`). The main app checkout is
  `C:\Users\varsh\Downloads\indicator` (branch `main`); leave it alone, except
  for reading the PDFs.
- **Never start the backend or frontend, and never run builds.** The user runs
  those. Never use `DATABASE_URL`, Neon or the backend `.env`, and don't import
  `app.store` or `app.main`. Pure modules are fine: `app.analysis.*`,
  `app.backtest.engine/signals/metrics`.
- **Never kill processes you didn't start.** An earlier session force-stopped
  every busy Python process, which can take down the user's local server.
- **Python:**
  - Run analysis with `C:\Users\varsh\Downloads\indicator\backend\.venv\Scripts\python.exe`
    (pandas, numpy, duckdb, TA-Lib).
  - Extra packages (yfinance, pypdf) go in `research/.venv` only.
  - On this Windows machine, PowerShell is the reliable shell. Bash heredocs
    break on apostrophes, so write scripts to files.
- **Data:**
  - `research/data/yf.duckdb`: the Yahoo daily cache; rebuild it with
    `common/fetch_yf.py`.
  - `backend/data/market.duckdb` in the worktree: a snapshot of the app's Fyers
    cache. Open it `read_only=True`. It holds daily bars for 58 symbols
    (NIFTY 50 stocks and indices) since 1998, plus 2 years of 15m bars for 8
    symbols.
  - Bar timestamps are IST wall-clock time stored as UTC epoch.
  - Data folders and PDFs are git-ignored. Keep it that way.
- **Rigour:**
  - No lookahead.
  - Costs: 0.1% per side, plus 0.05% slippage per side.
  - Split in-sample (2005–18) from out-of-sample (2019–26).
  - Report sample sizes and t-stats.
  - Always compare against buy & hold and random entries.
  - Flag survivorship bias.
- **Commits:** make them in logical steps on `trading_research`, end each
  message with the project's co-author line, and push to
  `origin trading_research`.
- **How to report to the user:** concise, numbers first, then an honest verdict.
  The user prefers the strategy being researched and justified over being
  quickly implemented.
