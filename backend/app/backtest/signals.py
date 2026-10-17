"""Per-bar versions of the scanner conditions, for backtesting.

The scanner asks "does this hold on the last bar?". A backtest needs the
answer for every bar, using only data available at that bar's close, so
each condition here returns a boolean Series aligned with the frame.
"""

from collections.abc import Callable

import numpy as np
import pandas as pd

from app.analysis import candlestick, chart_patterns
from app.analysis.indicators import ema, rsi
from app.analysis.studies import sma


def _ma(close: pd.Series, kind: str, length: int) -> pd.Series:
    return sma(close, length) if kind == "sma" else ema(close, length)


def _within(signal: pd.Series, bars: int) -> pd.Series:
    """True if `signal` fired on this bar or any of the previous bars-1."""
    if bars <= 1:
        return signal.fillna(False).astype(bool)
    return signal.fillna(False).astype(int).rolling(bars, min_periods=1).max().astype(bool)


def _cmp(series: pd.Series, op: str, value: float) -> pd.Series:
    return series < value if op == "<" else series > value


def consolidation(df, p):
    n, pct = int(p.get("bars", 15)), float(p.get("pct", 2.5))
    hi = df["close"].rolling(n).max()
    lo = df["close"].rolling(n).min()
    return (hi - lo) / hi * 100 <= pct


def breakout(df, p):
    n, pct = int(p.get("bars", 15)), float(p.get("pct", 2.5))
    hi = df["close"].rolling(n).max().shift()
    lo = df["close"].rolling(n).min().shift()
    tight = (hi - lo) / hi * 100 <= pct
    if p.get("direction", "up") == "up":
        return tight & (df["close"] > hi)
    return tight & (df["close"] < lo)


def rsi_level(df, p):
    r = rsi(df["close"], int(p.get("length", 14)))
    return _cmp(r, p.get("op", "<"), float(p.get("value", 30))) & r.notna()


def price_vs_ma(df, p):
    ma = _ma(df["close"], p.get("ma", "ema"), int(p.get("length", 200)))
    above = df["close"] > ma
    return (above if p.get("op", "above") == "above" else ~above) & ma.notna()


def ma_cross(df, p):
    kind = p.get("ma", "ema")
    diff = _ma(df["close"], kind, int(p.get("fast", 50))) - _ma(df["close"], kind, int(p.get("slow", 200)))
    prev = diff.shift()
    if p.get("direction", "golden") == "golden":
        cross = (prev <= 0) & (diff > 0)
    else:
        cross = (prev >= 0) & (diff < 0)
    return _within(cross, int(p.get("within", 5)))


def macd_cross(df, p):
    line = ema(df["close"], 12) - ema(df["close"], 26)
    hist = line - ema(line, 9)
    prev = hist.shift()
    cross = (prev <= 0) & (hist > 0) if p.get("direction", "bullish") == "bullish" else (prev >= 0) & (hist < 0)
    return _within(cross, int(p.get("within", 3)))


def volume_spike(df, p):
    n, multiple = int(p.get("length", 20)), float(p.get("multiple", 2.0))
    avg = df["volume"].astype(float).rolling(n).mean().shift()
    return (df["volume"] / avg.replace(0, np.nan)) >= multiple


def high_low_52w(df, p):
    within = float(p.get("within_pct", 3))
    if p.get("kind", "high") == "high":
        extreme = df["high"].rolling(252, min_periods=20).max()
        return (extreme - df["close"]) / extreme * 100 <= within
    extreme = df["low"].rolling(252, min_periods=20).min()
    return (df["close"] - extreme) / extreme * 100 <= within


def candle_pattern(df, p):
    # TA-Lib patterns and the prior-trend check only look backwards.
    ids = p.get("patterns") or [x.id for x in candlestick.PATTERNS if x.common]
    direction = p.get("direction", "any")
    hit = np.zeros(len(df), dtype=bool)
    for h in candlestick.detect(df.reset_index(drop=True), ids):
        if (h["in_context"] or not p.get("in_context", True)) and direction in ("any", h["direction"]):
            hit[h["index"]] = True
    return _within(pd.Series(hit, index=df.index), int(p.get("within", 1)))


def chart_pattern(df, p):
    """Fires on the bar a pattern was confirmed (its breakout), the first
    moment it was known. Forming patterns aren't backtestable: whether the
    last swing holds is only known later."""
    types = set(p.get("types") or [])
    direction = p.get("direction", "any")
    result = chart_patterns.detect(df.reset_index(drop=True), p.get("sensitivity", "medium"))
    pos = {int(t): i for i, t in enumerate(df["time"].to_numpy())}
    hit = np.zeros(len(df), dtype=bool)
    for x in result["patterns"]:
        if x["status"] != "confirmed" or not x["breakout"]:
            continue
        if (types and x["type"] not in types) or direction not in ("any", x["direction"]):
            continue
        i = pos.get(x["breakout"]["time"])
        if i is not None:
            hit[i] = True
    return _within(pd.Series(hit, index=df.index), int(p.get("within", 1)))


def new_high(df, p):
    n = int(p.get("bars", 252))
    if p.get("direction", "high") == "high":
        return df["close"] > df["high"].rolling(n, min_periods=min(n, 60)).max().shift()
    return df["close"] < df["low"].rolling(n, min_periods=min(n, 60)).min().shift()


def narrow_range(df, p):
    n = int(p.get("bars", 7))
    rng = df["high"] - df["low"]
    out = rng <= rng.rolling(n).min()
    if p.get("inside", False):
        out &= (df["high"] <= df["high"].shift()) & (df["low"] >= df["low"].shift())
    return out


def trend_template(df, p):
    close = df["close"]
    s50, s150, s200 = sma(close, 50), sma(close, 150), sma(close, 200)
    lo = df["low"].rolling(252, min_periods=200).min()
    hi = df["high"].rolling(252, min_periods=200).max()
    return (
        (close > s50) & (s50 > s150) & (s150 > s200) & (s200 > s200.shift(21))
        & (close >= lo * 1.25) & (close >= hi * 0.75)
    )


def ma_pullback(df, p):
    close = df["close"]
    ma = _ma(close, p.get("ma", "ema"), int(p.get("length", 20)))
    long_ma = sma(close, int(p.get("trend", 200)))
    return (df["low"] <= ma) & (close > ma) & (close > long_ma) & (ma > long_ma)


def day_change(df, p):
    chg = df["close"].pct_change() * 100
    return _cmp(chg, p.get("op", ">"), float(p.get("value", 3))) & chg.notna()


SIGNALS: dict[str, Callable[[pd.DataFrame, dict], pd.Series]] = {
    "consolidation": consolidation,
    "breakout": breakout,
    "rsi": rsi_level,
    "price_vs_ma": price_vs_ma,
    "ma_cross": ma_cross,
    "macd_cross": macd_cross,
    "volume_spike": volume_spike,
    "high_low_52w": high_low_52w,
    "candle_pattern": candle_pattern,
    "chart_pattern": chart_pattern,
    "new_high": new_high,
    "narrow_range": narrow_range,
    "trend_template": trend_template,
    "ma_pullback": ma_pullback,
    "day_change": day_change,
}

# Scanner conditions that can't be evaluated without hindsight.
NOT_BACKTESTABLE = {"near_zone": "support/resistance zones are built from all swings, including later ones"}


def combined(df: pd.DataFrame, conditions: list[dict]) -> pd.Series:
    """All conditions true (AND) on each bar."""
    out = pd.Series(True, index=df.index)
    for c in conditions:
        out &= SIGNALS[c["type"]](df, c.get("params", {})).fillna(False).astype(bool)
    return out
