"""YTC-style market structure on any bar series, without lookahead.

Swing high (YTC Vol 2 p71): a bar whose high is above the highs of the two
bars before and the two bars after (equal highs on adjacent bars count as
one swing). Swing low: mirror image. `n` generalises "two" so we can test
coarser swings on daily data.

A swing at bar i is only KNOWN at bar i+n (when the n following bars have
printed). Everything here records both the swing bar and the bar on which
it became known (`known_at`), and the structure state uses only swings
known by that bar.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class Swing:
    kind: str  # "H" or "L"
    i: int  # bar of the extreme
    price: float
    known_at: int  # first bar on which the swing is confirmed


def find_swings(high: np.ndarray, low: np.ndarray, n: int = 2) -> list[Swing]:
    """Alternating swing highs/lows. Plateaus (equal extremes) are treated as
    one swing at the last bar of the plateau. When two same-kind swings come
    in a row, the more extreme one is kept (so the list alternates H/L)."""
    size = len(high)
    raw: list[Swing] = []
    for i in range(n, size - n):
        # plateau: extend j while equal highs
        h = high[i]
        if h > high[i - n:i].max():
            j = i
            while j + 1 < size and high[j + 1] == h:
                j += 1
            if j + n < size and h > high[j + 1:j + 1 + n].max():
                raw.append(Swing("H", j, float(h), j + n))
        lo = low[i]
        if lo < low[i - n:i].min():
            j = i
            while j + 1 < size and low[j + 1] == lo:
                j += 1
            if j + n < size and lo < low[j + 1:j + 1 + n].min():
                raw.append(Swing("L", j, float(lo), j + n))
    raw.sort(key=lambda s: (s.i, s.kind))
    out: list[Swing] = []
    for s in raw:
        if out and out[-1].i == s.i and out[-1].kind == s.kind:
            continue
        if out and out[-1].kind == s.kind:
            prev = out[-1]
            better = s.price > prev.price if s.kind == "H" else s.price < prev.price
            if better:
                # replacing a confirmed swing can't make it known earlier
                out[-1] = Swing(s.kind, s.i, s.price, max(s.known_at, prev.known_at))
            continue
        out.append(s)
    return out


def trend_state(df: pd.DataFrame, n: int = 2) -> pd.DataFrame:
    """Per bar, using only swings known by that bar:
    last two swing highs/lows, and the YTC trend label:
      up   = higher high and higher low, and close not below the last SL
      down = lower high and lower low, and close not above the last SH
      range otherwise.
    """
    h, l, c = df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy()
    swings = find_swings(h, l, n)
    size = len(df)
    sh1 = np.full(size, np.nan)  # latest known swing high
    sh2 = np.full(size, np.nan)  # the one before
    sl1 = np.full(size, np.nan)
    sl2 = np.full(size, np.nan)
    sh1_i = np.full(size, -1)
    sl1_i = np.full(size, -1)
    by_known = sorted(swings, key=lambda s: s.known_at)
    k = 0
    cur = {"H": [], "L": []}
    for t in range(size):
        while k < len(by_known) and by_known[k].known_at <= t:
            s = by_known[k]
            cur[s.kind].append(s)
            k += 1
        if len(cur["H"]) >= 1:
            sh1[t], sh1_i[t] = cur["H"][-1].price, cur["H"][-1].i
        if len(cur["H"]) >= 2:
            sh2[t] = cur["H"][-2].price
        if len(cur["L"]) >= 1:
            sl1[t], sl1_i[t] = cur["L"][-1].price, cur["L"][-1].i
        if len(cur["L"]) >= 2:
            sl2[t] = cur["L"][-2].price
    up = (sh1 > sh2) & (sl1 > sl2) & (c >= sl1)
    down = (sh1 < sh2) & (sl1 < sl2) & (c <= sh1)
    state = np.where(up, "up", np.where(down, "down", "range"))
    return pd.DataFrame(
        {"sh1": sh1, "sh2": sh2, "sl1": sl1, "sl2": sl2, "sh1_i": sh1_i, "sl1_i": sl1_i, "trend": state},
        index=df.index,
    )


def legs(df: pd.DataFrame, n: int = 2) -> pd.DataFrame:
    """Swing-to-swing legs with size (% of start price), bars, and the
    YTC depth (pullback as % of the prior opposite leg) and projection
    (how far an extension went past the previous same-side swing, as % of
    the extension)."""
    sw = find_swings(df["high"].to_numpy(), df["low"].to_numpy(), n)
    rows = []
    for a, b in zip(sw, sw[1:]):
        rows.append({
            "start_i": a.i, "end_i": b.i, "known_at": b.known_at, "dir": "up" if b.kind == "H" else "down",
            "start": a.price, "end": b.price, "pct": (b.price / a.price - 1) * 100, "bars": b.i - a.i,
        })
    lg = pd.DataFrame(rows)
    if lg.empty:
        return lg
    lg["size"] = (lg["end"] - lg["start"]).abs()
    lg["depth_pct"] = lg["size"] / lg["size"].shift() * 100  # this leg vs the previous (opposite) leg
    prev_same_end = lg["end"].shift(2)
    lg["projection_pct"] = np.where(
        lg["dir"] == "up", (lg["end"] - prev_same_end) / lg["size"] * 100, (prev_same_end - lg["end"]) / lg["size"] * 100
    )
    lg["date"] = df.index[lg["end_i"].to_numpy()]
    return lg
