"""Configurable chart studies (indicators), TradingView-style.

Each study declares its inputs and outputs so the frontend can render a
settings dialog and the right series type without knowing the maths.
Formulas follow TradingView's built-ins (EMA seeded with the first value,
Wilder RMA for RSI/ATR/ADX, etc.) so values match what traders expect.
"""

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import talib

from app.analysis.indicators import ema, rma, rsi

SOURCES = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"]


@dataclass(frozen=True)
class Input:
    key: str
    name: str
    type: str  # int | float | source
    default: float | int | str
    min: float | None = None
    max: float | None = None
    step: float | None = None


@dataclass(frozen=True)
class Output:
    key: str
    name: str
    style: str = "line"  # line | histogram | dots
    # Histogram bars colored by sign (up/down colors) instead of one color.
    signed: bool = False


@dataclass(frozen=True)
class Study:
    id: str
    name: str
    short: str  # legend title, e.g. "BB"
    category: str
    overlay: bool  # drawn on the price pane, else its own pane
    inputs: list[Input]
    outputs: list[Output]
    compute: Callable[[pd.DataFrame, dict], dict[str, pd.Series]]
    levels: list[float] = field(default_factory=list)  # horizontal guides (e.g. RSI 70/30)
    needs_volume: bool = False


def source(df: pd.DataFrame, name: str) -> pd.Series:
    if name == "hl2":
        return (df["high"] + df["low"]) / 2
    if name == "hlc3":
        return (df["high"] + df["low"] + df["close"]) / 3
    if name == "ohlc4":
        return (df["open"] + df["high"] + df["low"] + df["close"]) / 4
    return df[name].astype(float)


def sma(s: pd.Series, length: int) -> pd.Series:
    return s.rolling(length).mean()


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift()
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1
    ).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    return tr


def atr(df: pd.DataFrame, length: int) -> pd.Series:
    return rma(true_range(df), length)


def _np(df: pd.DataFrame, *cols: str) -> list[np.ndarray]:
    return [df[c].to_numpy(dtype=float) for c in cols]


def _s(values: np.ndarray, df: pd.DataFrame) -> pd.Series:
    return pd.Series(values, index=df.index)


# --- compute functions --------------------------------------------------------


def _sma(df, p):
    return {"ma": sma(source(df, p["source"]), int(p["length"]))}


def _ema(df, p):
    return {"ma": ema(source(df, p["source"]), int(p["length"]))}


def _wma(df, p):
    return {"ma": _s(talib.WMA(source(df, p["source"]).to_numpy(float), int(p["length"])), df)}


def _bb(df, p):
    src = source(df, p["source"])
    basis = sma(src, int(p["length"]))
    dev = src.rolling(int(p["length"])).std(ddof=0) * float(p["mult"])
    return {"basis": basis, "upper": basis + dev, "lower": basis - dev}


def _supertrend(df, p):
    """TradingView ta.supertrend: bands of factor*ATR around hl2 that ratchet."""
    factor, length = float(p["factor"]), int(p["atr_length"])
    hl2 = ((df["high"] + df["low"]) / 2).to_numpy(float)
    close = df["close"].to_numpy(float)
    atr_v = atr(df, length).to_numpy(float)
    n = len(df)
    upper = np.full(n, np.nan)
    lower = np.full(n, np.nan)
    trend = np.zeros(n)  # 1 = up (green, line below price), -1 = down
    for i in range(n):
        if np.isnan(atr_v[i]):
            continue
        up_basic = hl2[i] + factor * atr_v[i]
        lo_basic = hl2[i] - factor * atr_v[i]
        if i == 0 or np.isnan(atr_v[i - 1]):
            # First bar with an ATR: TradingView starts in a downtrend.
            upper[i], lower[i], trend[i] = up_basic, lo_basic, -1
            continue
        prev_upper, prev_lower = upper[i - 1], lower[i - 1]
        lower[i] = lo_basic if lo_basic > prev_lower or close[i - 1] < prev_lower else prev_lower
        upper[i] = up_basic if up_basic < prev_upper or close[i - 1] > prev_upper else prev_upper
        # Flip when the close crosses the (ratcheted) band of the current trend.
        if trend[i - 1] == -1:
            trend[i] = 1 if close[i] > upper[i] else -1
        else:
            trend[i] = -1 if close[i] < lower[i] else 1
    up_line = np.where(trend == 1, lower, np.nan)
    down_line = np.where(trend == -1, upper, np.nan)
    return {"up": _s(up_line, df), "down": _s(down_line, df)}


def _vwap(df, p):
    """Session VWAP, reset each trading day. On daily+ bars each bar is its
    own session (as on TradingView), so VWAP equals the bar's typical price."""
    src = source(df, p["source"])
    vol = df["volume"].astype(float)
    if (vol == 0).all():
        return {"vwap": pd.Series(np.nan, index=df.index)}
    day = pd.to_datetime(df["time"], unit="s").dt.date
    pv = (src * vol).groupby(day).cumsum()
    cv = vol.groupby(day).cumsum()
    return {"vwap": (pv / cv.replace(0, np.nan))}


