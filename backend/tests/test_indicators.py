import numpy as np
import pandas as pd
import pytest

from app.analysis.indicators import ema, rma, rsi


def test_ema_recursion():
    close = pd.Series([10.0, 11, 12, 13, 12, 11])
    out = ema(close, 3)
    alpha = 2 / 4
    expected = [10.0]
    for v in close[1:]:
        expected.append(alpha * v + (1 - alpha) * expected[-1])
    assert np.allclose(out, expected)


def test_rma_seeds_with_sma():
    values = pd.Series([1.0, 2, 3, 4, 5])
    out = rma(values, 3)
    assert out[:2].isna().all()
    assert out[2] == pytest.approx(2.0)
    assert out[3] == pytest.approx(2.0 + (4 - 2.0) / 3)


def test_rsi_bounds_and_extremes():
    up = pd.Series(np.arange(1.0, 40.0))
    assert rsi(up, 14).dropna().eq(100).all()

    down = pd.Series(np.arange(40.0, 1.0, -1))
    assert rsi(down, 14).dropna().eq(0).all()

    rng = np.random.default_rng(0)
    walk = pd.Series(100 + rng.normal(0, 1, 300).cumsum())
    values = rsi(walk, 14)
    assert values[:14].isna().all()  # first RSI needs 14 changes
    assert values.dropna().between(0, 100).all()


def test_rsi_known_value():
    # Classic RSI(14) worked example. Exact averages are 3.34/14 and 1.40/14, so
    # RSI = 70.46 (often quoted as 70.53 after rounding the averages first).
    close = pd.Series(
        [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08,
         45.89, 46.03, 45.61, 46.28, 46.28]
    )
    assert rsi(close, 14).iloc[-1] == pytest.approx(70.464, abs=0.001)
