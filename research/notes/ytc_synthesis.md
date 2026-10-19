# YTC synthesis: what the sources say, what our data says, and candidate rules for strategy 002 (hourly→daily swing)

Written 17 Oct 2026 after reading all four sources in full. Detail and page references are in the source notes; this file only connects them.

| Source | Pages | Notes |
|---|---|---|
| YTC Price Action Trader, vols 2–3 | p64–272 | `ytc.md` |
| YTC Price Action Trader, vols 1, 3 (rest), 4–6 | p1–63, p273–624 | `ytc_vol4_6.md` |
| YTC Scalper | p1–232 | `ytc_scalper.md` |
| YTC Blog, posts 1–150 (two ebooks in one PDF) | p1–309 | `ytc_blogs.md` |

Page refs below are PDF pages. "PAT" means Price Action Trader, "S" the Scalper, "B" the blogs.

## 1. What YTC is, and isn't
- **It is a discretionary intraday method** (futures and forex, 1–30 minute charts), built on three things:
  - **bias**: future direction, read from structure plus strength and weakness;
  - **location**: support/resistance on the higher timeframe and room to the next barrier;
  - **entry price**: wholesale, not retail.
  
  It is wrapped in active trade management and a strict business and risk process.
- **There are no statistics anywhere.** No win rates, no expectancy, no sample sizes, only selected examples. Every idea below is a hypothesis for us to test, not evidence.
- **The author says a systematic trader should not manage by discretion** (PAT p299–302). His own active management serves his psychology and isn't proven better. So every management idea has to become a fixed rule that we test.
- **Swing trading of stocks gets one page of method.** The SPY example (PAT p471–475) uses weekly / daily / 1h, with a weekend watchlist of 20–30 smooth trending stocks above a volume floor. He adds that he hasn't traded stocks in years. Everything else has to be translated from intraday.

## 2. Timeframe stack for strategy 002
The sources agree on a three-level stack with about a 5× step between levels. The book's own stock example (PAT p471) is exactly ours:

| Role | YTC (PAT / Scalper) | Ours |
|---|---|---|
| Higher timeframe: S/R framework, T2, room | 30m / 5m | **Weekly** |
| Trading timeframe: bias, structure, setup, structural stop, T1 | 3m / 1m | **Daily** |
| Lower timeframe: entry price and trigger, early management | 1m / 1-range | **1h** (15m optional) |

- **Management moves up a timeframe.** Manage on the lower timeframe only around the entry, and switch to the trading timeframe as soon as possible, at the latest once part 1 has exited (PAT p303–304, p314). For us that means 1h rules for the first 1–2 sessions, then daily rules.
- **The lower timeframe never sets direction** (S p56, p77, p85). On 1h it only times the entry and handles early scratching. **The hard stop stays structural** on the daily chart (S p108, p210).
- **Session effects on 1h:** NSE 1h bars include the overnight gap and the opening hour. The Scalper found channels built on time bars unreliable (S p154). The sources suggest waiting for the first hour on gap days (S p131–135, PAT p469, p475, B p294).

**Recommendation:** use daily as the trading timeframe with 1h as the entry layer (design option (a) in `ROADMAP.md`), not 1h as the trading timeframe. It's the book's own mapping, it keeps the trade count and costs manageable, and its daily-only version can be tested on our 20 years of data before any 1h data exists.

## 3. Our data so far vs YTC claims
| YTC idea | Our evidence (NSE daily, 2005–2026) |
|---|---|
| Structure (HH/HL) sets bias | Little or no edge; the state barely persists (`01_market_analysis/report.md` §2) |
| Shallow, short pullbacks continue | True after the fact; buying at the confirmed pullback low earns no excess (report §4) |
| BOF (single failed breakout) | No edge (report §5) |
| PB/CPB with a buy-stop trigger ("simplified LWP", PAT p282) | +0.07 to +0.10R over random entries with the same exits, but thin against costs. Portfolio loses to buy & hold (001) |
| T1 exit at the prior swing high | Loses: −0.09R in-sample, −0.08R out-of-sample (001, `exit swing`) |
| Trailing the runner | Where all of 001's edge lives |
| 1:1 room-to-T1 gate (PAT p280) | **Partly tested:** with the trailing exit it *hurt* (`min_room 1`: +0.019R vs +0.061R in-sample; +0.097R vs +0.161R out-of-sample). **Not tested:** the gate combined with the two-part T1 exit it was designed for |
| Momentum (not YTC) | The only robust selection effect found |

