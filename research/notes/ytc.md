# YTC Price Action Trader (Lance Beggs): notes for swing trading

These are my paraphrased notes, not quotes. Page numbers are **PDF pages** of *YTC Price Action Trader – All 6 Volumes* (the copy in `strategy reference/`, which is not in git). The book's own page numbers restart in each volume.

YTC is written for intraday futures and forex, using three timeframes: 30 min (higher), 3 min (trading) and 1 min (lower). The ideas don't depend on the timeframe (p79–81, ch. 6), so for NSE swing trading I map them as:

| YTC role | YTC (intraday) | Our swing mapping |
|---|---|---|
| Higher timeframe: structure, S/R framework | 30 min | **Weekly** |
| Trading timeframe: trend, setups, targets | 3 min | **Daily** |
| Lower timeframe: entry timing, stop fine-tuning | 1 min | Daily trigger bar (optionally 1h/15m later) |

## 1. Support and resistance (p64–78)
- S/R are **areas**, not lines. They form where traders previously made decisions under stress: regret at missing a move, being trapped in a loss, or wanting to get out at breakeven. Those memories bring new orders when price comes back.
- Once a level breaks, it often flips role (old support becomes resistance). The cause is trapped longs selling at breakeven, plus breakout traders re-entering on the retest (p69–70).
- **Swing high (objective rule, p71–72):** a bar whose high is above the highs of the two bars before it and the two bars after it. Equal-high plateaus count as one swing. A swing low is the mirror image (p73–74).
- In choppy action, keep only the obvious levels. The best levels are the ones price left **fast**, through a rapid rejection or a strong breakout from congestion, because they show the biggest supply/demand imbalance (p90–91).
- Gaps can also act as S/R (p75), which matters more for stocks than for forex.

## 2. Multiple timeframes (p79–85)
- The higher timeframe gives the framework (barriers). The trade is taken on the trading timeframe, read inside that framework (p80–81).
- YTC explicitly rejects "trade only when all timeframes trend the same way" as limiting and still ineffective. What matters is where the next higher-timeframe barrier sits (p80).
- **Research implication:** a weekly trend filter is something to *test*, not to assume. The more YTC-like filter is "room to the next weekly S/R".

## 3. Market structure and trend (p86–104)
- Principle 1: price moves inside a framework of S/R. Principle 2: when a level breaks, price travels to the next area in the framework (p86).
- **Uptrend:** a repeating cycle of extension up, swing high, pullback, swing low. This gives higher highs and higher lows, with extensions longer than pullbacks. The trend ends when price breaks the swing low that led to the highest high. Failing to break it may just be a complex pullback (p99–101). Downtrends are the mirror image (p103–104).
- Fuel for a trend: much of the buying in an uptrend comes from shorts who tried to pick the top and are covering (p102).

## 4. Strength and weakness (p120–151)
- The market moves toward strength and away from weakness (p121).
- **Momentum:** compare the speed and slope of the current swing with the previous swing in the same direction and the last swing in the opposite direction. Deceleration is weakness (p123–126). This is about the price action itself, not an oscillator.
- **Projection:** how far an extension goes past the prior swing high, as a % of the extension. Shrinking projection signals a weakening trend.
- **Depth:** a pullback's retracement as a % of the prior extension. Rising depth signals a weakening trend; shallow pullbacks signal a strong one (p144–147). The book's examples range from about 20% (strong) to 85% (weak).
- Only *changes* matter, not absolute values. That makes them measurable relative to the stock's own recent swings.

## 5. Six principles of future direction (p152–153, reused for setups p241–253)
1. A trend continues until the next S/R barrier unless it shows weakness. Trade PB/CPB.
2. A weakening trend more likely gives a **complex correction** than a reversal. Prefer CPB, or a PB that breaks the prior swing low and then fails.
3. A range continues unless strength builds toward an edge.
4. Strength toward a range edge suggests a break. Then watch for weakness after the breakout (BOF) or weakness on the pullback (BPB).
5. At higher-timeframe S/R, expect the test to hold (TST) unless strength builds on the approach.
6. With strength on the approach, expect a break, then BOF or BPB as in 4.
- Price that runs far from its trend MA usually needs a CPB before it continues (p241).
- In strong trends, counter-trend setups are low probability. Use their failure as the with-trend entry (p250–251).

## 6. The five setups (p225–240)
All of them fade weakness and trade against **trapped traders** (p218–222).
| Setup | Where | Idea |
|---|---|---|
| **TST** | at higher-timeframe/range S/R | the test holds; late entrants into S/R get trapped |
| **BOF** | breakout of S/R | breakout traders get trapped when price is back inside within a few bars ("rare beyond 3–5 bars", p229) |
| **BPB** | after a breakout | the faders' pullback is weak; a failed BOF is a BPB |
| **PB** | within a trend, single leg | the counter-trend pullback stalls, often at a prior swing or congestion area (p235–237) |
| **CPB** | within a trend, multi-leg or long | often stronger than a PB: the 3rd leg breaks a prior low, traps shorts, then reverses (p238–240) |

## 7. Stops, targets, entry (p257–272)
- **Stop:** where the trade idea is proven wrong, beyond the extreme the other side couldn't push past (the pullback low for longs). Use a small buffer ("two pips"). It is a worst-case stop; losers are actively scratched earlier (p257–263).
- **Targets:** not a fixed 2R. T1 is the next trading-timeframe level expected to bring opposing orders (the prior swing high). T2 is just before the next higher-timeframe S/R. At all-time or long-term highs there is no T2, so trail instead (p264–269).
- Exit two parts: part 1 at T1, part 2 trails or runs to T2 (p265).
- **Entry:** you can't know in advance whether a stop-order breakout entry or a limit pullback entry is better. Enter "wholesale", early in the swing, in the zone where the trade idea holds (p270–272).

## 8. Expectancy (p215–217)
Expectancy = win% × average win − loss% × average loss. YTC raises win% through setup location and early entry, and raises the win/loss size ratio through early entry and active management.

## What this means for our research
Translated into testable, objective daily-bar rules:
- Swings: YTC 2-bar pivots, used only once confirmed, i.e. 2 bars after the extreme.
- Trend: HH+HL / LH+LL from confirmed swings. Weekly gives the "framework", daily is the trading timeframe.
- Strength and weakness: pullback depth relative to the prior extension, pullback duration, and projection of the last extension.
- PB/CPB entry: in a daily uptrend, after a pullback, buy on a break of the prior bar's high (the pullback's failure). Stop below the pullback low. T1 is the prior swing high; trail the rest.
- BOF: a break of a 20/55-day high or low that closes back inside within ≤3 bars, traded in the opposite direction.
- Discretionary parts we can't capture fully (reading momentum bar by bar, active scratching) are approximated, and the gap is noted in each strategy spec.
