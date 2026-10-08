"""Scan conditions, evaluated on one symbol's bars.

A scan is a list of conditions that must all match (AND). Each condition
returns (matched, detail) where detail is a short human-readable reason
shown in the results, e.g. "RSI 27.4" or "Bullish engulfing, 1 bar ago".

Consolidation / breakout follow Part Time Larry's screener: the last N
closes inside a band of `pct` percent; a breakout is a close beyond the
band of the N bars before it.
"""

from collections.abc import Callable

import numpy as np
import pandas as pd

from app.analysis import candlestick, chart_patterns
from app.analysis.indicators import ema, rsi
from app.analysis.studies import atr, sma

Result = tuple[bool, str]


def _ma(close: pd.Series, kind: str, length: int) -> pd.Series:
    return sma(close, length) if kind == "sma" else ema(close, length)


def _cmp(value: float, op: str, target: float) -> bool:
    return value < target if op == "<" else value > target


def _ago(bars: int) -> str:
    return "last bar" if bars == 0 else f"{bars} bar{'s' if bars > 1 else ''} ago"


# --- conditions --------------------------------------------------------------------------


def consolidation(df: pd.DataFrame, p: dict) -> Result:
    n, pct = int(p.get("bars", 15)), float(p.get("pct", 2.5))
    closes = df["close"].iloc[-n:]
    if len(closes) < n:
        return False, ""
    lo, hi = closes.min(), closes.max()
    width = (hi - lo) / hi * 100
    return width <= pct, f"Range {width:.1f}% over {n} bars"


def breakout(df: pd.DataFrame, p: dict) -> Result:
    n, pct = int(p.get("bars", 15)), float(p.get("pct", 2.5))
    direction = p.get("direction", "up")
    if len(df) < n + 1:
        return False, ""
    prior = df["close"].iloc[-n - 1 : -1]
    lo, hi = prior.min(), prior.max()
    width = (hi - lo) / hi * 100
    last = df["close"].iloc[-1]
    if width > pct:
        return False, ""
    if direction == "up" and last > hi:
        return True, f"Broke above {n}-bar range ({width:.1f}%) by {(last / hi - 1) * 100:.1f}%"
    if direction == "down" and last < lo:
        return True, f"Broke below {n}-bar range ({width:.1f}%) by {(1 - last / lo) * 100:.1f}%"
    return False, ""


def candle_pattern(df: pd.DataFrame, p: dict) -> Result:
    within = int(p.get("within", 1))
    ids = p.get("patterns") or [x.id for x in candlestick.PATTERNS if x.common]
    direction = p.get("direction", "any")
    tail = df.iloc[-(within + candlestick.TREND_LOOKBACK + 10) :].reset_index(drop=True)
    first = len(tail) - within
    hits = [
        h
        for h in candlestick.detect(tail, ids)
        if h["index"] >= first
        and (h["in_context"] or not p.get("in_context", True))
        and direction in ("any", h["direction"])
    ]
    if not hits:
        return False, ""
    h = hits[-1]
    name = candlestick.PATTERNS_BY_ID[h["pattern"]].name
    extra = f" (+{len(hits) - 1} more)" if len(hits) > 1 else ""
    return True, f"{h['direction'].capitalize()} {name}, {_ago(len(tail) - 1 - h['index'])}{extra}"


def chart_pattern(df: pd.DataFrame, p: dict) -> Result:
    within = int(p.get("within", 5))
    types = set(p.get("types") or [])
    status = p.get("status", "any")
    direction = p.get("direction", "any")
    result = chart_patterns.detect(df, p.get("sensitivity", "medium"))
    cutoff = int(df["time"].iloc[-min(within, len(df))])
    found = [
        x
        for x in result["patterns"]
        if x["end_time"] >= cutoff
        and x["status"] != "failed"
        and (not types or x["type"] in types)
        and status in ("any", x["status"])
        and direction in ("any", x["direction"])
    ]
    if not found:
        return False, ""
    x = found[-1]
    target = f", target {x['target']:,.2f}" if x["target"] is not None else ""
    return True, f"{x['name']} ({x['status']}){target}"