**Reading:** the idea of "direction from structure" hasn't held up on daily NSE bars. What has held up a little is the *timing* of a pullback-failure entry inside momentum stocks, plus trailing exits. The YTC material that hasn't been tested yet mostly concerns **entry price** (wholesale or limit vs the confirmation trigger), **trap conditions**, and **management**. Those are exactly the levers that could lift a thin timing edge above costs.

## 4. Themes that recur across the sources
Ideas that appear in several sources independently are the strongest candidates. Each line gives the page references.

1. **Confirmation costs price; enter wholesale and don't chase.**
   - Limit entries in the lower-timeframe channel before the turn, never above the centreline (S p86–99, p97, p110, p151).
   - Entry zone between the stop and the nearer of LWP and LRP; skip the trade if price has gapped past it (PAT p273–282, p295).
   - Single-bar pullbacks: time the entry on the lower timeframe (B p79).
   - Exception: in fast markets, when the pullback never reaches the wholesale zone, use a stop entry (S p140). *Our buy-stop edge may be exactly this case.*
   - Risk to measure: **adverse selection**. Deep limits fill mostly on losers and miss winners (S p97, p151).
2. **Trap conditions, not depth.** The best setups trap someone:
   - a pullback that undercuts the prior swing low and then reclaims it (PAT p250, p496);
   - a rejected swing-low break in an uptrend (B p63–64, p231);
   - "fails twice, then the opposite" (B p34, p264, p269, p281);
   - a 1h spring through the pullback low (PAT p288, p617).
   
   Our depth and duration tests never conditioned on a trap.
3. **Management in two parts, with the runner trailed.**
   - Part 1 at T1 (only if T1 ≥ 1R); part 2 to breakeven when T1 fills, then trailed under each confirmed swing low or each strong new-high bar (PAT p265, p311–318, p350, p433).
   - Drop T2 in trends; set T2 = T1 in ranges (PAT p316).
   - Exits should match the environment (B p164).
   - Windfall exit on spikes (S p107).
4. **Scratch rules (time, follow-through, adverse strength).**
   - A time stop when there's no progress (PAT p302–303; S p205; B p185, p279: a pattern's influence lasts about 1–6 bars).
   - Follow-through failure (PAT p408, p422; S p188).
   - Strength against the entry (S p212).
   - **Counterpoint:** early scratches cost winners in slow grinds (S p137, p139), and every scratch pays 0.3% in costs. Thresholds have to be tested.
5. **Location: S/R levels and room.**
   - Level set: higher-timeframe swings, prior period high/low, gap edges, the origin bars of fast moves, and congestion edges (B p122–128, p158, p192, p230, p303).
   - Room to the next weekly barrier; T2 just before weekly S/R; no T2 at 52-week or all-time highs, trail instead (PAT p264–269).
   - A breakout that runs straight into weekly resistance is a fade candidate (S p215).
6. **Selection: trade what moves.**
   - Weekend watchlist of the smoothest trends (PAT p475).
   - Pick the markets that are moving, e.g. by ADX (B p241).
   - Trend qualifiers: big bars point with the trend, space between price and the MA, EMA20 high/low channel (B p144, p182, p217).
   
   This combines naturally with our momentum result.
7. **Events and gaps.**
   - No new entries just before results, RBI policy or the Budget (PAT p463, p470, p476).
   - Pre-news breakouts tend to fail (B p116, p257, p286).
   - On gap days, no lower-timeframe entries until the first hour has formed (S p131–135; PAT p469, p475).
