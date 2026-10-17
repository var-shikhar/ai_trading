# YTC Scalper (Lance Beggs): notes for hourly-into-daily swing trading

These are my paraphrased notes, not quotes. Page numbers are **PDF pages** (pNN) of *YTC Scalper* (1st edition 2011, v1.01, 232 pages), read in full from the pre-extracted text. Almost every figure is a chart image that did not extract. Where a point depends on a chart I could not see, it is marked **[chart]**. Companion notes: `notes/ytc.md` (Price Action Trader, PAT). This file does not repeat PAT material (S/R, swing definitions, trend structure, strength and weakness, the five setups, T1/T2). It cross-references it as "ytc.md §N".

## 0. What the book is and what it adds

- **What it is.** A supplement that adapts YTC PAT to trading timeframes below 3 minutes (p12). PAT is a stated prerequisite, and the book deliberately does not repeat PAT's market theory or analysis (p12, p16). The author says the analysis stays the same and only the *trading process* changes: how you enter, manage and exit, and how you run your routines (p19, p24, p77–78).
- **Why a new process is needed.** On very short timeframes, information comes too fast and carries more "shake-out" noise. PAT's checklists and lower-timeframe pattern triggers then cause hesitation and missed entries (p55–59). The fix is simplification, not better analysis (p63–64, p67, p226).
- **The three changes over PAT** (p79, p89–112):
  1. **Five setups become two.** PB, CPB, TST, BOF and BPB are still identified during analysis, but trades are classed only as **with-flow (WF)** or **counter-flow (CF)** relative to the lower-timeframe channel (p90).
  2. **The lower timeframe becomes a "scalping channel"**: Keltner bands on a 1-range chart, which mark *wholesale* and *retail* zones (p86–89).
  3. **Entry uses areas, not triggers.** You place resting **limit orders in the wholesale zone** and **scale in with two parts**, instead of waiting for a lower-timeframe pattern trigger. The principle behind this is "imperfection": you know the area, not the exact turning tick (p91–95).
- **Timeframes** (p13, p78):

| Role | PAT (ytc.md) | Scalper | Ratio |
|---|---|---|---|
| Higher timeframe (S/R framework) | 30 min | **5 min** | 5× the trading TF |
| Trading timeframe (bias, structure) | 3 min | **1 min** | n/a |
| Lower timeframe (entry, management) | 1 min | **1-range bars** + Keltner channel | finest price detail |

  The author has tried 2-range, 20-tick, an EMA 15/20 template, and 10-second time bars as lower timeframes. All were usable except that **time bars gave unreliable channels** (p13, p144–156).
- **Markets.** Only the most liquid FX futures (6E) and E-mini (TF). He did not test stocks and says you must test them yourself for liquidity and for swing size versus costs (p13). He moved from 6B to 6E because of the **commission-to-tick ratio** (p13), which is the same cost-versus-swing concern we have at roughly 0.3% round trip.
- **The author's caveat.** The book is not a simple mechanical system. Trading every pullback in the channel direction will "likely underperform" without PAT bias analysis (p30–31, p149, p153). This is a warning for us: the channel itself is not the edge. The edge is meant to come from the bias.

---

## 1. Part One: introduction and scalping (p10–26)

- **p12–13 Scope.** PAT applies to any liquid market and timeframe with enough swing size after costs. The scalper techniques "may also be applied" on higher timeframes (p12).
- **p14** Order flow is read from charts only. Time-and-sales and DOM reading are out of scope.
- **p18–19 Author's evolution.** He moved from 30/3/1 to 5/1/range charts for lifestyle reasons and kept them. Market theory and analysis stay the same; only execution and routines change.
- **p21–22 Definition.** "Scalping" here does not mean bid/ask market-making. It means short-term momentum trades on surges in order flow. A typical scalp lasts seconds to about 5 minutes, but **a portion is kept on when a trending move is possible**. The premise is a short-timeframe surge; the exit is not capped at a target.
- **p22–23 [chart] Examples.** Standard PB long, PB and CPB longs, and two counter-trend shorts at resistance. They show that scalper trades sit at ordinary PAT locations.
- **p24** The bias analysis is identical to PAT. Only the chart display and the entry and management process differ.
- **p24–26 Pros and cons.** Pros: about 5 trades in a 60-minute session (versus about 5 per full session in PAT), less exposure, and less dependence on big moves. Mainly it is a lifestyle and psychology fit: a 1–2 hour session at the most volatile time (p24–25). Con: if your expectancy is not yet positive, you lose faster, and emotional carry-over between rapid trades is worse (p25–26). Advice: use the simulator first, start live at minimum size, and increase slowly (p26).
- **p26** For people with jobs, he suggests trying both scalping and daily charts for a month or two each.

## 2. Part Two: decision making and the "indecisive trader" (p27–60)

This part is psychology, not strategy, but it explains *why* the entry method is built as it is.

- **p33–45 Decision model.** Environment, then situational awareness (perception, comprehension, projection), then decision (identify and assess courses of action in a loop), then action or no action, then repeat (p33–44). Things that degrade situational awareness: fatigue, stress, memory, distraction, low knowledge or experience, attitude, preconceptions and confirmation bias, heuristics. Checklists help *if there is time* (p35–38).
  - **Analytical vs intuitive decisions** (p41–43). Long timeframes allow deliberate analysis. Short timeframes need fast pattern recognition. A mechanical system sits at the analytical end, since all the work is done at design time. PAT is intuitive within structure, and Scalper is even more intuitive (p42).
  - The final choice is driven by feeling: the most urgent threat or opportunity wins, or else the first acceptable option ("satisficing") (p43–45).
- **p47–50 Confidence compounds downward.** Facts (a swing low formed) carry full confidence. Assumptions (others have stops below it; a break will fail; the trend is strong) each carry doubt, and chained assumptions multiply it. His illustration: a 50% assumption combined with a 25% assumption gives 12.5% (p48–49). His worked chain of a swing-low stop run reversing into a long is the PB/BOF logic of ytc.md §6, framed as six stacked assumptions.
- **p50–52 Competing needs.** Subconscious fears (of loss, of missing out, of not being good enough) override analysis. Typical results are holding past the stop, or scratching at breakeven on the first tick against you (p52).
- **p54–55** PAT's routines, checklists and deliberate practice exist to build *trust*, so that price action stops triggering fear.
- **p55–56 What changes at short timeframes.** (1) Information comes too fast. (2) There are more shake-outs: a brief burst of order flow looks like a bias change, then reverts if no one follows. Hence the rule to **keep the bias on the slightly higher trading timeframe and not stare at the lower timeframe** (p56).
- **p56–59 Information overload.** With more data always arriving, the mind defers the decision (from a military paper on decision overload). Indecision means hesitation, which means missed or late entries (p59).

## 3. Part Three, ch. 7: the decisive trader (p62–65)

- **p63–64** Advanced trading means simplification, which means fewer possible actions and more decisive action. Entry becomes **semi-automated**: rules applied with discretion, never fully automated (p64).
- **p65 "Being decisive matters more than being right."** An approach that keeps finding wholesale and retail zones has a built-in edge only *if you actually enter* in wholesale zones and exit in retail zones. If you miss the entry the edge is lost. Losers are contained and winners carry the result.
  - **Research note:** this is a claim about *fill rate*. A limit-entry strategy whose winners don't fill is worthless. Our backtests must track fills honestly; see Rule 3 and §7.

## 4. Ch. 8: simplification (p66–117), the core of the book

### 4.1 Business-side simplification (p67–76)

