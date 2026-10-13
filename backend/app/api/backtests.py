from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.backtest import engine, jobs, signals
from app.deps import current_user, get_candle_service
from app.services import universes
from app.services.candles import CandleService

router = APIRouter(prefix="/api/backtests", tags=["backtests"])


class Condition(BaseModel):
    type: str
    params: dict = Field(default_factory=dict)


class BacktestIn(BaseModel):
    name: str = Field("Backtest", max_length=80)
    strategy_id: str | None = Field(None, max_length=16)  # saved strategy this run belongs to
    universe: str  # same lists as the scanner, plus "symbol"
    symbol: str | None = None  # when universe == "symbol"
    custom: list[str] = Field(default_factory=list, max_length=500)
    tf: Literal["1D", "1W"] = "1D"
    start: date
    end: date | None = None
    side: Literal["long", "short"] = "long"
    entry: list[Condition] = Field(..., min_length=1, max_length=10)
    exit_conditions: list[Condition] = Field(default_factory=list, max_length=10)
    stop_type: Literal["none", "pct", "atr"] = "pct"
    stop_value: float = Field(5.0, ge=0, le=100)
    target_type: Literal["none", "pct", "r"] = "r"
    target_value: float = Field(2.0, ge=0, le=100)
    trail_type: Literal["none", "pct", "atr"] = "none"
    trail_value: float = Field(0.0, ge=0, le=100)
    max_bars: int | None = Field(None, ge=1, le=1000)
    sizing: Literal["fixed", "pct_equity", "risk"] = "pct_equity"
    size_value: float = Field(10.0, gt=0)
    capital: float = Field(1_000_000, gt=0)
    max_positions: int = Field(10, ge=1, le=100)
    cost_pct: float = Field(0.1, ge=0, le=5)
    slippage_pct: float = Field(0.05, ge=0, le=5)

    @model_validator(mode="after")
    def check(self):
        if self.end and self.end <= self.start:
            raise ValueError("end must be after start")
        if self.sizing == "risk" and self.stop_type == "none":
            raise ValueError("Risk-based sizing needs a stop")
        if self.target_type == "r" and self.stop_type == "none":
            raise ValueError("An R-multiple target needs a stop")
        return self


@router.get("/catalog")
def catalog(user: str = Depends(current_user)):
    return {
        "conditions": list(signals.SIGNALS),
        "not_backtestable": signals.NOT_BACKTESTABLE,
        "universes": [{"id": "symbol", "name": "Chart symbol"}, *universes.catalog(user)],
    }


@router.post("")
async def run(body: BacktestIn, service: CandleService = Depends(get_candle_service),
              user: str = Depends(current_user)):
    bad = [c.type for c in body.entry + body.exit_conditions if c.type not in signals.SIGNALS]
    if bad:
        reasons = [f"{t}: {signals.NOT_BACKTESTABLE.get(t, 'unknown condition')}" for t in bad]
        raise HTTPException(400, "Can't backtest " + "; ".join(reasons))
    if body.universe == "symbol":
        if not body.symbol:
            raise HTTPException(400, "Pick a symbol")
        ticker = body.symbol.split(":")[-1].split("-")[0]
        symbols = [{"symbol": body.symbol, "ticker": ticker, "name": ticker, "industry": ""}]
    else:
        try:
            symbols = await universes.members(body.universe, body.custom, owner=user)
        except KeyError:
            raise HTTPException(400, f"Unknown universe '{body.universe}'") from None
    if not symbols:
        raise HTTPException(400, "No symbols to test")
    rules = engine.Rules(
        side=body.side,
        stop_type=body.stop_type,
        stop_value=body.stop_value,
        target_type=body.target_type,
        target_value=body.target_value,
        trail_type=body.trail_type,
        trail_value=body.trail_value,
        max_bars=body.max_bars,
        sizing=body.sizing,
        size_value=body.size_value,
        capital=body.capital,
        max_positions=body.max_positions,
        cost_pct=body.cost_pct,
        slippage_pct=body.slippage_pct,
    )
    request = body.model_dump(mode="json")
    request["entry"] = [c.model_dump() for c in body.entry]
    request["exit_conditions"] = [c.model_dump() for c in body.exit_conditions]
    return jobs.start(service, request, symbols, rules, owner=user).view()


@router.get("/jobs/{job_id}")
def job(job_id: str, user: str = Depends(current_user)):
    j = jobs.get(job_id, user)
    if not j:
        raise HTTPException(404, "Backtest job not found (the server may have restarted)")
    return j.view()


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, user: str = Depends(current_user)):
    return {"cancelled": jobs.cancel(job_id, user)}


@router.get("")
def history(user: str = Depends(current_user)):
    return jobs.list_results(user)


@router.get("/{result_id}")
def result(result_id: str, user: str = Depends(current_user)):
    r = jobs.load_result(result_id, user)
    if not r:
        raise HTTPException(404, "Result not found")
    return r


@router.delete("/{result_id}")
def delete(result_id: str, user: str = Depends(current_user)):
    jobs.delete_result(result_id, user)
    return {"ok": True}