8. **Risk and process.**
   - 1% per trade, 0.5% per part.
   - Total open risk ≤ 3%, with breakeven positions counting as zero.
   - Correlated positions count as one bet.
   - Weekly pause at 2% and stop at 3% below the equity high.
   - Business stop at 20%, then back to paper.
   - Paper trading until 4 profitable blocks of ≥ 20 trades.
   
   All from PAT p481–487 and p592–597. These go into `ROADMAP.md` phases 4–5.

## 5. Ranked candidate rules for strategy 002
How the ranking works:
- **(i)** It recurs across the sources (§4).
- **(ii)** It targets a lever our data says might matter (entry price, trap, management) rather than one already shown dead (structure as direction, depth alone, single BOF).
- **(iii)** It's mechanical.
- **(iv)** It can first be tested daily-only on 20 years of data, then refined on 1h.

Source rule numbers are given as S#, B# and V# (= `ytc_vol4_6.md`).

### Tier 1: the core of the 002 spec (test first)
| # | Rule | Sources | Data | Why |
|---|---|---|---|---|
| 1 | **Trap pullback:** in a daily uptrend (or momentum stock), arm only after the pullback undercuts the prior swing low or the first leg's low and a close reclaims it. Includes the rejected-break variant | V12, B2, PAT p250 | D | Most-cited quality criterion; never tested by us |
| 2 | **Entry-price layer**, comparing four entry methods on the same setups: (A) daily buy-stop above the prior high (001, the control); (B) 1h trigger, either a spring/reclaim of the pullback low or a break of the 1h swing high; (C) a limit at the daily/1h wholesale zone (Keltner(20,2/4) centreline and inner band, or the EMA15/20 zone); (D) hybrid: the limit, falling back to the buy-stop when the pullback stays shallow | S3/S6/S8, V20/V22, B5 | D, then H | The central Scalper idea; directly attacks our cost-thin edge |
| 3 | **No-chase / gap skip:** cancel the entry if the open is beyond the trigger by g×ATR or beyond the LRP; limit fills only at or below the centreline | V2, S7, PAT p295 | D | NSE gaps are frequent; cheap to test; also a diagnostic of our 001 fills |
| 4 | **Two-part exit with the gate applied correctly:** part 1 at T1 only if T1 ≥ 1R; part 2 to breakeven at T1, then trailed (swing-low trail vs strong-bar trail); no T2 at 52-week or all-time highs | V1/V3/V5/V6/V11 | D (W for T2) | Tests the *original* YTC design we never ran; keeps the trail that works |
| 5 | **Time and follow-through scratch:** exit after N bars without +k·R, or when the entry day or next day closes back below the trigger | V7/V8, S15, B9 | D (H variant) | Recurs in all three sources; check that the cost per scratch is earned back |

