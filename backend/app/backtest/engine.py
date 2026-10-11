"""Portfolio backtest engine (bar by bar, no lookahead).

Order of events on each bar, for every symbol:
  1. Orders decided at the previous close fill at this bar's open
     (entries and rule/time exits), with slippage.
  2. Stops and targets are checked against this bar's range. A gap through
     a level fills at the open. If stop and target are both inside the bar
     we assume the stop hit first (we can't know the intrabar path).
  3. At the close: trailing stops ratchet, time and rule exits are queued,
     and entry signals are queued for symbols not held, if a position slot
     and cash are free. Several signals on one bar: the most liquid (20-bar
     average traded value) first.
Cash is shared across symbols; no leverage.
"""

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.analysis.studies import atr
from app.backtest import signals


@dataclass
class Rules:
    side: str = "long"  # long | short
    stop_type: str = "pct"  # none | pct | atr
    stop_value: float = 5.0
    target_type: str = "r"  # none | pct | r
    target_value: float = 2.0
    trail_type: str = "none"  # none | pct | atr
    trail_value: float = 0.0
    max_bars: int | None = None
    sizing: str = "pct_equity"  # fixed | pct_equity | risk
    size_value: float = 10.0  # ₹ (fixed), % of equity, or % of equity risked
    capital: float = 1_000_000.0
    max_positions: int = 10
    cost_pct: float = 0.1  # per side: brokerage + STT + charges
    slippage_pct: float = 0.05  # per side


@dataclass
class Position:
    symbol: str
    entry_index: int
    entry_time: int
    entry_price: float
    qty: int
    stop: float | None
    target: float | None
    initial_risk: float | None  # per share, for R multiples
    bars: int = 0
    trail_anchor: float = 0.0


@dataclass
class Trade:
    symbol: str
    side: str
    entry_time: int
    entry_price: float
    exit_time: int
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    r: float | None
    bars: int
    reason: str


@dataclass
class SymbolData:
    times: np.ndarray
    o: np.ndarray
    h: np.ndarray
    l: np.ndarray
    c: np.ndarray
    entry: np.ndarray
    exit: np.ndarray
    atr: np.ndarray
    liquidity: np.ndarray
    pos: dict[int, int] = field(default_factory=dict)  # time -> row


def prepare(df: pd.DataFrame, entry_conditions: list[dict], exit_conditions: list[dict]) -> SymbolData:
    df = df.reset_index(drop=True)
    entry = signals.combined(df, entry_conditions).to_numpy()
    exit_ = signals.combined(df, exit_conditions).to_numpy() if exit_conditions else np.zeros(len(df), bool)
    liquidity = (df["close"] * df["volume"]).rolling(20, min_periods=1).mean().to_numpy()
    times = df["time"].to_numpy()
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    data = SymbolData(times, o, h, l, c, entry, exit_, atr(df, 14).to_numpy(), liquidity)
    data.pos = {int(t): i for i, t in enumerate(times)}
    return data


