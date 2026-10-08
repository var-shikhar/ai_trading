"""Technical indicators, computed to match TradingView's definitions.

Shared by the chart endpoint and (later) pattern analysis, so both see
the same numbers.
"""

import numpy as np
import pandas as pd


def ema(close: pd.Series, length: int) -> pd.Series:
    """Exponential moving average, seeded with the first value (Pine ta.ema)."""
    return close.ewm(span=length, adjust=False).mean()


def rma(values: pd.Series, length: int) -> pd.Series:
    """Wilder's moving average, seeded with an SMA of the first `length` values (Pine ta.rma)."""
    arr = values.to_numpy(dtype=float)
    out = np.full(len(arr), np.nan)
    if len(arr) < length:
        return pd.Series(out, index=values.index)
    out[length - 1] = arr[:length].mean()
    alpha = 1 / length
    for i in range(length, len(arr)):
        out[i] = alpha * arr[i] + (1 - alpha) * out[i - 1]
    return pd.Series(out, index=values.index)


def rsi(close: pd.Series, length: int = 14) -> pd.Series:
    change = close.diff().iloc[1:]
    gain = rma(change.clip(lower=0), length)
    loss = rma(-change.clip(upper=0), length)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = gain / loss
        out = 100 - 100 / (1 + rs)
    out[(loss == 0) & gain.notna()] = 100.0
    return out.reindex(close.index)


# Chart overlays/panes, keyed by the id the frontend uses.
CHART_INDICATORS = {
    "ema20": lambda df: ema(df["close"], 20),
    "ema50": lambda df: ema(df["close"], 50),
    "ema200": lambda df: ema(df["close"], 200),
    "rsi14": lambda df: rsi(df["close"], 14),
}

# Extra bars loaded before the visible range so long EMAs have converged.
WARMUP_BARS = 400