- **p67 Market and session.** Trade one market, only at the times of greatest expected volatility (session open, close, after major news), for 1–2 hours, and never at other times. Choose the market *before* the session and remove the other one from the screen.
- **p68–70 Clean charts.** No labels, grid, indicator price markers or coloured backgrounds. Indicators are drawn in faint grey so price stays the focus (p87). Keep only indicators that are part of the strategy or that simplify reading price.
- **p70–71** Candles on the higher and trading timeframes; OHLC bars on the lower (range) timeframe because they are cleaner.
- **p72–74 Routines** must be internalised, since there is no time to consult a manual. PAT's Action Affirmation statements are shown on p73. The Scalper version (p74) changes the *Entry* block from confirming weakness and then striking, to **placing a resting limit order and keeping it while the trade premise is valid**. This is the key procedural change: from confirmation-trigger entries to resting limit orders. Management likewise becomes placing exits in advance and holding while the premise stays valid (p74).
- **p75 Tracking.** He logs only four buckets per session: **P1-WF, P2-WF, P1-CF, P2-CF**. He judges performance on a **rolling 20-session P&L**, which should almost always be positive; if not, investigate. PAT's 70/90/100 goals (winning sessions/weeks/months) remain, with "100% of months" replaced by "100% of rolling 20-session windows" (p75; p209 restates that the plan allows about 30% losing sessions). Individual trades are still reviewed after the session (p75–76).
- **p76** He moved order entry from the DOM to on-chart trading.

### 4.2 Strategy: concept (p77–79)

- **p77** (1) Use PAT analysis to set the bias for future trend. (2) Within that bias, scalp the **channel flow** from wholesale to retail.
- **p77–78 [chart]** Bias is maintained bar by bar on the trading timeframe, exactly as in PAT.
- **p79 EMA 15 + EMA 20 on the trading timeframe.** This is the *only* indicator change versus PAT (which used EMA 20 only). It is a quick visual trend read, a "90% solution": while trending, the two EMAs confirm continuation and no further assessment is needed **until they flatten or cross**. In sideways markets they are ignored and price-action trend rules (ytc.md §3) decide. If in doubt, a subjective read applies: if it looks up, it is up.

### 4.3 Channel-flow market model (p80–86)

- **p80–81** Any price movement can be drawn as flow inside a channel. The channel's direction is the *channel flow*: bullish (up-sloping), bearish (down-sloping) or neutral (sideways).
- **p81–82** If you read future flow correctly, enter in the wholesale side and exit on the retail side. Hold longer only if more movement is likely. In bullish flow the wholesale side is the lower edge; in bearish flow, the upper edge. **When flow changes direction, the wholesale side flips** (p82).
- **p83 Neutral flow.** Trade both edges, or, more conservatively, only the edge in the direction of the higher-timeframe flow.
- **p83–85 [chart]** The same chart is shown in PAT form (trend within S/R) and in channel form. The integrated model is **channel flow within an S/R framework**. Trading-timeframe trend within the higher-timeframe S/R gives the *future channel flow* (p85).
- **p85–86 Worked logic.** Price breaks higher-timeframe support and holds below it. By PAT's first principle (ytc.md §3), expect continuation to the next support area, here three nearby levels treated as one area. Take wholesale shorts in the channel *down to that area*, then reassess from the strength or weakness shown on the approach (p86). This mirrors ytc.md §5 principles 5–6.

### 4.4 Building the scalping channel (p86–89)

- **p86 Construction** (on the 1-range lower-timeframe chart):
  - Keltner(35, 4) gives the centreline and the inner lines.
  - Keltner(35, 8) gives the outer lines.
  - In NinjaTrader's version, the **centreline = SMA(close, period)** and each band = centreline ± multiplier × **SMA(High − Low, period)**. Other platforms' formulas differ. If yours does, tune the parameters until the bands match his charts.
  - **My inference (not stated in the book).** A 1-range bar has a high–low of about 1 tick (p91), so the bands sit about ±4 and ±8 ticks around a 35-bar SMA. In other words the channel is close to a fixed-width envelope in price, around an average of price-driven bars. The alternative settings support this: on 2-range bars he uses (20, 2) and (20, 4) (p144), which again gives about ±4 and ±8 ticks, and he says these give "similar readings". On *time* bars, SMA(H − L) varies, so the same construction becomes a volatility-scaled (ATR-like) envelope.
- **p87–88 Lines and zones, named in the direction of expected future flow.** Shown for a long; mirror for a short.

| Line | Construction (bullish flow) | Zone below or above it |
|---|---|---|
| 0-line | lower outer band (−8 units) | beyond it: **extreme wholesale** |
| ¼-line | lower inner band (−4) | 0 to ¼: **major wholesale** |
| ½-line | centreline (SMA) | ¼ to ½: **wholesale** |
| ¾-line | upper inner band (+4) | ½ to ¾: **retail** |
| 1-line | upper outer band (+8) | ¾ to 1: **major retail**; beyond: **extreme retail** |

  Because the inner multiplier is half the outer, the lines are evenly spaced, so the "quarter" names are literal. The glossary (p231) defines wholesale as at or before the ½-line (early, lower risk, more upside; where professionals enter without demanding confirmation) and retail as beyond it (late; where novices enter after confirmation).
- **p88 [chart]** The labels flip when the flow flips.
- **p88–89 Neutral flow.** Labels shift with price, toward whichever side offers the trade. Neutral is rarely a flat channel; it alternates between up- and down-sloping lines. Calling flow neutral is discretionary: a narrow sideways range with no breakout expected, meaning a neutral 1-minute bias.

### 4.5 Simplification part two: two setups, easy finding, easy entry (p89–106)

- **p90 Two setups.** The trading-timeframe analysis still sees PB, CPB, TST, BOF and BPB, but these only feed the *future-flow* judgement. The trade is WF (a pullback within the current flow) or CF (against the current channel direction, but in the direction of expected *future* flow, e.g. at S/R where a reversal is expected; see p117, p150). At entry, a PB, CPB or BPB inside bullish flow all look the same, and once in, the trade is pure management (p90).
- **p91 Finding setups**, a 4-step checklist:
  1. Identify the current and expected future channel flow.
  2. Identify a move against the expected future flow.
  3. Confirm the analysis does **not** point to a reversal or a deeper-than-usual pullback.
  4. Enter in the wholesale region.
- **p91–92 Why no pattern triggers.** It takes only about 2 ticks to print a reversal bar on a 1-range chart, so lower-timeframe patterns are mostly noise there. Occasionally a clean one appears and is tradable (p92, p147, ch. 10.4).
- **p92–95 Entry by area, not trigger.** Define (a) an area where you are happy to enter and (b) the level that invalidates the premise, which becomes the stop. Example: in a downtrend pullback, entry is anywhere from A to B, and beyond B the trend structure breaks (p93) **[chart]**. Range example: where a rally into resistance was stronger than usual, should the long come off the inner congestion (A) or the lower support (B)? The answer is not to be precise and to work an entry across the wholesale region (p93–94) **[chart]**.
- **p95 Scaling in.** He uses two parts instead of PAT's all-in entry ("you may choose more"). This accepts that you know the area, not the tick.
- **p95–97 Entry option 1: price-action levels.** Place limit orders where order flow is expected, at prior swing highs/lows or congestion on the left of the chart. In the example, limit longs near areas A and B fill at two prices, the stop sits below recent swing lows, and the target is just under the resistance area. P1 exits at target; P2 is held until the **first 1-range reversal bar**, and not longer because resistance was expected to hold (p96).
  - Discretion: orders go in only when the environment suits and there is no sign of reversal or deeper pullback. If in doubt, pass, or wait until the pullback meets opposing order flow (it stalls or reverses) (p97).
  - **"Confirmation increases risk."** Don't demand much reversal before entering, and **don't chase into retail zones** (p97).
  - P2 often doesn't fill. Example: P1 fills, P2 does not, for +5 ticks; the re-entry again fills only P1 (p97).
