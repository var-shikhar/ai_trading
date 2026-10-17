# Roadmap: from research to a deployed strategy

Agreed with the user on 17 Oct 2026. The aim is quality over speed: each phase ends with an explicit gate, and nothing moves forward on a hunch.

**Order decided:**
1. Finish the source study (Phase 0).
2. The first strategy to build is a **swing strategy on the hourly-to-daily timeframes**: daily/weekly structure and setups, with 1h (maybe 15m) used for the entry and trade management.
3. The daily momentum book becomes a later candidate.

## Phase 0: Source study (in progress)
- [x] YTC Price Action Trader, vols 2–3 → `notes/ytc.md`
- [ ] YTC Price Action Trader, vols 1 and 4–6 (business, trade management, development, review) → `notes/ytc_vol4_6.md`
- [ ] YTC Scalper (lower-timeframe adaptation: entries, stops, scratching) → `notes/ytc_scalper.md`
- [ ] YTC blog posts 1–100 → `notes/ytc_blogs.md`
- [ ] Synthesis → `notes/ytc_synthesis.md`: the YTC method mapped to weekly / daily / 1h, plus a ranked list of testable rules (how mechanical each is, what data it needs, how to test it against a random baseline).
- **Gate:** the user reviews the synthesis and picks the rules for the hourly-to-daily strategy.

## Phase 1: Data foundation
- **Fyers 1h (and 15m) history** for the F&O universe.
  - Script in `research/common/`; **the user runs it** because it uses the shared login. It must respect rate limits and resume after interruptions.
  - Stored in `research/data/` (git-ignored).
  - Check first how far back Fyers serves 60-minute bars. That depth sets the in-sample/out-of-sample split for the hourly strategy.
- **Survivorship-free daily universe** from NSE bhavcopies (including delisted names). Re-measure the bias on the market analysis.
- **F&O reference data:** which stocks were eligible on each date, lot sizes, the ban list, and futures prices (for roll and basis costs).
- **Data checks:** missing bars and session times (09:15–15:30 IST, with 1h bars aligned to the session); corporate actions; and agreement between Fyers, Yahoo and bhavcopy daily bars.
- **Gate:** a data audit report.

## Phase 2: Strategy 002, hourly-to-daily swing
- `spec.md` is written before any testing. It covers the rules, the timeframe roles, and what would falsify the idea.
- **A design choice to settle in the spec:**
  - (a) daily is the trading timeframe and 1h is used only for the entry and stop; or
  - (b) 1h is the trading timeframe, with daily as the higher timeframe.
- **Validation protocol, as for 001:**
  - causal features with truncation tests;
  - costs and slippage;
  - in-sample grid with a pre-registered selection rule;
  - out-of-sample run once;
  - random-entry baselines (any stock, and context-matched) with the same exits;
  - one-at-a-time sensitivity in both periods;
  - month-clustered t-stats;
  - portfolio simulation with the risk actually used, compared with the NIFTY and equal-weight buy & hold.
- **Pass criteria:**
  - beats the matched random baseline in both periods;
  - month-clustered t above 2 out-of-sample;
  - portfolio return per unit of drawdown better than buy & hold;
  - no sign flips under one-step parameter changes.

## Phase 3: Fyers re-check and walk-forward
- Re-run on Fyers data with a full cost model: cash market (brokerage, STT, exchange fees, stamp duty, GST) and F&O (lot sizes, margin, rolls).
- Walk forward by year, re-fitting only on past data each time.
- **Gate:** results within tolerance of the research version.

## Phase 4: Paper trading (at least 2–3 months)
- Fixed parameters. A scheduled job posts signals to the app's signals inbox through an API key.
- Track expected vs actual fills, slippage, gaps, missed signals and data outages.
- **Gate:** live statistics stay inside the backtest's confidence band. If not, back to research.

## Phase 5: Production in the app
1. **Engine parity:** the app's Strategy Lab and the research backtester produce identical trades on the same data. This is a hard gate.
2. The strategy as scanner conditions plus a saved strategy, including any indicators or timeframes the app lacks (1h resampling, swing structure).
3. A scheduled signal job: daily close and/or hourly bars, depending on the spec. The agent posts entry, stop, size and the reason for each trade.
4. **Risk controls:** a portfolio heat limit, a drawdown kill switch, per-name and per-sector caps, F&O margin checks. Exact rules come from the `ytc_vol4_6.md` notes and the backtest.
5. **Monitoring:** daily live-vs-expected report, data-freshness and Fyers token health alerts.
6. **Fits the 1 GB VPS:** research stays offline; the VPS runs only the signal job and serves results.
7. **Runbook:** when to pause, how to re-validate each quarter, how to change parameters (only through the research protocol).

## Later candidates
- A low-turnover daily momentum book that uses 001's entry trigger for timing, with an F&O hedge.
- Short-term reversal in strong stocks.
- YTC setups not tested yet: TST and BPB.