def near_zone(df: pd.DataFrame, p: dict) -> Result:
    kind = p.get("kind", "support")
    within = float(p.get("within_atr", 1.0))
    zones = chart_patterns.detect(df, p.get("sensitivity", "medium"))["zones"]
    close = float(df["close"].iloc[-1])
    a = float(atr(df, 14).iloc[-1])
    for z in sorted(zones, key=lambda z: z["distance_atr"]):
        if z["kind"] != kind:
            continue
        edge = z["high"] if kind == "support" else z["low"]
        distance = abs(close - edge) / a if a else np.inf
        if distance <= within or z["low"] <= close <= z["high"]:
            return True, f"{kind.capitalize()} {z['low']:,.2f}–{z['high']:,.2f} ({z['touches']} touches)"
    return False, ""


def rsi_level(df: pd.DataFrame, p: dict) -> Result:
    length, op, value = int(p.get("length", 14)), p.get("op", "<"), float(p.get("value", 30))
    r = rsi(df["close"], length).iloc[-1]
    if not np.isfinite(r):
        return False, ""
    return _cmp(r, op, value), f"RSI {r:.1f}"


def price_vs_ma(df: pd.DataFrame, p: dict) -> Result:
    kind, length, op = p.get("ma", "ema"), int(p.get("length", 200)), p.get("op", "above")
    ma = _ma(df["close"], kind, length).iloc[-1]
    close = df["close"].iloc[-1]
    if not np.isfinite(ma):
        return False, ""
    gap = (close / ma - 1) * 100
    matched = close > ma if op == "above" else close < ma
    return matched, f"{gap:+.1f}% vs {kind.upper()} {length}"


def ma_cross(df: pd.DataFrame, p: dict) -> Result:
    kind = p.get("ma", "ema")
    fast, slow = int(p.get("fast", 50)), int(p.get("slow", 200))
    within, direction = int(p.get("within", 5)), p.get("direction", "golden")
    diff = (_ma(df["close"], kind, fast) - _ma(df["close"], kind, slow)).to_numpy()
    for back in range(within):
        i = len(diff) - 1 - back
        if i < 1 or not (np.isfinite(diff[i]) and np.isfinite(diff[i - 1])):
            continue
        if direction == "golden" and diff[i - 1] <= 0 < diff[i]:
            return True, f"{kind.upper()} {fast} crossed above {slow}, {_ago(back)}"
        if direction == "death" and diff[i - 1] >= 0 > diff[i]:
            return True, f"{kind.upper()} {fast} crossed below {slow}, {_ago(back)}"
    return False, ""


def macd_cross(df: pd.DataFrame, p: dict) -> Result:
    within, direction = int(p.get("within", 3)), p.get("direction", "bullish")
    close = df["close"]
    line = ema(close, 12) - ema(close, 26)
    hist = (line - ema(line, 9)).to_numpy()
    for back in range(within):
        i = len(hist) - 1 - back
        if i < 1:
            break
        if direction == "bullish" and hist[i - 1] <= 0 < hist[i]:
            return True, f"MACD crossed above signal, {_ago(back)}"
        if direction == "bearish" and hist[i - 1] >= 0 > hist[i]:
            return True, f"MACD crossed below signal, {_ago(back)}"
    return False, ""


def volume_spike(df: pd.DataFrame, p: dict) -> Result:
    length, multiple = int(p.get("length", 20)), float(p.get("multiple", 2.0))
    vol = df["volume"].astype(float)
    if len(vol) <= length or vol.iloc[-length - 1 : -1].mean() == 0:
        return False, ""
    ratio = vol.iloc[-1] / vol.iloc[-length - 1 : -1].mean()
    return ratio >= multiple, f"Volume {ratio:.1f}× {length}-bar average"