- **p98–101 Entry option 2: semi-automatic channel levels.**
  - *Fully automatic* (shown so he can reject it): always **P1 limit at the ½-line, P2 at the ¼-line, stop beyond the 0-line**. This works very well in a steady trend of normal volatility, where pullbacks never reach extreme wholesale. If they do, the environment has changed (p98) **[chart]**. Example: 6 trades. Trades 1–3 filled P1 only and all scalped well. Trade 4 filled P1 only, and "most people" would have scratched it during a long sideways grind. Trade 5 filled at the ¼-line. Trade 6 filled both parts (p98–99).
  - It **fails when swings are wider than usual**, with price moving between the 0- and 1-lines and poking into the extremes. A wide-swinging Euro trend repeatedly stopped out the ½/¼ approach (p99) **[chart]**.
  - *Semi-automatic* means adjusting to volatility. In wider-swing conditions use **P1 at ¼ and P2 at 0, with the stop beyond 0** at a level not expected to be reached. Or place orders mid-zone (between 0 and ¼, and between ¼ and ½). **Past action shows the current volatility, so set the levels from it** (p99–100).
  - He argues the channel levels usually land very close to price-action levels. It is "price action with the indicator as a crutch" (p100).
  - Discretion can veto a trade (suspected reversal) or delay it ("wait to see the pullback meet opposing flow"), which is wise *only* in fast or volatile markets (p100–101). **In normal action, waiting misses too many entries.** Steady trends often just tag the ½-line and leave (p101–102) **[chart]**.
  - **If in doubt about the channel levels, use price-action levels**, especially in very volatile markets (p102).
- **p102–103 Counter-flow entries.**
  - These are usually placed at price-action levels, especially for **breakout failures**: watch the post-breakout stall and enter on a break of the stall region. This is one case where 1-range patterns are obvious and tradable (p102).
  - With semi-automatic CF entries, **take them only at S/R and demand deeper wholesale**: usually the major-wholesale zone (0 to ¼). P1 goes as near the 0-line as he expects price to reach; **P2 near the ¼-line *as price moves in his favour*** (scaling into strength). A CF entry up at the ½-line is allowed but rare (p102).
  - The reason: deeper entry gives a better chance of at least a small move, and a better chance to **scratch at or near breakeven** if wrong (p103).
- **p103 "Trust the channel."** If future flow was read correctly, price should *not* reach the stop beyond the channel. **A stop-out means the bias was wrong** (unless management was poor). It is an analysis failure, not an entry failure.
- **p104** Deliberate practice: review many sessions of channel charts to confirm that a correct bias plus semi-automatic entries gives good profit and limits losses when the bias is wrong.
- **p105** Three "trust the channel" chart pages, repeated on p228 **[chart]**.
- **p106 Reward-to-risk.** The channel lines give a visual R:R scale, so he does not count ticks. **He accepts WF entries at slightly below 1:1 R:R** and relies on long-run statistics over the rolling 20 sessions to show whether stops are too big relative to wins.
- **p106 Position risk.** Total risk for *both parts combined* is at most **1% of equity**.

### 4.6 Trade management and exit (p107–111)

- **p107 General.** Often only P1 fills, so manage that single part.
  - **A target is always set**, but it is **initially parked beyond the 1-line** (deep in extreme retail) until he has a feel for the move.
  - If the remaining edge is doubtful, he pulls the target in to take whatever profit is available, sometimes working a better exit price (PAT-style).
  - If price behaves as expected, he moves the target to a **price-action level**, usually a 1-minute (trading-timeframe) swing high/low or S/R.
  - **Windfall rule.** If price moves with unexpected speed that he doesn't think will last, he trails the stop tight and exits on the **first 1-range reversal** (p107; second trade of Fig 8.38, p105 **[chart]**).
  - **Runner.** Trail a stop behind price, but only when PAT analysis favours a trending move.
  - Management is active: any decision can change bar by bar.
- **p108 Example [chart].** One part is long at the ½-line (A), with a resting P2 at the ¼-line (B) in case price retests the swing lows. **The stop is 2 ticks below the recent swing low** (C). The target is parked above retail (D), probably to be pulled down to just under recent highs (E).
- **p108 Single-position scale-out** (all-in, scale-out of one part) is offered as something to research. He does not do it.
- **p109–110 Two-part positions.** When P1 goes into drawdown and P2 fills, there are two options:
  1. Manage each part separately.
  2. **Recovery.** If the extended pullback raises *some* doubt (not enough to scratch both), **work P1 out near breakeven** and keep P2, which is now slightly in profit. Then either work a better exit for P2 or move its stop to breakeven quickly once price proves the idea (p109). Recovery doesn't always win: sometimes both stop out, or P1 recovers and P2 stops. The point is to cut exposure and shrink the loss (p110) **[chart, Fig 8.42]**.
- **p110 Chasing P2.** If P1 filled near the ¼-line and price never dipped further, P2 can be added at a *worse* price than P1 if he still expects profit. **He never chases past the ½-line into retail** (p110–111) **[chart]**.
- **p111 People, not price.** Ask what the longs and the shorts are feeling. Find who is trapped and join the order flow that springs the trap (ytc.md §6).

### 4.7 Summary and higher-timeframe note (p112–113)

- **p112–113** Summary of the above. Then a key note for us: **traders on PAT timeframes can also try channel flow with scale-in entries**, especially if they struggle to time lower-timeframe pattern triggers. The suggested parameters are along the lines of **2-range bars with Keltner (20, 2) and (20, 4)**, to be tested (p113).

### 4.8 Worked examples (p114–117)

- **p114–116 Bearish flow after a support break.** Trade 1: P1 limit at the ½-line fills; this lined up with prior lower-timeframe swing highs and with expected resistance. P2 at the ¼-line (near the first post-break pullback high) does not fill. The stop trails (red lines **[chart]**). The target goes first to just above lower support, then is tightened when price stalls at a round number: **+7 ticks**. Trade 2: P1 at the ½-line, near recent congestion, fills; P2 at the ¼-line does not. The target is pushed lower to test how far price could get into support, then pulled back to exit when price stalled in the top of the support area: **+8** (p115–116). Lesson: semi-automatic levels often coincide with price-action levels (p115).
- **p116–117 Expected rally from support turns into a range.** Even with an inaccurate bias, the channel still paid. A CF long on a retest of the lows: P1 just above the ¼-line, just above the prior swing low. He would normally prefer nearer the 0-line, but did not feel price would go that far. P2 rested at the 0-line and did not fill; exit at the top of the surge area for +4. Re-entry: P1 just below the ½-line (unusually high for CF; he felt price would "explode"), P2 at the ¼-line just above the prior swing low. The P1 target missed by 1 tick. P2 then filled but the move was slow, so **he scratched P1 at breakeven (recovery)**. Price then rallied and P2 exited on a stall: 0 and +6 (p117).

## 5. Ch. 9: additional considerations (p118–156)

### 5.1 Market internals: NYSE Tick (p119–130)

- **p119** Breadth measures (TICK, cumulative tick, A/D line, TRIN, McClellan, new highs/lows) give market-wide confirmation or non-confirmation of the single instrument. He uses only the NYSE TICK.
- **p119–121 Standard reading.** TICK = number of NYSE stocks on an uptick minus the number on a downtick. Readings consistently above or below zero are bullish or bearish. Typical ranges: in a range, about ±600; in an uptrend, highs up to +1000 with lows near 0; in a downtrend, the mirror image. **Readings of ±1000 or more are extreme and unsustainable**, so expect a pause or pullback. Divergence against price warns of reversal.
- **p121–124 His display.** TICK on a **150-range chart** with Keltner (20, 2) and (20, 4) and a zero line, referenced to the 1-range price chart rather than to time. It shows reversals within a minute better than a 1-minute TICK chart (p123–124) **[chart]**. The channel takes about 10 minutes to form after the open (p124).
- **p124–127 How he uses it.** As **confirmation only, never as a signal**.
  - Sentiment: the sign of the TICK plus the **slope of the TICK channel** (p125–126).
  - Overbought/oversold by regime: in a range, OB = upper band and OS = lower band. In an uptrend, OB = upper band and **OS = below the centreline**. In a downtrend, OB = above the centreline and OS = lower band. Readings beyond the outer lines are extremes (p126).
  - **A TICK reversal in the OB/OS band while price is in a setup area is "a great confirmation"** (p127) **[chart]**.
  - Divergences are easier to see in the channel display (p128–129).