def run(data: dict[str, SymbolData], rules: Rules, start_time: int, end_time: int) -> dict:
    long = rules.side == "long"
    sign = 1 if long else -1
    slip = rules.slippage_pct / 100
    cost = rules.cost_pct / 100
    timeline = sorted({t for d in data.values() for t in d.pos if start_time <= t <= end_time})

    cash = rules.capital
    positions: dict[str, Position] = {}
    pending_entries: list[str] = []
    pending_exits: dict[str, str] = {}  # symbol -> reason
    trades: list[Trade] = []
    equity_curve: list[tuple[int, float]] = []
    last_close: dict[str, float] = {}

    def fill_price(price: float, buying: bool) -> float:
        return price * (1 + slip) if buying else price * (1 - slip)

    def close_position(p: Position, t: int, raw_price: float, reason: str) -> None:
        nonlocal cash
        price = fill_price(raw_price, buying=not long)
        gross = (price - p.entry_price) * p.qty * sign
        fees = price * p.qty * cost
        cash += p.entry_price * p.qty + gross - fees
        entry_fees = p.entry_price * p.qty * cost
        pnl = gross - fees - entry_fees
        trades.append(
            Trade(
                symbol=p.symbol,
                side=rules.side,
                entry_time=p.entry_time,
                entry_price=round(p.entry_price, 4),
                exit_time=t,
                exit_price=round(price, 4),
                qty=p.qty,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl / (p.entry_price * p.qty) * 100, 3),
                r=round((price - p.entry_price) * sign / p.initial_risk, 3) if p.initial_risk else None,
                bars=p.bars,
                reason=reason,
            )
        )
        del positions[p.symbol]

    def equity() -> float:
        value = cash
        for p in positions.values():
            mark = last_close.get(p.symbol, p.entry_price)
            value += p.entry_price * p.qty + (mark - p.entry_price) * p.qty * sign
        return value

    for t in timeline:
        # 1. Fills at the open.
        for sym, reason in list(pending_exits.items()):
            d = data[sym]
            i = d.pos.get(t)
            if i is not None and sym in positions:
                close_position(positions[sym], t, float(d.o[i]), reason)
                pending_exits.pop(sym)
        for sym in pending_entries:
            d = data[sym]
            i = d.pos.get(t)
            if i is None or sym in positions or len(positions) >= rules.max_positions:
                continue
            price = fill_price(float(d.o[i]), buying=long)
            a = d.atr[i - 1] if i > 0 and np.isfinite(d.atr[i - 1]) else None
            stop = None
            if rules.stop_type == "pct":
                stop = price * (1 - sign * rules.stop_value / 100)
            elif rules.stop_type == "atr" and a:
                stop = price - sign * rules.stop_value * a
            risk = abs(price - stop) if stop is not None else None
            target = None
            if rules.target_type == "pct":
                target = price * (1 + sign * rules.target_value / 100)
            elif rules.target_type == "r" and risk:
                target = price + sign * rules.target_value * risk
            eq = equity()
            if rules.sizing == "fixed":
                budget = rules.size_value
            elif rules.sizing == "risk" and risk:
                budget = (eq * rules.size_value / 100) / risk * price
            else:
                budget = eq * rules.size_value / 100
            qty = math.floor(min(budget, cash) / (price * (1 + cost)))
            if qty < 1:
                continue
            cash -= price * qty * (1 + cost)
            positions[sym] = Position(sym, i, t, price, qty, stop, target, risk, trail_anchor=price)
        pending_entries = []

        # 2. Stops / targets inside the bar.
        for sym, p in list(positions.items()):
            d = data[sym]
            i = d.pos.get(t)
            if i is None:
                continue
            o, h, l = float(d.o[i]), float(d.h[i]), float(d.l[i])
            if p.stop is not None and (l <= p.stop if long else h >= p.stop):
                gap = o < p.stop if long else o > p.stop
                close_position(p, t, o if gap else p.stop, "stop")
                continue
            if p.target is not None and (h >= p.target if long else l <= p.target):
                gap = o > p.target if long else o < p.target
                close_position(p, t, o if gap else p.target, "target")

        # 3. At the close.
        for sym, d in data.items():
            i = d.pos.get(t)
            if i is not None:
                last_close[sym] = float(d.c[i])
        for sym, p in positions.items():
            d = data[sym]
            i = d.pos.get(t)
            if i is None:
                continue
            p.bars += 1
            if rules.trail_type != "none":
                extreme = float(d.h[i] if long else d.l[i])
                p.trail_anchor = max(p.trail_anchor, extreme) if long else min(p.trail_anchor, extreme)
                if rules.trail_type == "pct":
                    trail = p.trail_anchor * (1 - sign * rules.trail_value / 100)
                else:
                    a = d.atr[i] if np.isfinite(d.atr[i]) else None
                    trail = p.trail_anchor - sign * rules.trail_value * a if a else None
                if trail is not None and (p.stop is None or (trail > p.stop if long else trail < p.stop)):
                    p.stop = trail
            if rules.max_bars and p.bars >= rules.max_bars:
                pending_exits[sym] = "time"
            elif d.exit[i]:
                pending_exits[sym] = "rule"
        candidates = [
            sym
            for sym, d in data.items()
            if sym not in positions and (i := d.pos.get(t)) is not None and d.entry[i] and i + 1 < len(d.times)
        ]
        free = rules.max_positions - len(positions) + len([s for s in pending_exits if s in positions])
        if candidates and free > 0:
            candidates.sort(key=lambda s: -data[s].liquidity[data[s].pos[t]])
            pending_entries = candidates[:free]

        equity_curve.append((t, round(equity(), 2)))

    # Close anything still open at the last bar so results are complete.
    for sym, p in list(positions.items()):
        d = data[sym]
        last = max((tt for tt in d.pos if tt <= end_time), default=None)
        if last is not None:
            close_position(p, last, float(d.c[d.pos[last]]), "end")
    if equity_curve:
        equity_curve[-1] = (equity_curve[-1][0], round(cash, 2))

    return {"trades": trades, "equity": equity_curve}
