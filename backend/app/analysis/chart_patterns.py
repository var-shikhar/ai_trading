"""Chart pattern detection from swing points.

1. Swings: an ATR zigzag marks a swing high/low once price reverses by
   `k` x ATR from the running extreme, so the threshold adapts to each
   instrument's volatility. The last, still-moving extreme is included as
   an unconfirmed swing so patterns can be reported while forming.
2. Patterns are matched on the alternating swing sequence: double
   tops/bottoms, head & shoulders (and inverse), triangles, flags.
3. Each pattern gets a status: forming (no breakout yet), confirmed (a
   close beyond the neckline/trendline) or failed (price invalidated it
   first), plus the textbook measured-move target.
4. Support/resistance zones are price levels where swings cluster.

All tolerances are in ATR units measured at the pattern, so the same rules
work for a ₹50 stock and NIFTY.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd

from app.analysis.studies import atr

SENSITIVITY = {"low": 3.0, "medium": 2.0, "high": 1.3}  # zigzag reversal in ATRs
ATR_LENGTH = 14
# How far after the last swing we look for a breakout before calling the
# pattern stale (bars).
BREAKOUT_WINDOW = 40


@dataclass
class Swing:
    index: int
    price: float
    kind: str  # 'H' or 'L'
    confirmed: bool = True


# --- swings -------------------------------------------------------------------------


def zigzag(high: np.ndarray, low: np.ndarray, atr_v: np.ndarray, k: float) -> list[Swing]:
    n = len(high)
    swings: list[Swing] = []
    if n == 0:
        return swings
    direction = 0  # 1 = rising (tracking a high), -1 = falling (tracking a low)
    hi_i = lo_i = 0
    ext = 0
    for i in range(1, n):
        a = atr_v[i] if np.isfinite(atr_v[i]) else np.nan
        if not np.isfinite(a):
            if high[i] > high[hi_i]:
                hi_i = i
            if low[i] < low[lo_i]:
                lo_i = i
            continue
        threshold = k * a
        if direction == 0:
            if high[i] > high[hi_i]:
                hi_i = i
            if low[i] < low[lo_i]:
                lo_i = i
            if high[hi_i] - low[lo_i] >= threshold:
                # Whichever extreme came first is the first swing.
                if lo_i < hi_i:
                    swings.append(Swing(lo_i, float(low[lo_i]), "L"))
                    direction, ext = 1, hi_i
                else:
                    swings.append(Swing(hi_i, float(high[hi_i]), "H"))
                    direction, ext = -1, lo_i
        elif direction == 1:
            if high[i] >= high[ext]:
                ext = i
            elif high[ext] - low[i] >= threshold:
                swings.append(Swing(ext, float(high[ext]), "H"))
                direction, ext = -1, i
        else:
            if low[i] <= low[ext]:
                ext = i
            elif high[i] - low[ext] >= threshold:
                swings.append(Swing(ext, float(low[ext]), "L"))
                direction, ext = 1, i
    if direction == 1:
        swings.append(Swing(ext, float(high[ext]), "H", confirmed=False))
    elif direction == -1:
        swings.append(Swing(ext, float(low[ext]), "L", confirmed=False))
    return swings


# --- helpers ---------------------------------------------------------------------------


@dataclass
class Ctx:
    times: np.ndarray
    high: np.ndarray
    low: np.ndarray
    close: np.ndarray
    atr: np.ndarray

    def a(self, i: int) -> float:
        v = self.atr[min(max(i, 0), len(self.atr) - 1)]
        return float(v) if np.isfinite(v) else float(np.nanmean(self.atr))

    def pt(self, i: int, price: float) -> dict:
        return {"time": int(self.times[i]), "price": round(float(price), 4)}


def _line(i1: int, p1: float, i2: int, p2: float):
    slope = (p2 - p1) / (i2 - i1) if i2 != i1 else 0.0
    return lambda i: p1 + slope * (i - i1)


def _breakout(ctx: Ctx, start: int, below, above, window: int = BREAKOUT_WINDOW):
    """First bar after `start` whose close is below `below(i)` or above
    `above(i)` (either may be None). Returns (index, 'down'|'up') or (None, None)."""
    end = min(len(ctx.close), start + 1 + window)
    for i in range(start + 1, end):
        c = ctx.close[i]
        if below is not None and c < below(i):
            return i, "down"
        if above is not None and c > above(i):
            return i, "up"
    return None, None


def _pattern(kind, name, direction, status, points, ctx, *, lines=(), target=None, breakout=None):
    return {
        "type": kind,
        "name": name,
        "direction": direction,  # bullish | bearish | neutral (until breakout)
        "status": status,  # forming | confirmed | failed
        "points": points,
        "lines": list(lines),  # [{from: pt, to: pt, role}]
        "target": round(float(target), 4) if target is not None else None,
        "breakout": ctx.pt(breakout, ctx.close[breakout]) if breakout is not None else None,
        "start_time": points[0]["time"],
        "end_time": (ctx.pt(breakout, 0) if breakout is not None else points[-1])["time"],
    }


# --- double tops / bottoms -----------------------------------------------------------


def _doubles(sw: list[Swing], ctx: Ctx) -> list[dict]:
    out = []
    for j in range(len(sw) - 2):
        a, m, b = sw[j], sw[j + 1], sw[j + 2]
        if a.kind == m.kind or a.kind != b.kind or b.index - a.index < 5:
            continue
        atr_b = ctx.a(b.index)
        top = a.kind == "H"
        depth = (min(a.price, b.price) - m.price) if top else (m.price - max(a.price, b.price))
        if abs(a.price - b.price) > 0.75 * atr_b or depth < 2.0 * atr_b:
            continue
        # Needs a prior move into the pattern: an uptrend before a top.
        if j > 0 and ((sw[j - 1].price >= m.price) if top else (sw[j - 1].price <= m.price)):
            continue
        neckline = m.price
        extreme = max(a.price, b.price) if top else min(a.price, b.price)
        invalid = extreme + 0.5 * atr_b if top else extreme - 0.5 * atr_b
        brk, side = _breakout(
            ctx,
            b.index,
            below=(lambda i: neckline) if top else (lambda i: invalid),
            above=(lambda i: invalid) if top else (lambda i: neckline),
        )
        confirmed = brk is not None and side == ("down" if top else "up")
        status = "confirmed" if confirmed else ("failed" if brk is not None else "forming")
        height = abs(extreme - neckline)
        target = neckline - height if top else neckline + height
        end = brk if brk is not None else b.index
        points = [ctx.pt(s.index, s.price) for s in (a, m, b)]
        neck = {"from": ctx.pt(a.index, neckline), "to": ctx.pt(end, neckline), "role": "neckline"}
        out.append(
            _pattern(
                "double_top" if top else "double_bottom",
                "Double top" if top else "Double bottom",
                "bearish" if top else "bullish",
                status,
                points,
                ctx,
                lines=[neck],
                target=target,
                breakout=brk if confirmed else None,
            )
        )
    return out


# --- head & shoulders --------------------------------------------------------------------


def _head_shoulders(sw: list[Swing], ctx: Ctx) -> list[dict]:
    out = []
    for j in range(len(sw) - 4):
        ls, n1, hd, n2, rs = sw[j : j + 5]
        if ls.kind != hd.kind or hd.kind != rs.kind or n1.kind == ls.kind or n2.kind == ls.kind:
            continue
        top = hd.kind == "H"
        a = ctx.a(hd.index)
        sign = 1 if top else -1
        # Head clearly beyond both shoulders; shoulders roughly level.
        if sign * (hd.price - max(ls.price, rs.price, key=lambda p: sign * p)) < 0.5 * a:
            continue
        neck = _line(n1.index, n1.price, n2.index, n2.price)
        head_height = sign * (hd.price - neck(hd.index))
        if head_height < 2.0 * a:
            continue
        if abs(ls.price - rs.price) > max(1.5 * a, 0.35 * head_height):
            continue
        # Shoulders must stand clear of the neckline.
        if sign * (ls.price - neck(ls.index)) < 0.5 * a or sign * (rs.price - neck(rs.index)) < 0.5 * a:
            continue
        # Prior trend into the left shoulder.
        if j > 0 and sign * (sw[j - 1].price - neck(sw[j - 1].index)) > 0:
            continue
        invalid = hd.price + sign * 0.25 * a
        brk, side = _breakout(
            ctx,
            rs.index,
            below=neck if top else (lambda i: invalid),
            above=(lambda i: invalid) if top else neck,
        )
        confirmed = brk is not None and side == ("down" if top else "up")
        status = "confirmed" if confirmed else ("failed" if brk is not None else "forming")
        end = brk if brk is not None else rs.index
        target = (neck(end) - head_height) if top else (neck(end) + head_height)
        points = [ctx.pt(s.index, s.price) for s in (ls, n1, hd, n2, rs)]
        line = {"from": ctx.pt(ls.index, neck(ls.index)), "to": ctx.pt(end, neck(end)), "role": "neckline"}
        out.append(
            _pattern(
                "head_shoulders" if top else "inverse_head_shoulders",
                "Head & shoulders" if top else "Inverse head & shoulders",
                "bearish" if top else "bullish",
                status,
                points,
                ctx,
                lines=[line],
                target=target,
                breakout=brk if confirmed else None,
            )
        )
    return out


# --- triangles -------------------------------------------------------------------------


def _fit(points: list[Swing]):
    x = np.array([p.index for p in points], dtype=float)
    y = np.array([p.price for p in points])
    slope, intercept = np.polyfit(x, y, 1)
    resid = np.abs(y - (slope * x + intercept)).max()
    return slope, intercept, resid


def _triangles(sw: list[Swing], ctx: Ctx) -> list[dict]:
    out = []
    used_until = -1
    # Prefer the longest valid window ending at each swing.
    for end in range(3, len(sw)):
        for size in (6, 5, 4):
            start = end - size + 1
            if start < 0 or sw[start].index <= used_until:
                continue
            window = sw[start : end + 1]
            highs = [s for s in window if s.kind == "H"]
            lows = [s for s in window if s.kind == "L"]
            if len(highs) < 2 or len(lows) < 2:
                continue
            first, last = window[0].index, window[-1].index
            if last - first < 12:
                continue
            a = ctx.a(last)
            sh, ih, rh = _fit(highs)
            sl, il, rl = _fit(lows)
            if rh > 0.6 * a or rl > 0.6 * a:
                continue
            flat = 0.04 * a  # per bar
            upper = lambda i, s=sh, c=ih: s * i + c  # noqa: E731
            lower = lambda i, s=sl, c=il: s * i + c  # noqa: E731
            gap_start, gap_end = upper(first) - lower(first), upper(last) - lower(last)
            if gap_end <= 0 or gap_end >= gap_start * 0.85:
                continue  # must converge
            if abs(sh) <= flat and sl > flat:
                kind, name, bias = "ascending_triangle", "Ascending triangle", "bullish"
            elif sh < -flat and abs(sl) <= flat:
                kind, name, bias = "descending_triangle", "Descending triangle", "bearish"
            elif sh < -flat and sl > flat:
                kind, name, bias = "symmetrical_triangle", "Symmetrical triangle", "neutral"
            else:
                continue
            brk, side = _breakout(ctx, last, below=lower, above=upper)
            if brk is None:
                status, direction = "forming", bias
            else:
                direction = "bullish" if side == "up" else "bearish"
                expected = {"bullish": "up", "bearish": "down"}.get(bias)
                status = "confirmed" if expected in (None, side) else "failed"
            stop = brk if brk is not None else last
            height = gap_start
            target = None
            if brk is not None:
                target = ctx.close[brk] + height if side == "up" else ctx.close[brk] - height
            points = [ctx.pt(s.index, s.price) for s in window]
            lines = [
                {"from": ctx.pt(first, upper(first)), "to": ctx.pt(stop, upper(stop)), "role": "upper"},
                {"from": ctx.pt(first, lower(first)), "to": ctx.pt(stop, lower(stop)), "role": "lower"},
            ]
            out.append(
                _pattern(kind, name, direction, status, points, ctx, lines=lines, target=target,
                         breakout=brk if status == "confirmed" else None)
            )
            used_until = last
            break
    return out


# --- flags ---------------------------------------------------------------------------------


def _flags(sw: list[Swing], ctx: Ctx) -> list[dict]:
    out = []
    n = len(ctx.close)
    for j in range(len(sw) - 1):
        base, tip = sw[j], sw[j + 1]
        bars = tip.index - base.index
        if bars <= 0 or bars > 20:
            continue
        a = ctx.a(tip.index)
        pole = tip.price - base.price
        bull = pole > 0
        if abs(pole) < 4 * a or abs(pole) / bars < 0.35 * a:
            continue  # pole must be big and steep
        # Consolidation: bars after the tip until a breakout, max 20 bars.
        start = tip.index + 1
        last = min(n - 1, tip.index + 20)
        if start > last:
            continue
        brk = None
        lo, hi = np.inf, -np.inf
        for i in range(start, last + 1):
            if bull and ctx.close[i] > tip.price and i - tip.index >= 3:
                brk = i
                break
            if not bull and ctx.close[i] < tip.price and i - tip.index >= 3:
                brk = i
                break
            lo, hi = min(lo, ctx.low[i]), max(hi, ctx.high[i])
        if not np.isfinite(lo):
            continue
        cons_end = (brk - 1) if brk is not None else min(last, n - 1)
        if cons_end - tip.index < 3:
            continue
        retrace = (tip.price - lo) if bull else (hi - tip.price)
        if retrace > 0.5 * abs(pole) or retrace < 0.5 * a:
            continue  # too deep (not a flag) or no pullback at all
        status = "confirmed" if brk is not None else "forming"
        if brk is None and cons_end >= tip.index + 20:
            continue  # stale: never broke out
        target = tip.price + pole  # pole length projected from the flag
        points = [ctx.pt(base.index, base.price), ctx.pt(tip.index, tip.price)]
        box_top, box_bottom = (tip.price, lo) if bull else (hi, tip.price)
        lines = [
            {"from": ctx.pt(tip.index, box_top), "to": ctx.pt(cons_end, box_top), "role": "upper"},
            {"from": ctx.pt(tip.index, box_bottom), "to": ctx.pt(cons_end, box_bottom), "role": "lower"},
        ]
        out.append(
            _pattern("bull_flag" if bull else "bear_flag", "Bull flag" if bull else "Bear flag",
                     "bullish" if bull else "bearish", status, points, ctx, lines=lines,
                     target=target, breakout=brk)
        )
    return out


# --- support / resistance zones ----------------------------------------------------------


def zones(sw: list[Swing], ctx: Ctx, max_zones: int = 8) -> list[dict]:
    if not sw:
        return []
    a = ctx.a(len(ctx.close) - 1)
    last_close = float(ctx.close[-1])
    pts = sorted(sw, key=lambda s: s.price)
    clusters: list[list[Swing]] = []
    for s in pts:
        if clusters and s.price - clusters[-1][0].price <= 0.6 * a:
            clusters[-1].append(s)
        else:
            clusters.append([s])
    out = []
    for c in clusters:
        if len(c) < 2:
            continue
        prices = [s.price for s in c]
        lo, hi = min(prices) - 0.15 * a, max(prices) + 0.15 * a
        last_touch = max(s.index for s in c)
        mid = (lo + hi) / 2
        out.append(
            {
                "low": round(lo, 4),
                "high": round(hi, 4),
                "touches": len(c),
                "kind": "support" if mid < last_close else "resistance",
                "first_time": int(ctx.times[min(s.index for s in c)]),
                "last_time": int(ctx.times[last_touch]),
                "distance_atr": round(abs(mid - last_close) / a, 2),
            }
        )
    # Strongest and nearest first.
    out.sort(key=lambda z: (-z["touches"], z["distance_atr"]))
    return out[:max_zones]


def _dedupe(patterns: list[dict]) -> list[dict]:
    """Neighbouring swing windows can describe the same structure; of two
    same-type patterns overlapping by more than half the shorter one, keep
    the one that ends later (ties: more swing points)."""
    kept: list[dict] = []
    for p in sorted(patterns, key=lambda p: (p["end_time"], len(p["points"])), reverse=True):
        span = p["end_time"] - p["start_time"]
        dup = False
        for k in kept:
            if k["type"] != p["type"]:
                continue
            overlap = min(k["end_time"], p["end_time"]) - max(k["start_time"], p["start_time"])
            shorter = min(span, k["end_time"] - k["start_time"]) or 1
            if overlap > 0.5 * shorter:
                dup = True
                break
        if not dup:
            kept.append(p)
    return sorted(kept, key=lambda p: p["end_time"])


# --- entry point ---------------------------------------------------------------------------


def detect(df: pd.DataFrame, sensitivity: str = "medium") -> dict:
    """Patterns, swings and zones on `df` (time/open/high/low/close)."""
    if len(df) < ATR_LENGTH + 5:
        return {"swings": [], "patterns": [], "zones": []}
    high, low, close = (df[c].to_numpy(dtype=float) for c in ("high", "low", "close"))
    atr_v = atr(df, ATR_LENGTH).to_numpy(dtype=float)
    ctx = Ctx(df["time"].to_numpy(), high, low, close, atr_v)
    sw = zigzag(high, low, atr_v, SENSITIVITY.get(sensitivity, SENSITIVITY["medium"]))
    patterns = _doubles(sw, ctx) + _head_shoulders(sw, ctx) + _triangles(sw, ctx) + _flags(sw, ctx)
    # "Forming" only while a breakout can still come: older ones are stale.
    stale_before = int(ctx.times[max(0, len(close) - 1 - BREAKOUT_WINDOW)])
    patterns = _dedupe([p for p in patterns if p["status"] != "forming" or p["end_time"] >= stale_before])
    return {
        "swings": [
            {**ctx.pt(s.index, s.price), "kind": s.kind, "confirmed": s.confirmed} for s in sw
        ],
        "patterns": patterns,
        "zones": zones(sw, ctx),
    }