- **p129–130 Example [chart].** Price tests opening-range-high support twice (B, C). A bullish TICK divergence between B and C supports a very early wholesale long after C.

### 5.2 Gap opens (p131–135)

- **p131** He does not like "fade the gap" as a rule, because of gap-and-run days. Instead he reads each open on its merits.
- **p131 Method.** The **opening range is the first 1-minute candle** (shorter than the usual 5–15 min). Watch how price interacts with its edges for strength or weakness. This is opening-range-breakout logic used only to set the *initial* bias, which bar-by-bar analysis can then change.
- **p131–133 Example 1 (gap up).** Price presses the range high for 44 seconds, breaks out, but fails to extend, which shows bullish weakness. That gives a short as price breaks down (CF), or for slower traders a WF short on the first pullback a few minutes later (p132–133) **[chart]**.
- **p133–135 Example 2 (harder).** The breakout extends easily before reversing, so the failure is hard to read. Limit longs at C/D lose immediately. A 1-2-3 pattern long at F (¼-line) appears, then another upside break at G. TICK stayed positive throughout (p134) **[chart]**. Later the session settles into a range with a bullish tilt that pays *if* you use deeper entries (¼- and 0-lines) (p135).
- **p135 Lesson.** Don't rush the first read after a gap. Take a clear signal, otherwise wait; a clear bias appeared after about 5 and about 7 minutes in the two examples. Whipsaws punish rushed trades "more often than not".

### 5.3 Quiet markets (p136–139)

- **p136 Options.** Walk away, set a range-breakout alert, or take small consistent scalps.
- **p136–137 Slow grinding uptrend.** Enter around the ½-line and exit around the ¾- or 1-line. **The hard part is holding**: one trade took 11 minutes to reach the ¾-line for +4. He admits he often scratches early for "no follow-through", and price then moves after he exits (p137).
- **p137–139 Narrow range after news.** Price stayed inside the prior range of about 15 ticks. He scalped from the range edges, which matched the ¼- and 0-lines: three two-part sequences, 2 winners and 1 loser, and the loser led into a downside break and a good bearish channel (p138–139). **You must trust the bias enough to hold through 5+ minutes of slow movement. Expect to underperform in quiet markets** (p139).

### 5.4 Highly volatile action (p140–143)

- **p140–141 After news.** Example: +34 pips in 2 minutes. Either stand aside or **use breakout (stop) orders**, because the first one or two extensions often don't pull back anywhere near wholesale. Slippage is normal. These are high-risk, high-reward trades. He usually stands aside unless he already has session profits, in which case he risks a small part (p140) **[chart]**.
- **p141–143 Fear/high-volatility regime.** In March 2011 (Libya, Japan earthquake), price swung beyond the channel on both sides, and semi-automatic entries would quickly hit the daily loss limit. Options (p143):
  - Stand aside and observe (use the simulator).
  - Widen the semi-automatic levels to the ¼- or 0-line, **or better, use price-action levels**.
  - Switch to a slower lower timeframe; the 20-tick chart gave clean reversal patterns that day.

  The key is to adapt tactics to the environment (p143).

### 5.5 Alternate lower timeframes (p144–156)

- **p144–145 2-range bars** with Keltner (20, 2) and (20, 4) give a similar picture to 1-range at lower speed.
- **p146–148 20-tick chart** (IB data; tune the tick count to about one bar per 10 seconds in normal active trading), same (20, 2) and (20, 4) channel. He moved to range bars because tick counts differ by data vendor (p146). The 20-tick chart is also good for PAT pattern triggers, but **if you rely on pattern triggers alone you miss more trades than you get**. Take a pattern when it sets up at S/R and traps traders against your bias (p147–148) **[chart]**.
- **p148–153 EMA 15/20 template** (no channel):
  - Flow = the cross direction (EMA15 above EMA20 means up). The wholesale side of the EMA pair is the entry zone. WF and CF are as before (p148).
  - It worked very well on 20-tick and was his main lower timeframe for a while (p149).
  - Example (p150) **[chart]**: WF shorts below the EMAs at A (good) and B (scratch or loss). Shorts at C/D with P1 *at the EMA lines*. At support (E), with price slowing into it, a **CF long is sought as far below the EMAs as possible**. A WF short at F is *skipped* because strength is coming off support. The next entry is a CF long at G, and **both EMAs had turned up before G**, an early sign of flow change.
  - **Scale-in without channel lines.** P1 at the EMA line (he notes price often just touches it and carries on). **P2 at about ½ to ⅔ of the typical historical extension beyond the EMA**, provided PAT analysis shows a clear bias and no reason to expect a deeper pullback (p150–151).
  - CF version: partial entry near the extreme of normal extension beyond the EMA, more as price moves your way, and **the full position on well before price reaches the EMA**. "Confirmation = risk" (p151).
  - He says discretionary scaling based on the expected depth of pullbacks and extensions is *better* than blind channel lines. The channel is a beginner's crutch, because traders without trust put limits too deep, **miss winners and catch every loser** (p151).
  - p152–153 **[chart]**: WF zones, and sideways or unclear flow (stand aside or trade cautiously). He repeats that it is not a simple EMA-cross system; trading every pullback against the cross direction gives average results (p153).
- **p154 Two lower-timeframe charts** (1-range plus 20-tick) can complement each other, but watch for information overload.
- **p154–156 Time charts (10-second).** He first used PAT triggers on a 10-second chart inside 1-minute PB/CPB/TST/BOF/BPB areas. It worked but was too fast and he missed trades. **Channels on time bars are unreliable**, because illiquid or sideways periods flatten the channel. The EMA template is better on time bars but still worse than tick or range bars (p154). For time bars he recommends standard PAT pattern triggers and accepting some missed or late entries (p155–156) **[chart]**.

## 6. Ch. 10: trade examples (p157–218)

General notes (p158): there is no full PAT analysis write-up. Watch the 1-range price movement *into* the entry. **Entries are almost always limit orders, with no confirmation needed if the bias is right, especially with S/R or a price-action level behind the entry** (p158).

### 6.1 E-mini Russell (TF), 24 Mar 2011, first hour after the open (p159–195)

- **Plan (p159):** trade only the first hour. News was an hour before; one minor release at the hour mark.
- **Open (p159–161).** A gap up opens just short of gap-closure resistance. Support levels and key levels are copied from the 5-minute chart. The pre-session channel was bullish, but the **open can change sentiment, so he waits for the opening range** (p160). He passed on tempting early shorts at A/B: they would have won, but passing is the lower-risk default until the bias is clear (p160–161). **Bearish bias established**: rallies inside the opening range struggled, the break below it was rapid and held, and TICK trended down to negative readings. He now seeks wholesale shorts toward the next support (p161).
- **Trade log** (ticks, before commissions; WF unless noted):