### Tier 2: filters and variants (one-at-a-time on top of Tier 1)
| # | Rule | Sources | Data |
|---|---|---|---|
| 6 | Weekly watchlist: rank momentum stocks by trend smoothness (efficiency ratio or R²) and trend score; trade only the top 20–30 | V24, B10 | D/W |
| 7 | Room to the next weekly S/R in R, using a defined level set (weekly swings, prior week's high/low, gap edges, fast-move origins, congestion edges) | B3, PAT p264–269, S10 | W/D |
| 8 | Earnings, RBI and Budget blackout for new entries; tighten or exit before the event | V18, B15 | D + calendar |
| 9 | Over-extension: when the swing high was > x×ATR above EMA20, skip the first single-leg pullback and wait for a CPB | V14, S18 | D |
| 10 | Gap-day first-hour delay; time-of-day filter on 1h fills | V19, S21/S22, B6 | H |
| 11 | Two-failure BOF (long, and short through F&O) | B4 | D/H |
| 12 | Cool-down after 2 losses in the same stock and setup area; re-entry on a fresh trigger | V15/V16, S20 | D |
| 13 | Momentum-decay (projection and speed shrinking) as a skip or tighten signal | B11 | D |

### Tier 3: later or exploratory
- Breadth confirmation (S11; needs NIFTY 500 constituents).
- Layered-S/R breakout fade (S10).
- Key-reversal quality (B8).
- NR7 or inside-bar trigger (B13).
- Volume absorption (B12).
- Climactic failure in a grind (B14).
- Partial rise/decline (B17).
- Environment-adaptive T2 (V10).
- Breakeven variants for part 1 (V4).
- Two-part recovery (S14).
- Windfall exit (S12).

**Shorts (F&O):** the sources agree that counter-trend shorts in strong uptrends are low-probability (PAT p250–251). Shorts should be the mirror of Tier 1 in established daily downtrends, through stock futures. I suggest proving the long side first, then running the mirror image as its own test. A short leg can't reuse long-side results because of drift and survivorship.

## 6. Proposed test sequence for 002
**Stage A: daily-only, on Yahoo 2005–2026, same protocol as 001.**
- Tier 1 rules 1, 3, 4 and 5, plus the daily versions of rule 2 (A vs C vs D, using a daily Keltner/EMA zone).
- First, a cheap diagnostic: bucket 001's existing trades by where they filled in a daily Keltner(20,2/4) channel. If "retail" fills explain the thin edge, that's evidence for rule 2.
- Pre-registered selection rule, out-of-sample run once, random baselines, sensitivity, portfolio with the risk actually used.

**Stage B: 1h entry layer, on Fyers 1h (`ROADMAP.md` Phase 1).**
- Rule 2B/2C/2D on 1h, with rule 10, over whatever history Fyers serves. That depth sets the out-of-sample split.
- The Stage A daily rules are frozen; only the entry layer is varied.

**Pass criteria:**
- the same as `ROADMAP.md` Phase 2;
- Stage B must beat the Stage A daily entry on the *same* setups by more than the extra cost and the missed-fill rate.

## 7. Production requirements taken from the sources
These feed `ROADMAP.md` phases 4–5. Details are in `ytc_vol4_6.md` §4.

**Risk**
- Every order has an attached stop.
- 0.5–1% risk per trade; total open risk ≤ 3%, with breakeven positions counting as zero; a sector or correlation cap.
- Weekly circuit breakers (2% pause, 3% stop).
- A 20% business stop that falls back to paper.
- Risk amounts recomputed every weekend.
- F&O: lot-size feasibility, expiry and rollover checks.

**Contingency**
- A flatten path for broker or connectivity failure.
- Duplicate and partial-fill checks; confirm flat after each exit.
- Daily reconciliation of broker transactions with the app's trade log.

**Journal (per trade)**
- Planned vs actual entry, stop and targets, with slippage.
- Exit reason for each part.
- Best and worst excursion in R; the hindsight-ideal trade.
- Setup and regime labels.
- Skipped or missed signals with their reason and hypothetical outcome.
- Stats by subset with at least 20 trades per sample.

**Promotion**
- Paper until 4 consecutive profitable blocks of ≥ 20 trades.
- Live at minimum size with a 10% kill switch.
- Size increases proven on paper first.
- When performance degrades, cut size first, then simplify.

**App features**
- Bar replay with re-simulation of alternative management.
- A monthly plan review.

## 8. What can't be taken from the sources
- **Reading bias bar by bar** and strength into a level: the core of YTC's claimed edge. Not codifiable; we use proxies.
- **Discretionary scratching and target adjustment.** We approximate them with Tier 1 rule 5 and Tier 3 rules.
- **Chart-only content.** About half the blog posts, most Scalper figures, PAT's worked trades and the stock example (p471–474) are images. That includes the blog's two methods for separating major from minor S/R (B p270–272). Recovering them would mean someone viewing the PDF images.
- **His performance targets** (65% wins, a 1.5 win/loss ratio) belong to intraday discretionary trading. They're not benchmarks for a daily swing system.

## 9. Decisions needed from the user
1. Pick or trim the Tier 1 rules for the 002 spec. My recommendation: all five, with rule 2 as the main experiment.
2. Confirm the design: daily trading timeframe with a 1h entry layer, rather than 1h as the trading timeframe.
3. Longs first, with the short mirror as a separate test after? Or both in 002?
4. Event calendar: the source of NSE results dates for the blackout filter (rule 8), e.g. NSE corporate announcements or a data vendor.