def _psar(df, p):
    high, low = _np(df, "high", "low")
    return {"sar": _s(talib.SAR(high, low, acceleration=float(p["start"]), maximum=float(p["max"])), df)}


def _donchian(df, p):
    n = int(p["length"])
    upper = df["high"].rolling(n).max()
    lower = df["low"].rolling(n).min()
    return {"upper": upper, "basis": (upper + lower) / 2, "lower": lower}


def _keltner(df, p):
    basis = ema(source(df, p["source"]), int(p["length"]))
    rng = atr(df, int(p["atr_length"])) * float(p["mult"])
    return {"upper": basis + rng, "basis": basis, "lower": basis - rng}


def _rsi(df, p):
    return {"rsi": rsi(source(df, p["source"]), int(p["length"]))}


def _macd(df, p):
    src = source(df, p["source"])
    line = ema(src, int(p["fast"])) - ema(src, int(p["slow"]))
    signal = ema(line, int(p["signal"]))
    return {"hist": line - signal, "macd": line, "signal": signal}


def _stoch(df, p):
    n = int(p["k_length"])
    lowest = df["low"].rolling(n).min()
    highest = df["high"].rolling(n).max()
    raw = 100 * (df["close"] - lowest) / (highest - lowest).replace(0, np.nan)
    k = sma(raw, int(p["k_smooth"]))
    return {"k": k, "d": sma(k, int(p["d_smooth"]))}


def _stochrsi(df, p):
    r = rsi(source(df, p["source"]), int(p["rsi_length"]))
    n = int(p["stoch_length"])
    lowest, highest = r.rolling(n).min(), r.rolling(n).max()
    raw = 100 * (r - lowest) / (highest - lowest).replace(0, np.nan)
    k = sma(raw, int(p["k_smooth"]))
    return {"k": k, "d": sma(k, int(p["d_smooth"]))}


def _adx(df, p):
    """DMI/ADX with Wilder smoothing (TradingView ta.dmi)."""
    n = int(p["length"])
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    tr = rma(true_range(df), n)
    plus = 100 * rma(plus_dm, n) / tr
    minus = 100 * rma(minus_dm, n) / tr
    dx = 100 * (plus - minus).abs() / (plus + minus).replace(0, np.nan)
    adx = rma(dx.fillna(0).iloc[n:], int(p["smoothing"])).reindex(df.index)
    return {"adx": adx, "plus": plus, "minus": minus}


def _atr(df, p):
    return {"atr": atr(df, int(p["length"]))}


def _cci(df, p):
    src = source(df, "hlc3")
    n = int(p["length"])
    ma = sma(src, n)
    dev = src.rolling(n).apply(lambda w: np.abs(w - w.mean()).mean(), raw=True)
    return {"cci": (src - ma) / (0.015 * dev.replace(0, np.nan))}


def _mfi(df, p):
    high, low, close, vol = _np(df, "high", "low", "close", "volume")
    return {"mfi": _s(talib.MFI(high, low, close, vol, int(p["length"])), df)}


def _willr(df, p):
    n = int(p["length"])
    highest = df["high"].rolling(n).max()
    lowest = df["low"].rolling(n).min()
    return {"r": 100 * (df["close"] - highest) / (highest - lowest).replace(0, np.nan)}


def _obv(df, p):
    change = np.sign(df["close"].diff().fillna(0))
    return {"obv": (change * df["volume"]).cumsum()}


def _roc(df, p):
    src = source(df, p["source"])
    n = int(p["length"])
    return {"roc": 100 * (src - src.shift(n)) / src.shift(n)}


SRC = Input("source", "Source", "source", "close")


def length(default: int, name: str = "Length", key: str = "length") -> Input:
    return Input(key, name, "int", default, 1, 500, 1)