| # | Entry and context | Management and result |
|---|---|---|
| 1 | P1 at the ½-line (= opening-range low, now resistance), P2 at the ¼-line just below the last swing high | +6 / +6 (p162–163) |
| 2 | Double bottom after T1 (failed to make new lows), so **entries moved deeper to the ¼- and 0-lines** | P1 only; +4 (p164–165) |
| 3 | New lows restore confidence. P1 at the ½-line next to a prior stall; P2 at the ¼-line; stop above the trade-2 swing high | Both filled. Stall plus a belatedly noticed TICK divergence raised fear of a "spring", so **P1 worked out at breakeven (recovery)**; P2 covered at the next stall near lows: 0 / +7 (p166–168). A missed opportunity is shown (p168) **[chart]** |
| 4 | **First pullback after a rapid drop: a cautious entry, to be managed aggressively.** Taken because selling pressure was clear. P1 at the ½-line; P2 at the ¼-line did not fill. A stale S/R level was removed because the 5-minute chart no longer showed it | +4 (p169–170) |
| 5 | Continuation; two parts because the pullback was deeper | P1 exit just above prior lows; P2 given room, exited after an extended stall: +2 / +8 (p171–172) |
| 6 | Uncomfortable at once. One part only, raised to the ¼-line; **no P2 because of bearish weakness after trades 4–5 and a bullish TICK divergence** | +1 scratch (p173–174) |
| 7 | New lows in price and TICK, but the 1-minute chart "felt" like a bottom, so the bias was tentative | −4 / +4. In hindsight a CF long off the 0-line at support was better, since TICK did not make session lows (p175–177) |
| 8 | Trend now officially up, but resistance above is expected to hold. WF long toward it. An earlier limit missed by 1–2 ticks. **P1 at the ¼-line, no P2** ("don't want lower prices") | Exited at −5: confident support would hold but **not willing to sit in drawdown**, TICK making lower lows, "didn't like the feel" (p177–179) |
| — | **After two scratches and a loss: wait for a clearer bias** (or a CF long on a TICK divergence at support, which never came) | (p179) |
| 9 | Support held and price rallied to resistance, then pulled back. WF long for a second push; target just under resistance | P2 at the ¼-line not filled. Target pulled higher in case of a break; exited when price held the level: +8 (p180–181) |
| 10 | **CF short**: stall at resistance plus a bearish TICK divergence | +7 (p182–183) |
| 11 | Resistance held and price broke below the trade-9 lows. WF short off the trade-10 stall zone toward support | +7 (p184–185). A missed opportunity is shown **[chart]** |
| 12 | Price cut through support to the next level and pulled back. **Caution: pullbacks after large drops can run deeper than expected.** Entry zone = prior sideways area under the broken support (now resistance) | Price did not fall far enough to make longs feel trapped, and few joined the short. "I'm the one trapped", so he worked an exit: +2 (p186–188) |
| 13 | CF short: price slowing into resistance, but **no TICK divergence** | Stopped out at −5 on a breakout. Same price action as trade 10; **the internals were the difference** (p189–190) |
| 14 | WF long (BPB). A CF short (BOF) earlier may have been better; let missed trades go | Felt uncomfortable, so P1 scratched (recovery). P2 badly handled: stop dragged to 1 tick under price, with slippage: 0 / +3 (p191–192) |
| 15 | Support holds, another BPB long | +5 (p193–194) |

- **Session totals (p195):** P1-WF +30 ticks over 13 commissions; P2-WF +28 over 5; P1-CF +2 over 2; no P2-CF. One of his best sessions, and **no runner was held**.
- **p195 Distribution of results.** Most trades are small wins or breakeven, plus some small losses, with **occasional large outliers that make the session**. The same applies to sessions: keep losing sessions small and let the big sessions drive the equity curve.

### 6.2 Euro (6E), 28 Mar 2011, one hour after US news (p196–208)

- 6E has smaller ranges than TF: trade TF for more action, 6E for less (p196). Resistance and support come from the 5-minute chart. The 1-range chart shows bearish flow, accepted *tentatively*, with the expectation of continuation to support (p196–197).

| # | Entry | Result |
|---|---|---|
| 1 | Post-news drop, then a slow grind back up. P1 at the ½-line; P2 at the ¼-line (= pre-news swing high), watched closely because a move above it is a concern | P1 only (P2 missed by 2 ticks); scalp at potential support: +3 (p198–199) |
| 2 | Grinding higher but struggling below the pre-news high | **Should have scratched P1 during the stall** (noted on the chart at the time). He held on a "feeling", and both parts hit the stop: −6 / −4. He judges it bad management, with bearish expectations blinding him (p200–201) |
| 3 | Trend turns up as the pre-news high breaks; flow now bullish | P1 only; scalped at the highs expecting a stall: +5. "Scalping isn't about catching every runner" (p202–203) |
| 4 | Pullback after reaching resistance | **Scratched for small profit because of extended time in drawdown. "When in doubt, be out" to reassess objectively**: +1 / +5 (p204–205) |
| 5 | Re-entry after reassessing while flat; cautious, P1 only | Slow, but mostly in profit ("slow action is easier to hold when in profit"); exit just under resistance: +5. Price rallied hard after the exit (p206–208) |

- **Totals (p208):** P1-WF +8 over 5 commissions; P2-WF +1 over 2. "Grinding back" to a small profit is a typical session. The session was only back in the black after trade 4 (p208).

### 6.3 A sequence of losses (6E, 29 Mar 2011; p209–213)

- **Trade 1 (p209–210).** After 40 minutes of downtrend and two good shorts, a larger pullback. Entries were scaled at the ¼- and 0-lines, *chosen from price-action features*: P1 expecting swing high C to hold, P2 in case C failed, stop above the higher swing high B. The pullback kept grinding up and stopped him out. **He still likes the trade.**
- **Trade 2 (p211–212).** He expected the pullback to hold above support (the prior low), so a CF long early in the hoped-for rally. P1 at the 0-line; P2 5 ticks above the session low; stop under the session low, later raised under a stall. Stopped out. **The entries were fine; the management was "exceptionally poor"**: both parts had many chances to exit near breakeven. **The swings down into P1 and P2 were strong, which should have raised serious doubt, and he should have scratched when the rally failed to appear.** "I almost never hold a trade this long" (p212).
- **p212–213 On losses.** Some losses are fine trades; some are errors. Individual trades and sessions don't matter if risk is contained. If the session stop-loss is hit, walk away; otherwise run the reset routine (confirm flat, clear mind, accept, forget, focus) (p213). Later trades recovered the session (p213) **[chart]**.

### 6.4 Pattern-based CF entry (6E, 14 Mar 2011; p214–218)

- **Context (p214–215).** A rangebound day between higher-timeframe resistance A and support B. Price breaks an *inner* resistance C, which leads straight into higher resistance A. **Layered S/R is a trap**: breakout longs above C are low probability, because higher-timeframe and sharper traders sell near A. It is a BOF of C and a TST of A at the same time (ytc.md §6).
- **Entry (p215).** After the breakout, price stalls for about 40 seconds (supply appearing), pokes 1 tick higher, and stops dead for 10–15 seconds. A **sell-stop for both parts just below the pattern** (an upthrust trigger) is placed. The logic: trapped longs exit, and reversal shorts join.
- **Stop and targets (p216).** Stop above the pattern. T1 = the first likely stall area; T2 = the next trading- and higher-timeframe support. If stopped out, the premise isn't necessarily dead, since the resistance zone extends higher and a second attempt could be traded.
- **Timing caution (p216).** Entry was 1 minute before the hour, when 5/15/30/60-minute candles close and longer-timeframe traders act. Check that you are not shorting just as those charts give *long* signals. Here the 5-minute candle was bullish but sitting into resistance, and the 15/30/60-minute charts gave no long reason. He usually watches only the 5-minute chart and builds the higher candles in his head by adding 5-minute candles.
- **Management (p216–217).** T1 hit for +5. **P2's stop moved to breakeven +2 ticks** (if hit, reassess and maybe re-enter on a second test). Then he **trailed the stop above stall or turn areas** to the target: +16. Total +21 (p217).
- **p217–218 [chart]** On the 1-minute chart it captured the whole range swing, as PAT intends. On the 20-tick chart the upthrust is clear, and **a weaker second push that nearly stopped P2 actually gave confidence to hold**, because the weakness confirmed the idea (p218).