def high_low_52w(df: pd.DataFrame, p: dict) -> Result:
    kind, within = p.get("kind", "high"), float(p.get("within_pct", 3))
    year = df.iloc[-252:]
    close = df["close"].iloc[-1]
    if kind == "high":
        extreme = year["high"].max()
        gap = (extreme - close) / extreme * 100
        return gap <= within, f"{gap:.1f}% below 52-week high"
    extreme = year["low"].min()
    gap = (close - extreme) / extreme * 100
    return gap <= within, f"{gap:.1f}% above 52-week low"


CONDITIONS: dict[str, Callable[[pd.DataFrame, dict], Result]] = {
    "consolidation": consolidation,
    "breakout": breakout,
    "candle_pattern": candle_pattern,
    "chart_pattern": chart_pattern,
    "near_zone": near_zone,
    "rsi": rsi_level,
    "price_vs_ma": price_vs_ma,
    "ma_cross": ma_cross,
    "macd_cross": macd_cross,
    "volume_spike": volume_spike,
    "high_low_52w": high_low_52w,
}


def evaluate(df: pd.DataFrame, conditions: list[dict]) -> tuple[bool, list[str]]:
    """(all matched, details of every condition that matched)."""
    details = []
    for c in conditions:
        fn = CONDITIONS[c["type"]]
        matched, detail = fn(df, c.get("params", {}))
        if not matched:
            return False, details
        details.append(detail)
    return True, details


PRESETS = [
    {
        "id": "consolidation_breakout",
        "name": "Breakout from consolidation",
        "description": "Closed above a tight 15-day range (Part Time Larry's screener) on rising volume.",
        "conditions": [
            {"type": "breakout", "params": {"bars": 15, "pct": 6, "direction": "up"}},
            {"type": "volume_spike", "params": {"length": 20, "multiple": 1.5}},
        ],
    },
    {
        "id": "consolidating",
        "name": "Consolidating",
        "description": "Last 15 closes within a 4% range: watch for a breakout.",
        "conditions": [{"type": "consolidation", "params": {"bars": 15, "pct": 4}}],
    },
    {
        "id": "bullish_reversal_candles",
        "name": "Bullish reversal candle",
        "description": "Bullish reversal candlestick in the last 2 bars, after a decline.",
        "conditions": [
            {"type": "candle_pattern", "params": {"within": 2, "direction": "bullish", "in_context": True}}
        ],
    },
    {
        "id": "pullback_uptrend",
        "name": "Pullback in uptrend",
        "description": "Above the 200 EMA, RSI cooled below 45, near support.",
        "conditions": [
            {"type": "price_vs_ma", "params": {"ma": "ema", "length": 200, "op": "above"}},
            {"type": "rsi", "params": {"length": 14, "op": "<", "value": 45}},
            {"type": "near_zone", "params": {"kind": "support", "within_atr": 1.5}},
        ],
    },
    {
        "id": "chart_pattern_bullish",
        "name": "Bullish chart pattern",
        "description": "Bullish chart pattern forming or confirmed in the last 5 bars.",
        "conditions": [{"type": "chart_pattern", "params": {"within": 5, "direction": "bullish"}}],
    },
    {
        "id": "golden_cross",
        "name": "Golden cross",
        "description": "50 EMA crossed above the 200 EMA in the last 5 bars.",
        "conditions": [{"type": "ma_cross", "params": {"ma": "ema", "fast": 50, "slow": 200, "within": 5, "direction": "golden"}}],
    },
    {
        "id": "near_52w_high",
        "name": "Near 52-week high",
        "description": "Within 3% of the 52-week high, above the 50 EMA.",
        "conditions": [
            {"type": "high_low_52w", "params": {"kind": "high", "within_pct": 3}},
            {"type": "price_vs_ma", "params": {"ma": "ema", "length": 50, "op": "above"}},
        ],
    },
    {
        "id": "oversold",
        "name": "RSI oversold",
        "description": "RSI(14) below 30.",
        "conditions": [{"type": "rsi", "params": {"length": 14, "op": "<", "value": 30}}],
    },
    {
        "id": "macd_bullish",
        "name": "MACD bullish cross",
        "description": "MACD crossed above its signal line in the last 3 bars.",
        "conditions": [{"type": "macd_cross", "params": {"within": 3, "direction": "bullish"}}],
    },
]
