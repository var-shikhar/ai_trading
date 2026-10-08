"""Candlestick pattern detection (TA-Lib) with trend context and outcome stats.

TA-Lib only looks at candle shapes; it doesn't check what came before. A
"hammer" in the middle of an uptrend isn't a reversal signal, so each hit
also reports whether the preceding trend fits the pattern's meaning.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
import talib


@dataclass(frozen=True)
class Pattern:
    id: str
    func: str  # TA-Lib function name
    name: str
    label: str  # short text for chart markers
    kind: str  # reversal | continuation | indecision
    bars: int  # candles the pattern spans
    # Direction when TA-Lib's sign isn't meaningful (it reports some one-sided
    # patterns as +100 regardless): 'bullish' | 'bearish' | 'neutral' | None.
    direction: str | None = None
    common: bool = True  # shown by default; uncommon/noisy ones are opt-in


PATTERNS: list[Pattern] = [
    # --- reversal ---
    Pattern("engulfing", "CDLENGULFING", "Engulfing", "Engulf", "reversal", 2),
    Pattern("hammer", "CDLHAMMER", "Hammer", "Hammer", "reversal", 1, "bullish"),
    Pattern("inverted_hammer", "CDLINVERTEDHAMMER", "Inverted Hammer", "Inv Hammer", "reversal", 1, "bullish"),
    Pattern("hanging_man", "CDLHANGINGMAN", "Hanging Man", "Hanging Man", "reversal", 1, "bearish"),
    Pattern("shooting_star", "CDLSHOOTINGSTAR", "Shooting Star", "Shoot Star", "reversal", 1, "bearish"),
    Pattern("morning_star", "CDLMORNINGSTAR", "Morning Star", "Morning Star", "reversal", 3, "bullish"),
    Pattern("evening_star", "CDLEVENINGSTAR", "Evening Star", "Evening Star", "reversal", 3, "bearish"),
    Pattern("morning_doji_star", "CDLMORNINGDOJISTAR", "Morning Doji Star", "Morning Doji", "reversal", 3, "bullish"),
    Pattern("evening_doji_star", "CDLEVENINGDOJISTAR", "Evening Doji Star", "Evening Doji", "reversal", 3, "bearish"),
    Pattern("piercing", "CDLPIERCING", "Piercing Line", "Piercing", "reversal", 2, "bullish"),
    Pattern("dark_cloud_cover", "CDLDARKCLOUDCOVER", "Dark Cloud Cover", "Dark Cloud", "reversal", 2, "bearish"),
    Pattern("harami", "CDLHARAMI", "Harami", "Harami", "reversal", 2),
    Pattern("harami_cross", "CDLHARAMICROSS", "Harami Cross", "Harami X", "reversal", 2),
    Pattern("three_white_soldiers", "CDL3WHITESOLDIERS", "Three White Soldiers", "3 Soldiers", "reversal", 3, "bullish"),
    Pattern("three_black_crows", "CDL3BLACKCROWS", "Three Black Crows", "3 Crows", "reversal", 3, "bearish"),
    Pattern("three_inside", "CDL3INSIDE", "Three Inside Up/Down", "3 Inside", "reversal", 3),
    Pattern("three_outside", "CDL3OUTSIDE", "Three Outside Up/Down", "3 Outside", "reversal", 3),
    Pattern("dragonfly_doji", "CDLDRAGONFLYDOJI", "Dragonfly Doji", "Dragonfly", "reversal", 1, "bullish"),
    Pattern("gravestone_doji", "CDLGRAVESTONEDOJI", "Gravestone Doji", "Gravestone", "reversal", 1, "bearish"),
    Pattern("doji_star", "CDLDOJISTAR", "Doji Star", "Doji Star", "reversal", 2),
    Pattern("abandoned_baby", "CDLABANDONEDBABY", "Abandoned Baby", "Aband Baby", "reversal", 3),
    Pattern("kicking", "CDLKICKING", "Kicking", "Kicking", "reversal", 2),
    Pattern("tweezer_bottom", "CDLMATCHINGLOW", "Matching Low", "Match Low", "reversal", 2, "bullish", False),
    Pattern("homing_pigeon", "CDLHOMINGPIGEON", "Homing Pigeon", "Pigeon", "reversal", 2, "bullish", False),
    Pattern("counterattack", "CDLCOUNTERATTACK", "Counterattack", "Counter", "reversal", 2, None, False),
    Pattern("belt_hold", "CDLBELTHOLD", "Belt Hold", "Belt Hold", "reversal", 1, None, False),
    Pattern("takuri", "CDLTAKURI", "Takuri", "Takuri", "reversal", 1, "bullish", False),
    Pattern("ladder_bottom", "CDLLADDERBOTTOM", "Ladder Bottom", "Ladder", "reversal", 5, "bullish", False),
    Pattern("stick_sandwich", "CDLSTICKSANDWICH", "Stick Sandwich", "Sandwich", "reversal", 3, "bullish", False),
    Pattern("unique_3_river", "CDLUNIQUE3RIVER", "Unique 3 River", "3 River", "reversal", 3, "bullish", False),
    Pattern("three_stars_south", "CDL3STARSINSOUTH", "Three Stars in the South", "3 Stars S", "reversal", 3, "bullish", False),
    Pattern("concealing_baby_swallow", "CDLCONCEALBABYSWALL", "Concealing Baby Swallow", "Baby Swallow", "reversal", 4, "bullish", False),
    Pattern("two_crows", "CDL2CROWS", "Two Crows", "2 Crows", "reversal", 3, "bearish", False),
    Pattern("identical_3_crows", "CDLIDENTICAL3CROWS", "Identical Three Crows", "Ident 3 Crows", "reversal", 3, "bearish", False),
    Pattern("upside_gap_2_crows", "CDLUPSIDEGAP2CROWS", "Upside Gap Two Crows", "Gap 2 Crows", "reversal", 3, "bearish", False),
    Pattern("advance_block", "CDLADVANCEBLOCK", "Advance Block", "Adv Block", "reversal", 3, "bearish", False),
    Pattern("stalled", "CDLSTALLEDPATTERN", "Stalled Pattern", "Stalled", "reversal", 3, "bearish", False),
    Pattern("breakaway", "CDLBREAKAWAY", "Breakaway", "Breakaway", "reversal", 5, None, False),
    Pattern("tristar", "CDLTRISTAR", "Tristar", "Tristar", "reversal", 3, None, False),
    Pattern("hikkake", "CDLHIKKAKE", "Hikkake", "Hikkake", "reversal", 3, None, False),
    Pattern("hikkake_mod", "CDLHIKKAKEMOD", "Modified Hikkake", "Hikkake M", "reversal", 3, None, False),
    Pattern("kicking_by_length", "CDLKICKINGBYLENGTH", "Kicking by Length", "Kick Len", "reversal", 2, None, False),
    # --- continuation ---
    Pattern("rising_falling_3", "CDLRISEFALL3METHODS", "Rising/Falling Three Methods", "3 Methods", "continuation", 5),
    Pattern("tasuki_gap", "CDLTASUKIGAP", "Tasuki Gap", "Tasuki", "continuation", 3),
    Pattern("separating_lines", "CDLSEPARATINGLINES", "Separating Lines", "Sep Lines", "continuation", 2, None, False),
    Pattern("side_by_side_white", "CDLGAPSIDESIDEWHITE", "Side-by-Side White Lines", "Side White", "continuation", 3, None, False),
    Pattern("gap_3_methods", "CDLXSIDEGAP3METHODS", "Up/Down-Gap Three Methods", "Gap 3 Meth", "continuation", 3, None, False),
    Pattern("mat_hold", "CDLMATHOLD", "Mat Hold", "Mat Hold", "continuation", 5, "bullish", False),
    Pattern("three_line_strike", "CDL3LINESTRIKE", "Three-Line Strike", "3 Strike", "continuation", 4, None, False),
    Pattern("in_neck", "CDLINNECK", "In-Neck", "In-Neck", "continuation", 2, "bearish", False),
    Pattern("on_neck", "CDLONNECK", "On-Neck", "On-Neck", "continuation", 2, "bearish", False),
    Pattern("thrusting", "CDLTHRUSTING", "Thrusting", "Thrusting", "continuation", 2, "bearish", False),
    # --- indecision / single-candle shapes (noisy; opt-in) ---
    Pattern("doji", "CDLDOJI", "Doji", "Doji", "indecision", 1, "neutral", False),
    Pattern("long_legged_doji", "CDLLONGLEGGEDDOJI", "Long-Legged Doji", "LL Doji", "indecision", 1, "neutral", False),
    Pattern("rickshaw_man", "CDLRICKSHAWMAN", "Rickshaw Man", "Rickshaw", "indecision", 1, "neutral", False),
    Pattern("spinning_top", "CDLSPINNINGTOP", "Spinning Top", "Spin Top", "indecision", 1, "neutral", False),
    Pattern("high_wave", "CDLHIGHWAVE", "High Wave", "High Wave", "indecision", 1, "neutral", False),
    Pattern("marubozu", "CDLMARUBOZU", "Marubozu", "Marubozu", "indecision", 1, None, False),
    Pattern("closing_marubozu", "CDLCLOSINGMARUBOZU", "Closing Marubozu", "Cl Marubozu", "indecision", 1, None, False),
    Pattern("long_line", "CDLLONGLINE", "Long Line", "Long Line", "indecision", 1, None, False),
    Pattern("short_line", "CDLSHORTLINE", "Short Line", "Short Line", "indecision", 1, None, False),
]

PATTERNS_BY_ID = {p.id: p for p in PATTERNS}

# Bars before the pattern used to judge the prior trend, and bars after it
# used to measure what happened next.
TREND_LOOKBACK = 5
OUTCOME_BARS = 5


def catalog() -> list[dict]:
    return [
        {
            "id": p.id,
            "name": p.name,
            "label": p.label,
            "kind": p.kind,
            "bars": p.bars,
            "common": p.common,
        }
        for p in PATTERNS
    ]


def _direction(p: Pattern, signal: int) -> str:
    if p.direction is not None:
        return p.direction
    return "bullish" if signal > 0 else "bearish"


def _prior_trend(close: np.ndarray, end: int) -> str | None:
    """Trend of the TREND_LOOKBACK bars ending at index `end` (inclusive)."""
    start = end - TREND_LOOKBACK
    if start < 0:
        return None
    window = close[start : end + 1]
    x = np.arange(len(window))
    slope = np.polyfit(x, window, 1)[0]
    # Ignore drift smaller than ~0.1% of price per bar.
    if abs(slope) < close[end] * 0.001:
        return "flat"
    return "up" if slope > 0 else "down"


def _fits_context(p: Pattern, direction: str, trend: str | None) -> bool:
    if p.kind == "indecision" or direction == "neutral" or trend is None:
        return True
    if p.kind == "reversal":
        # Bullish reversals need a prior decline; bearish ones a prior rise.
        return trend == ("down" if direction == "bullish" else "up")
    # Continuation: the prior trend should already point the same way.
    return trend == ("up" if direction == "bullish" else "down")


def detect(df: pd.DataFrame, pattern_ids: list[str] | None = None) -> list[dict]:
    """Every pattern hit in `df` (columns time/open/high/low/close), oldest first.

    Each hit reports the bar it completes on, its direction, whether the
    preceding trend fits it, and the % move over the next OUTCOME_BARS bars
    (None when not enough bars have happened yet).
    """
    if df.empty:
        return []
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    times = df["time"].to_numpy()
    patterns = [PATTERNS_BY_ID[i] for i in pattern_ids] if pattern_ids else PATTERNS

    hits = []
    for p in patterns:
        signals = getattr(talib, p.func)(o, h, l, c)
        for i in np.flatnonzero(signals):
            direction = _direction(p, int(signals[i]))
            # Trend leading into the first candle of the pattern.
            trend = _prior_trend(c, i - p.bars)
            j = i + OUTCOME_BARS
            move = round(float((c[j] - c[i]) / c[i] * 100), 2) if j < len(c) else None
            hits.append(
                {
                    "time": int(times[i]),
                    "index": int(i),
                    "pattern": p.id,
                    "direction": direction,
                    # TA-Lib reports +/-200 for confirmed hikkake-style signals.
                    "confirmed": abs(int(signals[i])) >= 200,
                    "prior_trend": trend,
                    "in_context": _fits_context(p, direction, trend),
                    "move_pct": move,
                }
            )
    hits.sort(key=lambda x: (x["time"], x["pattern"]))
    return hits


def outcome_stats(hits: list[dict]) -> list[dict]:
    """Per pattern+direction: how often price moved the predicted way afterwards.

    Neutral (indecision) patterns predict no direction, so they only report
    the average absolute move.
    """
    groups: dict[tuple[str, str], list[float]] = {}
    for hit in hits:
        if hit["move_pct"] is None:
            continue
        groups.setdefault((hit["pattern"], hit["direction"]), []).append(hit["move_pct"])

    stats = []
    for (pattern, direction), moves in groups.items():
        arr = np.array(moves)
        if direction == "neutral":
            win_rate = None
            avg = float(np.abs(arr).mean())
        else:
            signed = arr if direction == "bullish" else -arr
            win_rate = round(float((signed > 0).mean() * 100), 1)
            avg = float(signed.mean())
        stats.append(
            {
                "pattern": pattern,
                "direction": direction,
                "count": len(moves),
                "win_rate": win_rate,  # % of hits followed by a move in the predicted direction
                "avg_move_pct": round(avg, 2),  # in the predicted direction (neutral: absolute)
            }
        )
    stats.sort(key=lambda s: (-s["count"], s["pattern"]))
    return stats