## 7. Ch. 11–12: implementation and conclusion (p219–231)

- **p221–222 Stage 1, post-session review.** Review 20 sessions of charts (historical range data speeds this up) for the fixed windows: one hour after the UK open, UK/EU news, the US open, US news, and the TF open. The goal is *belief*: that with a correct bias, the channel offers real opportunity. Keep a folder of annotated hindsight charts (p221–222) **[chart]**.
- **p223 Stage 2, simulation.** At least 20 real-time sim sessions, with money management and drawdown limits (session/week/month; stop if hit). Trade-Record-Review-Improve. One session per day. Goals: see setups at the right edge, gain confidence placing **limit orders ahead of time**, and manage positions. **Move on only after being profitable after costs and staying profitable for 5 more sessions.**
- **p223–224 Stage 3, live at minimum size** (a two-part position). Same process; drop back to the simulator if limits are breached.
- **p224 Stage 4, size increases.** Only if the last 20 sessions are profitable and position risk stays at or below 1%. Monitor the first 20 sessions after each increase.
- **p226–229 Conclusion.** No room for complexity. Scalping needs less analysis and more feel, decisiveness and simplicity. The summary from p112 is restated. "Simple, but never easy."
- **p231 Glossary.** Defines channel flow (the current direction of the channel at the right edge), future channel flow (the bias from 1-minute PAT analysis), retail (beyond the ½-line) and wholesale (at or before the ½-line).

---

## 8. Mapping to hourly-to-daily swing trading

Proposed timeframe stack (same 5× higher-to-trading ratio as the book; the lower timeframe is the finest data we can get for this):

| Scalper role | Scalper | Our swing mapping | Notes |
|---|---|---|---|
| Higher timeframe (S/R framework) | 5 min | **Weekly** | Weekly S/R and room to the next barrier (ytc.md §2) |
| Trading timeframe (bias, structure, EMA 15/20) | 1 min | **Daily** | PAT bias as in ytc.md §3–5 |
| Lower timeframe (channel, limit levels, management) | 1-range | **1h** (or 15m) | NSE has about 6–7 1h bars per day and 25 15m bars. Yahoo history is short (about 2 years of 1h, about 60 days of 15m), so serious lower-timeframe tests need Fyers data |

Concept by concept:

1. **Bias stays on the trading timeframe; the lower timeframe is for execution only (p56, p77, p85).** This translates directly. Daily structure and weekly S/R decide direction, and 1h is never allowed to flip the bias. Our earlier finding that structure-state filters alone show little edge is a warning: the book's whole edge rests on "correct future flow", which our tests so far have not captured well. The channel adds execution precision, not direction.
2. **EMA 15/20 as a trend proxy (p79).** Translates directly to daily: EMA15 > EMA20 and both rising means up; flat or crossed means fall back to swing structure. It is cheap to test against our swing-structure state.
3. **Scalping channel (p86–89, p113, p144).** On time bars the book's construction becomes SMA(close, N) ± k × SMA(H−L, N). Options:
   - (a) A channel on **1h bars**: Keltner(20, 2/4) or (35, 4/8), with 20 hours ≈ 3 sessions and 35 hours ≈ 5.5 sessions.
   - (b) A channel on **daily bars**, Keltner(20, 2/4), as a coarser version. Here 2 × the average daily range is large, so the ½-line (SMA20) is the natural first limit.

   **Caveat (p154):** the author found time-bar channels unreliable because quiet periods flatten them. NSE 1h bars add the overnight gap and the opening-hour spike, so the 1h channel will be distorted at each open. Possible fixes: build the channel from intraday bars excluding the gap (each bar's H−L only), or use 15m bars. Range bars can't be built honestly from 1h OHLC.
4. **Wholesale and retail zones (p87, p231).** These translate as a normalised position-in-channel variable: z = (price − SMA) / avgRange, with the ½-line at z = 0, ¼ at −2 and 0 at −4 for the (20, 2/4) version. This lets us measure *where in the channel* our existing buy-stop entries fill. My hypothesis: our thin edge comes partly from entering at "retail" prices after the confirmation bar.
5. **Limit entries in the zone instead of trigger entries (p91–95, p97, p151).** This is the biggest testable idea for us, and it directly contradicts our current buy-stop-above-prior-high trigger. The book claims confirmation costs price ("confirmation = risk"). On daily bars a limit buy at the daily/1h ½-line or ¼-line during a pullback in a daily uptrend enters *before* the turn. The risk is **adverse selection**: P2 fills mostly on losers (p97, p151). We must measure win rate and R conditional on fill, plus missed-winner rates.
6. **Two-part scale-in (p95, p98–99).** Translates: P1 at the ½-line, P2 at the ¼-line, risk ≤1% across both parts combined (p106). Sizing should be per *position*, so a P2 fill raises exposure only to the planned maximum.
7. **Volatility-adaptive depth (p99–100, p143, p164).** Translates: measure each stock's recent pullback penetration in channel units (e.g. the median of the last 5 pullback lows' z). If pullbacks routinely reach the ¼-line, shift the orders one line deeper. This becomes a per-stock, per-regime rule.
8. **Stops (p96, p108, p166, p210).** The book's stops are *structural*: a couple of ticks beyond the recent swing (often the trading-timeframe swing that defines the trend) or beyond the 0-line. They are **not** ultra-tight lower-timeframe stops. For us, the daily pullback low (or the 0-line) minus a small buffer is the worst-case stop, and the 1h chart is used to *scratch early* rather than to tighten the hard stop. A tighter variant to test: the stop under the most recent 1h swing low inside the pullback. Expect lower win rate but better R; the book gives no support for this.
9. **Scratching and recovery (p109–110, p117, p167, p179, p188, p201, p205, p212).** This is the richest source for management rules. Signals to scratch that the book uses repeatedly:
   - (a) **time in drawdown** (p205);
   - (b) a **stall without follow-through**, where price doesn't go far enough to trap the other side (p188);
   - (c) a **strong move against the entry** into P1/P2 (p212);
   - (d) a **two-part recovery**: exit P1 at breakeven once P2 has filled (p109).

   On daily or 1h these translate to N-bar no-progress exits, an exit on a 1h close below the 1h swing low after entry, and a breakeven exit on P1 once P2 has filled. **Counterpoint (p137, p139):** in slow grinding trends, early scratching costs him winners. Daily NSE trends often grind, so scratch thresholds must be tested, not assumed.
10. **Targets and trailing (p107, p216–217).** In the book, T1 is a *trading-timeframe* swing high or S/R. Our tests show T1-at-prior-swing-high loses on daily bars, and the Scalper only half-endorses it: the target is first parked beyond the 1-line and pulled in only on evidence. The more transferable parts are:
    - (a) the **windfall rule**: a fast spike beyond the 1-line means trail tight and exit on the first lower-timeframe reversal bar;
    - (b) **trail above or below stall areas** (lower-timeframe swing points);
    - (c) **after T1 on P1, move P2's stop to breakeven plus a buffer** and trail.

    On daily these become a 1h trailing stop under 1h swing lows, and a "first 1h bar that breaks the prior 1h low after a close beyond the upper outer band" exit.
