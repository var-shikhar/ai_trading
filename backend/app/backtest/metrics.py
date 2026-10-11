"""Performance statistics for a backtest result."""

import math
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

from app.backtest.engine import Trade

PERIODS_PER_YEAR = {"1D": 252, "1W": 52}


def _year(t: int) -> int:
    return datetime.fromtimestamp(t, timezone.utc).year


def drawdown(values: np.ndarray) -> np.ndarray:
    peak = np.maximum.accumulate(values)
    return (values - peak) / peak * 100


def summarize(trades: list[Trade], equity: list[tuple[int, float]], capital: float, tf: str) -> dict:
    if not equity:
        return {"trades": 0}
    values = np.array([v for _, v in equity], dtype=float)
    first_t, last_t = equity[0][0], equity[-1][0]
    years = max((last_t - first_t) / (365.25 * 86400), 1 / 365)
    final = values[-1]
    total_return = (final / capital - 1) * 100
    cagr = ((final / capital) ** (1 / years) - 1) * 100 if final > 0 else -100.0

    rets = np.diff(values) / values[:-1] if len(values) > 1 else np.array([])
    per_year = PERIODS_PER_YEAR.get(tf, 252)
    sharpe = float(rets.mean() / rets.std() * math.sqrt(per_year)) if len(rets) > 1 and rets.std() > 0 else None
    dd = drawdown(values)

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_win = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)
    rs = [t.r for t in trades if t.r is not None]

    return {
        "trades": len(trades),
        "final_equity": round(final, 2),
        "total_return_pct": round(total_return, 2),
        "cagr_pct": round(cagr, 2),
        "max_drawdown_pct": round(float(dd.min()), 2),
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else None,
        "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
        "avg_win_pct": round(float(np.mean([t.pnl_pct for t in wins])), 2) if wins else None,
        "avg_loss_pct": round(float(np.mean([t.pnl_pct for t in losses])), 2) if losses else None,
        "avg_r": round(float(np.mean(rs)), 2) if rs else None,
        "expectancy": round(sum(t.pnl for t in trades) / len(trades), 2) if trades else None,
        "avg_bars": round(float(np.mean([t.bars for t in trades])), 1) if trades else None,
        "best_trade_pct": round(max(t.pnl_pct for t in trades), 2) if trades else None,
        "worst_trade_pct": round(min(t.pnl_pct for t in trades), 2) if trades else None,
        "exit_reasons": dict(sorted({r: sum(1 for t in trades if t.reason == r) for r in {t.reason for t in trades}}.items())),
    }


def exposure_pct(trades: list[Trade], equity: list[tuple[int, float]]) -> float | None:
    """Share of bars with at least one open position."""
    if not equity:
        return None
    times = np.array([t for t, _ in equity])
    held = np.zeros(len(times), dtype=bool)
    for tr in trades:
        held |= (times >= tr.entry_time) & (times <= tr.exit_time)
    return round(float(held.mean() * 100), 1)


def yearly_returns(equity: list[tuple[int, float]], capital: float) -> list[dict]:
    out = []
    prev = capital
    by_year: dict[int, float] = {}
    for t, v in equity:
        by_year[_year(t)] = v
    for year in sorted(by_year):
        end = by_year[year]
        out.append({"year": year, "return_pct": round((end / prev - 1) * 100, 2)})
        prev = end
    return out


def per_symbol(trades: list[Trade]) -> list[dict]:
    groups: dict[str, list[Trade]] = defaultdict(list)
    for t in trades:
        groups[t.symbol].append(t)
    rows = [
        {
            "symbol": s,
            "trades": len(ts),
            "pnl": round(sum(t.pnl for t in ts), 2),
            "win_rate_pct": round(sum(1 for t in ts if t.pnl > 0) / len(ts) * 100, 1),
        }
        for s, ts in groups.items()
    ]
    return sorted(rows, key=lambda r: -r["pnl"])
