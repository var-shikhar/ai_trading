"""Turn per-symbol candidate trades into a portfolio equity curve.

Strategies emit trades (symbol, entry_date, entry_px, exit_date, exit_px,
stop_px, ...) already simulated bar by bar on that symbol, with costs
applied. This module decides which of them a real account could take:
  - at most `max_pos` open positions;
  - size = risk_pct of current equity / (entry - stop), capped so a position
    is at most `max_weight` of equity and cash never goes negative;
  - same-day candidates are taken in the order given by `rank` (default:
    tighter stop first — no hindsight about outcome).
Equity is marked to market daily with each symbol's close.
"""

import numpy as np
import pandas as pd


def simulate(trades: pd.DataFrame, closes: dict[str, pd.Series], capital: float = 1_000_000, risk_pct: float = 1.0,
             max_pos: int = 10, max_weight: float = 0.2, rank: str | None = None) -> dict:
    if trades.empty:
        return {"equity": pd.Series(dtype=float), "taken": trades}
    t = trades.sort_values(["entry_date", rank or "risk_frac"]).reset_index(drop=True)
    dates = sorted(set().union(*[set(s.index) for s in closes.values()]))
    dates = [d for d in dates if t.entry_date.min() <= d <= t.exit_date.max()]
    by_entry: dict = {}
    for k, row in t.iterrows():
        by_entry.setdefault(row.entry_date, []).append(k)
    cash = capital
    open_pos: dict[int, dict] = {}
    taken = []
    curve = []
    last_px: dict[str, float] = {}
    for d in dates:
        # exits first (a slot freed today can be reused tomorrow, not today: conservative)
        for k in [k for k, p in open_pos.items() if p["exit_date"] <= d]:
            p = open_pos.pop(k)
            cash += p["qty"] * p["exit_px_net"]
        # entries at today's open price
        for k in by_entry.get(d, []):
            if len(open_pos) >= max_pos:
                break
            row = t.loc[k]
            if any(p["symbol"] == row.symbol for p in open_pos.values()):
                continue
            eq = cash + sum(p["qty"] * last_px.get(p["symbol"], p["entry_px"]) for p in open_pos.values())
            risk_per_share = row.entry_px - row.stop_px if row.side == "long" else row.stop_px - row.entry_px
            if risk_per_share <= 0:
                continue
            qty = np.floor(eq * risk_pct / 100 / risk_per_share)
            qty = min(qty, np.floor(eq * max_weight / row.entry_px), np.floor(cash / row.entry_px_net))
            if qty < 1:
                continue
            cash -= qty * row.entry_px_net
            open_pos[k] = {"symbol": row.symbol, "qty": qty, "entry_px": row.entry_px, "exit_date": row.exit_date,
                           "exit_px_net": row.exit_px_net}
            taken.append(k)
        for p in open_pos.values():
            s = closes[p["symbol"]]
            if d in s.index:
                last_px[p["symbol"]] = s.loc[d]
        curve.append((d, cash + sum(p["qty"] * last_px.get(p["symbol"], p["entry_px"]) for p in open_pos.values())))
    eq = pd.Series(dict(curve)).sort_index()
    return {"equity": eq, "taken": t.loc[taken]}


def stats(equity: pd.Series, trades: pd.DataFrame) -> dict:
    if equity.empty:
        return {"trades": 0}
    yrs = (equity.index[-1] - equity.index[0]).days / 365.25
    ret = equity.pct_change().dropna()
    dd = equity / equity.cummax() - 1
    r = trades["r"] if "r" in trades else pd.Series(dtype=float)
    wins = trades[trades.pnl_pct > 0]
    losses = trades[trades.pnl_pct <= 0]
    pf = wins.pnl_pct.sum() / -losses.pnl_pct.sum() if len(losses) and losses.pnl_pct.sum() < 0 else np.nan
    return {
        "trades": len(trades),
        "cagr%": ((equity.iloc[-1] / equity.iloc[0]) ** (1 / yrs) - 1) * 100 if yrs > 0 else np.nan,
        "maxdd%": dd.min() * 100,
        "sharpe": ret.mean() / ret.std() * np.sqrt(252) if ret.std() > 0 else np.nan,
        "win%": (trades.pnl_pct > 0).mean() * 100,
        "avgR": r.mean(),
        "PF": pf,
        "avg_bars": trades.bars.mean() if "bars" in trades else np.nan,
    }


def trade_stats(trades: pd.DataFrame) -> dict:
    """Portfolio-free statistics: every candidate trade, equal weight."""
    if trades.empty:
        return {"n": 0}
    r = trades["r"]
    return {
        "n": len(trades),
        "win%": (trades.pnl_pct > 0).mean() * 100,
        "avgR": r.mean(),
        "medR": r.median(),
        "avg%": trades.pnl_pct.mean(),
        "PF": trades[trades.pnl_pct > 0].pnl_pct.sum() / max(1e-9, -trades[trades.pnl_pct <= 0].pnl_pct.sum()),
        "avg_bars": trades.bars.mean(),
        "t_stat": r.mean() / (r.std() / np.sqrt(len(r))) if len(r) > 1 and r.std() > 0 else np.nan,
    }