11. **WF vs CF split (p90, p102, p150).** Translates. WF = buy pullbacks in daily up-flow. CF = buy at weekly support against a daily down-flow when a reversal is expected, but only at higher-timeframe S/R and deeper in the channel (0 to ¼), with the second part added *as price moves in favour*. Our BOF tests showed little edge. The CF rules add a **location and depth requirement** plus breadth confirmation, which we have not yet tested.
12. **Layered S/R trap (p215).** Translates well to daily and weekly: a daily breakout of an inner level that runs straight into weekly resistance is a fade candidate (and a filter against with-trend breakout entries). This refines our failed BOF tests by adding the condition "the next weekly barrier is close".
13. **Breadth confirmation (p119–129, p190).** NYSE TICK has no direct NSE equivalent at our frequency. The daily analogue is NIFTY 500 advance/decline, % of constituents above their 20-day MA, or the NIFTY/sector index's own channel position. The book's specific use (a reversal from the OB/OS band, or divergence at S/R, as confirmation for CF trades) is testable on daily data. Trades 10 vs 13 (p190) are the motivating example.
14. **Opening range and gaps (p131–135, p160–161).** Translates to the 1h layer. On a gap day, don't place or trust lower-timeframe entries until the first-hour range has formed and price has reacted to an edge. Concretely: suppress 1h limit fills in the first hour after a gap of more than x × ATR, or use an opening-range-failure trade. For daily-only tests, gaps through limit levels fill at the open (a better price) and gaps through stops fill at the open (worse than the stop). Both must be modelled.
15. **Fast markets: switch to breakout entries (p140).** This translates and it reconciles with our finding. When the trend is strong enough that pullbacks don't reach the wholesale zone, a **stop entry** is the only way in. Proposed hybrid: a limit at the ½-line, and if the pullback stays shallower (the low never reaches the ½-line) and price resumes, a buy-stop above the prior daily high. This tests whether our buy-stop edge is really a "strong-trend, shallow-pullback" edge.
16. **First pullback after a rapid move (p169, p186).** Translates: after an extension of more than k ATR, expect a deeper first pullback. Place limits deeper and manage tighter.
17. **Cool-down after failures (p179, p164).** Translates as a per-stock rule: after 2 scratches or losses in the same stock and direction, skip until a new swing confirms the bias. After a failed follow-through (a double bottom or top), move the next entry one line deeper.
18. **Higher-timeframe candle-close timing (p216).** For 1h entries, the daily close (15:30) and the weekly close (Friday) are the decision points of the higher-timeframe traders. Don't enter on 1h against a daily candle that is about to close as a strong signal bar the other way. This is approximable.
19. **Session windows (p67, p221).** This doesn't translate as "trade 1–2 hours a day". The equivalent for us is to restrict **1h entry fills to set hours** (e.g. avoid the first 15–60 minutes, or prefer the last hour). This is testable as a time-of-day filter on fills.
20. **Stats by bucket (p75).** Translates as a reporting convention: report P1/P2 × WF/CF separately, plus a rolling 20-trade or 20-period expectancy. The book also accepts WF trades with R:R below 1 (p106), so judge by expectancy, not by per-trade R:R.

**What does not translate:**
- Tick-level execution on 1-range bars, and the author's claim that range bars make the channel width fixed in ticks (my inference). Our lower timeframe is time-based, which he found worse (p154).
- NYSE TICK at 150-range resolution, and real-time confirmation of intrabar sentiment.
- Holding times of minutes, so there is no overnight risk in the book. Ours carries gaps.
- "Work the exit" at a better price inside the bar, and a feel for a stall over 10–40 seconds (p215).
- Commission-per-tick economics. Our 0.3% round-trip cost is large relative to a 1h-channel swing, so the scalp-to-retail exit (½ → ¾/1-line) is probably too small on 1h for NSE costs. The channel is likely more useful for **entry pricing and scratching** than for exits.

---

## 9. Testable rules

Legend: **M** = mechanical as stated; **A** = needs an approximation of discretion. Data: D = daily, W = weekly, H = 1h, Q = 15m. Baseline = our matched random-entry baseline (same stock, same regime, same holding rule) unless stated.

