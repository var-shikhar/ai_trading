"""Strategies (saved rule sets) and signals (trade ideas from alerts, scans,
agents or people). Agents use the same endpoints with an API key:

    Authorization: Bearer ik_...
    POST /api/signals  {"symbol": "NSE:SBIN-EQ", "direction": "long", "reason": "...",
                        "source": "agent", "confidence": 0.7, "payload": {...}}
"""

import uuid
from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import store
from app.analysis import scanner
from app.deps import current_user
from app.store import signals, strategies

router = APIRouter(prefix="/api", tags=["strategies"])


class StrategyIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(None, max_length=2000)
    # Same shape as a backtest request's rule part: tf, side, entry,
    # exit_conditions, stop/target/trail, sizing, costs...
    definition: dict


def _check_definition(d: dict) -> None:
    conds = (d.get("entry") or []) + (d.get("exit_conditions") or [])
    bad = [c.get("type") for c in conds if c.get("type") not in scanner.CONDITIONS]
    if bad:
        raise HTTPException(400, f"Unknown conditions: {bad}")


def _strategy(r: dict) -> dict:
    return {**r, "created": r["created"].isoformat(timespec="seconds"),
            "updated": r["updated"].isoformat(timespec="seconds")}


@router.get("/strategies")
def list_strategies(user: str = Depends(current_user)):
    q = sa.select(strategies).where(strategies.c.owner == user).order_by(strategies.c.updated.desc())
    return [_strategy(r) for r in store.rows(q)]


@router.post("/strategies")
def create_strategy(body: StrategyIn, user: str = Depends(current_user)):
    _check_definition(body.definition)
    now = store.now()
    sid = uuid.uuid4().hex[:12]
    with store.tx() as c:
        c.execute(sa.insert(strategies).values(id=sid, owner=user, name=body.name.strip(), description=body.description,
                                               definition=body.definition, created=now, updated=now))
    return _strategy(store.row(sa.select(strategies).where(strategies.c.id == sid)))


@router.put("/strategies/{sid}")
def update_strategy(sid: str, body: StrategyIn, user: str = Depends(current_user)):
    _check_definition(body.definition)
    with store.tx() as c:
        n = c.execute(
            sa.update(strategies).where(strategies.c.id == sid, strategies.c.owner == user).values(
                name=body.name.strip(), description=body.description, definition=body.definition, updated=store.now()
            )
        ).rowcount
    if not n:
        raise HTTPException(404, "Strategy not found")
    return _strategy(store.row(sa.select(strategies).where(strategies.c.id == sid)))


@router.delete("/strategies/{sid}")
def delete_strategy(sid: str, user: str = Depends(current_user)):
    with store.tx() as c:
        c.execute(sa.delete(strategies).where(strategies.c.id == sid, strategies.c.owner == user))
    return {"ok": True}


# --- signals ------------------------------------------------------------------------------------


class SignalIn(BaseModel):
    symbol: str = Field(..., max_length=64)
    direction: Literal["long", "short", "exit", "watch"]
    source: Literal["agent", "manual", "scanner"] = "agent"
    tf: str | None = Field("1D", max_length=4)
    bar_time: int | None = None
    price: float | None = None
    confidence: float | None = Field(None, ge=0, le=1)
    reason: str | None = Field(None, max_length=4000)
    strategy_id: str | None = Field(None, max_length=16)
    payload: dict | None = None


class SignalPatch(BaseModel):
    status: Literal["new", "seen", "acted", "dismissed"]


def _signal(r: dict) -> dict:
    return {**r, "created": r["created"].isoformat(timespec="seconds")}


@router.get("/signals")
def list_signals(
    user: str = Depends(current_user),
    status: str | None = Query(None),
    source: str | None = Query(None),
    symbol: str | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    q = sa.select(signals).where(signals.c.owner == user)
    if status:
        q = q.where(signals.c.status == status)
    if source:
        q = q.where(signals.c.source == source)
    if symbol:
        q = q.where(signals.c.symbol == symbol)
    return [_signal(r) for r in store.rows(q.order_by(signals.c.created.desc()).limit(limit))]


@router.post("/signals")
def create_signal(body: SignalIn, user: str = Depends(current_user)):
    sid = uuid.uuid4().hex[:12]
    with store.tx() as c:
        c.execute(sa.insert(signals).values(id=sid, owner=user, status="new", created=store.now(), **body.model_dump()))
    return _signal(store.row(sa.select(signals).where(signals.c.id == sid)))


@router.patch("/signals/{sid}")
def update_signal(sid: str, body: SignalPatch, user: str = Depends(current_user)):
    with store.tx() as c:
        n = c.execute(sa.update(signals).where(signals.c.id == sid, signals.c.owner == user).values(status=body.status)).rowcount
    if not n:
        raise HTTPException(404, "Signal not found")
    return {"ok": True}


@router.delete("/signals/{sid}")
def delete_signal(sid: str, user: str = Depends(current_user)):
    with store.tx() as c:
        c.execute(sa.delete(signals).where(signals.c.id == sid, signals.c.owner == user))
    return {"ok": True}