STUDIES: list[Study] = [
    # --- moving averages ---
    Study("sma", "Simple Moving Average", "SMA", "Moving averages", True, [length(20), SRC], [Output("ma", "MA")], _sma),
    Study("ema", "Exponential Moving Average", "EMA", "Moving averages", True, [length(20), SRC], [Output("ma", "MA")], _ema),
    Study("wma", "Weighted Moving Average", "WMA", "Moving averages", True, [length(20), SRC], [Output("ma", "MA")], _wma),
    # --- trend / bands ---
    Study(
        "bb", "Bollinger Bands", "BB", "Volatility", True,
        [length(20), SRC, Input("mult", "StdDev", "float", 2.0, 0.1, 10, 0.1)],
        [Output("basis", "Basis"), Output("upper", "Upper"), Output("lower", "Lower")], _bb,
    ),
    Study(
        "supertrend", "Supertrend", "Supertrend", "Trend", True,
        [length(10, "ATR length", "atr_length"), Input("factor", "Factor", "float", 3.0, 0.1, 20, 0.1)],
        [Output("up", "Up trend"), Output("down", "Down trend")], _supertrend,
    ),
    Study("vwap", "VWAP (session)", "VWAP", "Volume", True, [Input("source", "Source", "source", "hlc3")],
          [Output("vwap", "VWAP")], _vwap, needs_volume=True),
    Study(
        "psar", "Parabolic SAR", "SAR", "Trend", True,
        [Input("start", "Start", "float", 0.02, 0.001, 1, 0.001), Input("max", "Maximum", "float", 0.2, 0.01, 1, 0.01)],
        [Output("sar", "SAR", "dots")], _psar,
    ),
    Study("donchian", "Donchian Channels", "DC", "Volatility", True, [length(20)],
          [Output("upper", "Upper"), Output("basis", "Basis"), Output("lower", "Lower")], _donchian),
    Study(
        "keltner", "Keltner Channels", "KC", "Volatility", True,
        [length(20), SRC, Input("mult", "Multiplier", "float", 2.0, 0.1, 10, 0.1), length(10, "ATR length", "atr_length")],
        [Output("upper", "Upper"), Output("basis", "Basis"), Output("lower", "Lower")], _keltner,
    ),
    # --- oscillators (own pane) ---
    Study("rsi", "Relative Strength Index", "RSI", "Momentum", False, [length(14), SRC], [Output("rsi", "RSI")], _rsi,
          levels=[70, 30]),
    Study(
        "macd", "MACD", "MACD", "Momentum", False,
        [length(12, "Fast length", "fast"), length(26, "Slow length", "slow"), length(9, "Signal", "signal"), SRC],
        [Output("hist", "Histogram", "histogram", signed=True), Output("macd", "MACD"), Output("signal", "Signal")],
        _macd, levels=[0],
    ),
    Study(
        "stoch", "Stochastic", "Stoch", "Momentum", False,
        [length(14, "%K length", "k_length"), length(3, "%K smoothing", "k_smooth"), length(3, "%D smoothing", "d_smooth")],
        [Output("k", "%K"), Output("d", "%D")], _stoch, levels=[80, 20],
    ),
    Study(
        "stochrsi", "Stochastic RSI", "Stoch RSI", "Momentum", False,
        [length(14, "RSI length", "rsi_length"), length(14, "Stochastic length", "stoch_length"),
         length(3, "K", "k_smooth"), length(3, "D", "d_smooth"), SRC],
        [Output("k", "K"), Output("d", "D")], _stochrsi, levels=[80, 20],
    ),
    Study(
        "adx", "ADX / DMI", "DMI", "Trend", False,
        [length(14, "DI length"), length(14, "ADX smoothing", "smoothing")],
        [Output("adx", "ADX"), Output("plus", "+DI"), Output("minus", "-DI")], _adx, levels=[25],
    ),
    Study("atr", "Average True Range", "ATR", "Volatility", False, [length(14)], [Output("atr", "ATR")], _atr),
    Study("cci", "Commodity Channel Index", "CCI", "Momentum", False, [length(20)], [Output("cci", "CCI")], _cci,
          levels=[100, -100]),
    Study("mfi", "Money Flow Index", "MFI", "Volume", False, [length(14)], [Output("mfi", "MFI")], _mfi,
          levels=[80, 20], needs_volume=True),
    Study("willr", "Williams %R", "%R", "Momentum", False, [length(14)], [Output("r", "%R")], _willr,
          levels=[-20, -80]),
    Study("obv", "On Balance Volume", "OBV", "Volume", False, [], [Output("obv", "OBV")], _obv, needs_volume=True),
    Study("roc", "Rate of Change", "ROC", "Momentum", False, [length(9), SRC], [Output("roc", "ROC")], _roc, levels=[0]),
]

STUDIES_BY_ID = {s.id: s for s in STUDIES}


def catalog() -> list[dict]:
    return [
        {
            "id": s.id,
            "name": s.name,
            "short": s.short,
            "category": s.category,
            "overlay": s.overlay,
            "levels": s.levels,
            "needs_volume": s.needs_volume,
            "inputs": [
                {k: v for k, v in vars(i).items() if v is not None} | ({"options": SOURCES} if i.type == "source" else {})
                for i in s.inputs
            ],
            "outputs": [vars(o) for o in s.outputs],
        }
        for s in STUDIES
    ]


def resolve_params(study: Study, params: dict | None) -> dict:
    """Defaults for missing inputs; numbers clamped to their allowed range."""
    params = params or {}
    out = {}
    for i in study.inputs:
        value = params.get(i.key, i.default)
        if i.type == "source":
            out[i.key] = value if value in SOURCES else i.default
            continue
        try:
            num = float(value)
        except (TypeError, ValueError):
            num = float(i.default)
        if i.min is not None:
            num = max(num, i.min)
        if i.max is not None:
            num = min(num, i.max)
        out[i.key] = int(round(num)) if i.type == "int" else num
    return out


def compute(study: Study, df: pd.DataFrame, params: dict) -> dict[str, pd.Series]:
    if df.empty:
        return {o.key: pd.Series(dtype=float) for o in study.outputs}
    return study.compute(df, params)