1. **Daily EMA 15/20 trend state.** Up if EMA15 > EMA20 and both have a positive 3-bar slope; down is the mirror; otherwise no trend. (p79) — D — **M**. Test: compare forward-R distributions of our PB entries filtered by this state vs by swing-structure state vs unfiltered.
2. **Channel definition and flow.** Keltner on H: mid = SMA(close, 20), unit u = SMA(H−L, 20), lines at mid ± 2u (inner) and ± 4u (outer). Flow = sign of the 5-bar slope of mid, with neutral if |slope| < ε·u. Variants: (35, 4/8) on H, (20, 2/4) on D. (p86–89, p113, p144) — H/D — **M**. Test: this is a building block. Check that WF pullback lows cluster at the ¼/½ lines more than for random times.
3. **Semi-automatic WF limit entry (core rule).** With daily bias up (Rule 1 or structure) and channel flow up, rest a limit buy P1 at the ½-line and P2 at the ¼-line. Stop = 0-line − 0.25u (or the pullback swing low − buffer, whichever is further). Cancel if the daily bias flips or price makes a new swing high first. (p98–99, p108) — D + H — **M**. Test: compare with (a) the random baseline, (b) our buy-stop-above-prior-high entry on the same setups. Report fill rate, missed-winner rate, R per filled trade and R per *setup* (unfilled counted as 0), all net of 0.3% costs.
4. **Volatility-adaptive depth.** Let d = the median channel depth (in u) reached by the last 5 pullbacks in this stock. If d is beyond the ¼-line, shift P1/P2 to ¼/0 with the stop at 0 − 1u. Optionally use mid-zone levels. (p99–100, p143) — H (or D) — **M**. Test: Rule 3 vs Rule 4 on the same signals. Look for a better stop-out rate in high-volatility regimes without a large fill-rate loss.
5. **Price-action limit levels.** P1 limit at the nearest prior swing high or congestion top that the pullback is re-testing (broken resistance, now support). P2 at the next lower swing or congestion. Stop 2 ticks (≈0.1×ATR) under the most recent swing low. (p95–96, p108, p210) — D (levels) + H (fills) — **M** with our 2-bar swing definition (ytc.md §1). Test: compare with Rule 3 levels. The author prefers this in volatile markets (p102, p143), so also test a regime split.
6. **EMA-template scale-in (no channel).** P1 limit at the EMA15/20 zone. P2 at EMA − f × E, where E = the median of past pullback excursions beyond the EMA and f ∈ {0.5, 0.67}. (p150–151) — D or H — **M**. Test: compare with Rule 3. It is the simplest daily-only version of the Scalper idea.
7. **No-chase rule.** Never fill a WF long above the ½-line. P2 may be added above P1's price only if it is still at or below the ½-line. (p97, p110) — H — **M**. Test: within our existing buy-stop trades, split by z at fill (≤ 0 vs > 0). Does R differ? This is a cheap diagnostic of whether "retail" fills explain our thin edge.
8. **Hybrid limit/stop for shallow pullbacks.** If the pullback low stays above the ½-line and price closes back above the prior daily high, use a buy-stop above that high instead (the fast-market rule). (p140) — D + H — **M**. Test: does the buy-stop edge concentrate in shallow-pullback, strong-trend cases? Compare against random entries in the same shallow-pullback subset.
9. **CF entry at higher-timeframe S/R only.** Long against the daily down-flow only within 0.5×ATR of weekly support, only in the 0-to-¼ zone. P1 at the 0-line, P2 at the ¼-line *after* price moves up through it. Stop beyond the weekly level + buffer. (p102, p117, p150–151) — W + D + H — **M**. Test: compare with our earlier BOF results and with random longs at the same support levels.
10. **Layered-S/R breakout fade.** A daily close above a 20-day high, when the nearest weekly resistance is within 1×ATR above, followed by a stall (k ≤ 3 inside or narrow bars), gives a sell-stop below the stall low. Stop above the stall high. T1 = first stall area below; T2 = the next support. (p215–216) — W + D (+ H for the stall) — **M/A** (A for "stall"). Test: split the same breakouts by "room to weekly resistance". Is the fade profitable, and are with-trend breakout buys worse, when room is small?
11. **Breadth confirmation filter.** For CF longs at support: require a breadth reversal from its oversold band (% of NIFTY 500 above 20-DMA, in a Keltner(20, 2/4) channel; oversold = lower band in a range, below mid in an uptrend), or a breadth higher low while the stock or index makes a lower low. (p124–129, p190) — D (constituent data) — **M**. Test: CF trades with vs without confirmation, and random longs at support with vs without.
12. **Windfall exit.** If after entry an H bar closes beyond the upper outer band (1-line) within m bars of entry, trail the stop to the low of the prior H bar and exit on the first H bar that breaks a prior bar's low. (p107) — H — **M**. Test: apply to our existing trades vs our current trailing exit. Expect captured spikes, at the cost of fewer runners.
13. **Runner trail on stall points.** After P1's target (or +1R), move P2's stop to breakeven + buffer (≈0.1×ATR + costs) and trail it under each new confirmed H (or D) swing low. (p216–217, p107) — H/D — **M**. Test: compare with our best trailing exit and with a fixed time exit.
14. **Two-part recovery.** If P2 fills (price reached the ¼-line) and price later trades back to P1's entry before the stop, exit P1 at breakeven, keep P2 with its original stop, and move P2's stop to breakeven once price exceeds P1's entry by 0.5u. (p109–110, p117, p167) — H — **M**. Test: compare with holding both parts to the common stop and target. Look at loss reduction vs forgone profit.
15. **Time-in-drawdown scratch.** If, N bars after the fill, the trade has never reached +0.5R and the close is below entry, exit at the close. Grid N ∈ {3, 5, 8} H bars or {2, 3, 5} D bars. (p205, p212, p179) — H/D — **M**. Test: compare with the no-scratch version. The book warns this hurts in slow grinds (p137, p139), so split results by the trend's average bar range.
16. **No-follow-through scratch.** After the fill, if price makes a minor push in favour that fails to exceed the trigger-area high (the prior swing extreme being targeted), then makes a lower H swing low, exit. (p188) — H — **A** (the "not far enough to trap" judgement, approximated by "fails to exceed the prior swing"). Test: compare with Rule 15 and with no scratch.
17. **Strength-into-entry veto or scratch.** If the pullback leg into the limit shows strength against the trade (leg speed > the speed of the prior with-trend extension, or ≥ 2 wide-range H bars against the trade), cancel the resting orders, or scratch at the first return to entry. (p212, p97, p101; ytc.md §4 momentum) — H — **M/A**. Test: split fills by pullback-leg momentum ratio and compare R.
18. **First pullback after an impulse.** If the prior extension was more than k × ATR (k ∈ {2, 3}) in ≤ 5 D bars, shift the limits one line deeper and apply Rule 15 with half the N. (p169, p186) — D + H — **M**. Test: is first-pullback depth after big impulses actually deeper (descriptive), and does the shift improve R?
19. **Deepen after failed follow-through.** If the previous trade in this stock and direction failed to make a new extreme (double top or bottom), place the next entry's limits one line deeper. (p164) — D + H — **M**. Test: conditional depth distribution, then R with and without.
20. **Cool-down after failures.** After 2 scratches or losses in the same stock and direction (or a run of 3 scratch/loss outcomes), take no new entry until a new confirmed swing in the bias direction appears. (p179, p213) — D — **M**. Test: compare the equity curve and expectancy of trades during cool-down periods vs other trades.
21. **Gap / opening-range gate for H fills.** If today's open gaps by more than 0.5×ATR, cancel resting limits until the first H bar closes. Then re-place them only if price has held the opening-range edge in the bias direction. Variant: trade an opening-range-failure entry. (p131–135, p160–161) — D + H (Q better) — **M**. Test: compare fills during the gap's first hour with fills later.
22. **Time-of-day fill filter.** Allow H/Q fills only outside the first hour (or only in the last 1–2 hours). (p67, p135) — H/Q — **M**. Test: bucket R by fill hour.
23. **Higher-timeframe candle-close conflict.** Skip a 1h long fill in the last hour of a day whose daily candle so far is a bearish wide-range bar closing near its low (or on a Friday into a bearish weekly bar). (p216) — D/W + H — **A**. Test: bucket fills by the state of the current daily or weekly candle.
24. **Position-level risk and R:R.** Size so that P1 + P2 at the common stop risk ≤ 1% of equity. Accept WF setups with R:R down to about 0.8 measured to the 1-line. (p106) — n/a — **M**. Test: this is a sizing convention. Check whether R:R filters (≥1, ≥1.5) on Rule 3 trades improve expectancy, given that the author says they aren't needed.
25. **Reporting convention.** Report every strategy as four buckets (P1-WF, P2-WF, P1-CF, P2-CF) plus a rolling 20-period expectancy, and treat a negative rolling window as a regime alarm. (p75, p224) — n/a — **M**. Test: not a rule to test, but use it in all specs.

**Priority for our next swing strategy:** Rule 7 (a cheap diagnostic on existing trades), then Rules 3/4/6 (limit vs stop entry), then 8 (hybrid), then 14/15/12/13 (management), then 10 and 11 (location and breadth filters).

---

## 10. Gaps and discretionary parts we can't codify

- **Future-flow bias.** The book's whole edge depends on reading future channel flow correctly. "Trade loss … is an indication of failure to correctly identify the market environment and future bias" (paraphrased, p103). It is built from PAT reading of strength and weakness in real time. We only have proxies (structure, EMA 15/20, depth, momentum), and our tests show structure proxies add little. The book says nothing new about *how* to read bias; it defers to PAT.
- **The neutral-flow call** (p89) is explicitly discretionary: "narrow range, no breakout expected".
- **Choosing semi-automatic depth** (½/¼ vs ¼/0 vs mid-zone) is by "feel for price movement" (p95, p102, p117, p151). Rule 4 is only a historical-depth approximation. The author himself says discretionary scaling beats the lines (p151).
- **Scratch decisions** are mostly felt: "didn't like the feel" (p179), "doubt crept in" (p117), "I'm the one trapped" (p188), "felt price was about to fall" (p192). Rules 15–17 approximate them. The book is inconsistent on purpose: scratch fast in some cases (p205, p212), but don't scratch early in slow grinds (p137, p139).
- **Target handling** (park beyond the 1-line, then pull in or push out on feel, p107, p115–116, p181) can't be specified; only the windfall and trailing parts are codified.
- **Stall and pattern reading on the lower timeframe** (40-second stall, 1-tick poke, 10–15 seconds dead, p215) has no clean 1h equivalent. Our 1h "stall" is at best k narrow or inside bars.
- **Tick/breadth reading** for confirmation (p124–129) is visual and regime-dependent. The NSE breadth proxies in Rule 11 are a different instrument at a different frequency.
- **Opening-range interpretation after gaps** (p133–135) is admittedly sometimes unreadable in real time.
- **No statistics.** The book gives no win rates, expectancy or sample sizes. Its evidence is three sessions plus selected examples (shown, per the disclaimer, to demonstrate concepts rather than as audited live trades, p4). The only numbers are rules of thumb: about 5 trades per hour (p24); 1% maximum position risk (p106); R:R below 1 accepted (p106); 70/90/100 goals and about 30% losing sessions (p75, p209); rolling 20-session review (p75); TICK ±600/±1000 (p121); a 20-tick chart at about one bar per 10 seconds (p146); and the stage gates of 20 review sessions, 20 sim sessions and 5 profitable sessions (p221–223).
- **Charts.** Most of the instructive content (exact fill locations, stop trails, missed-opportunity panels, review example p222, Figs 8.31–8.35, 9.25–9.30, and the trade-example 1-range charts) is in images I could not see. Statements tagged **[chart]** are inferred from the surrounding text.
