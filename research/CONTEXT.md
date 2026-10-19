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

## Where things stand (2026-10-15, end of session 2)
1. **Market analysis is done**, with `01_market_analysis/report.md` written from `out/summary.txt`.
   - **Data:** 132 NSE stocks, Yahoo daily, 2005–2026. NIFTY 50 before 2007-09 comes from the Fyers cache (Yahoo's ^NSEI starts then).
   - **Holding is the bar to beat:** +1.84% per 20 days for any stock-day. The median stock compounded 17% a year, the NIFTY 50 11.8%. Survivorship flatters long results.
   - **Little edge in:** regime filters (the index regime flips sign between periods), YTC structure state (about 0.35% per 20 days, and it barely persists), breakouts and BOF.
   - **Pullbacks:** the depth/duration continuation tables are descriptive only. **Measured causally, buying at the pullback-low confirmation earns −0.02% excess per 20 days.** The +0.19% figure in the hand-off came from ex-post swings.
   - **What holds up:** 12-1 month momentum, about +0.4% a month in both periods. Short-term reversal is real but decaying (0.7% → 0.18% D1–D10 per 5 days). Gap-ups fade during the day.
2. **Swing lookahead found and fixed.** `structure.find_swings` de-duplicates its list ex-post, dropping 19% of swings. Bar-by-bar code must use `structure.raw_swings` and rebuild the alternating sequence as known on each bar, as `trend_state` and 001's `symbol_features` now do. Truncation tests: `common/test_structure.py` and `strategies/001_pullback_failure/test_no_lookahead.py`. **Re-run both tests for any new structure code.**
3. **Strategy 001 (failed-pullback buy): DROP as a stand-alone strategy.** See `strategies/001_pullback_failure/results.md`.
   - **Per trade, out-of-sample:** +0.161R (n = 4,706, t_month 2.56). In-sample: +0.061R (t_month 1.87).
   - **Against random entries with the same exits** (context-matched, 50 seeds): +0.07R out-of-sample, +0.10R in-sample, p ≈ 0.02. The pullback-failure *timing* adds a little.
   - **As a portfolio** (1% risk, 10 slots): −10% CAGR and −89% drawdown in-sample; +1.5% CAGR out-of-sample. NIFTY returned 10–12% and equal-weight buy & hold 19–24%.
   - **The edge is in the trailing exit plus momentum.** The YTC T1 target loses.
4. **Tooling added:** `portfolio.trade_stats` reports `t_month` (month-clustered; use it, since the per-trade t overstates significance by up to 2.5×). There's a context-matched random baseline (`random_pool(..., matched=True)`, 50 seeds), `backtest.benchmarks()` (NIFTY, equal-weight rebalanced and buy & hold), `select_params.py` (a pre-registered selection rule) and `reconcile_portfolio.py`.

## Next steps
**Follow `ROADMAP.md`.**
- Phase 0 (the book study) is done.
- Phase 1 data is done for the research stage: survivorship-free adjusted daily from NSE bhavcopies, adjusted Yahoo 1h, F&O futures (see `DATA.md`).
- **Strategy 002 tested (2026-10-19), see `strategies/002_trap_pullback_wholesale/results.md`.** Daily: REVISE. The trap + limit entry + trail beat random out-of-sample (+0.038R cash / +0.102R futures per trade, p = 0.04), but the portfolio makes only +2.6% / +7.1% CAGR vs 18.4% for equal-weight buy & hold. 1h: DROP (worse than random out-of-sample). The 2019-26 period is now used: further tuning must be judged in-sample only. Next: propose strategy 003, using 002's daily trap + limit entry as the timing layer inside a fully invested momentum book (new spec), and/or Tier 2 filters tested in-sample.
1. Book study done (17 Oct 2026): `notes/ytc_synthesis.md` is the entry point. Next: the user picks the Tier 1 rules and answers its §9 decisions, then write `strategies/002_*/spec.md`. Stage A daily-only tests run on Yahoo; Stage B (1h entry layer) needs Fyers 1h history.
2. **Later candidate** (was the lead for 002): a low-turnover momentum book, where 001's pullback-failure trigger only decides when to buy a top-momentum name, and exits are a trail or a rank drop. Judge it against equal-weight buy & hold and against random-timing entries into the same names.
3. **Other candidates:**
   - Short-term reversal inside strong stocks (decaying after 2019; costs are the hurdle).
   - A 1h/15m entry inside a daily setup, YTC-style (needs Fyers intraday data in bulk).
4. **Portfolio realism for any strategy:** the 20% weight cap together with 1% risk under-uses risk when stops are wide. Report both per-trade and portfolio results, and how much risk was actually used.

## Decisions from the user (answered 2026-10-15)
1. **Direction: long, plus shorts through F&O.** Shorts must be modelled as
   stock futures (or index futures for hedging), only on F&O-eligible names,
   with lot sizes, margin, monthly rollover and F&O costs. Indian cash
   equities can't be held short overnight.
2. **Data: research on Yahoo is fine; implementation will be on Fyers.** Plan
   and test on Yahoo daily. Before anything goes into the app, re-check the
   chosen rules on Fyers data, since that's what the app trades on.
3. **Intraday: daily first, intraday later.** Strategy 002 is a daily study.
   Prepare the Fyers 1h/15m bulk download for a later strategy (003). The user
   runs anything that needs the shared Fyers login.
4. **Update (2026-10-17): finish the book study first** (Scalper, Blogs, YTC
   vols 1 and 4–6). **The first strategy after that is a swing strategy on the
   hourly-to-daily timeframes**, not intraday and not the daily momentum book.
   This replaces decision 3's "002 is a daily study". It needs Fyers 1h
   history (Phase 1 in `ROADMAP.md`).
5. **Timeframe for 002 (2026-10-17): 1h is the trading timeframe**, with daily
   as the higher timeframe. Build it timeframe-agnostic (the higher, trading
   and lower timeframes are parameters) and test it on both 1h and daily as
   trading timeframes. If it only works on one, proceed with that one; that's
   acceptable.
6. **Data (2026-10-17):** keep every copy, including the old
   `backend/data/market.duckdb` snapshot in the worktree. More data is
   welcome. Prefer open sources (`DATA.md`). The sibling `indicator` folder
   is read-only, and anything taken from it is copied.

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
- **Branches (user's global rules, from 2026-10-18):** `dev` → `uat` → `main`.
  Every task gets its own branch, `<type>/cl/<task>`, cut from `dev`
  (e.g. `feat/cl/data-adjustments`, `docs/cl/strategy-002-spec`). Never
  commit directly to `dev`, `uat` or `main`. When a task is done and tested,
  ask the user before merging it into `dev`. Promotion to `uat`/`main` only
  happens when the user says so.
  - `dev` and `uat` were created from `main` on 2026-10-18.
  - All research up to the data adjustments was merged into `dev` (`733fe69`).
  - `trading_research` and `trading_research_data` are historical.
- **Commits:** in logical steps on the task branch, each message ending with
  the project's co-author line, pushed to the task branch on `origin`.
- **How to report to the user:** concise, numbers first, then an honest verdict.
  The user prefers the strategy being researched and justified over being
  quickly implemented.
