"""Chart drawings, saved per user and symbol (shown on every timeframe, like
TradingView). The frontend owns the drawing format; we store it as JSON."""

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app import store
from app.deps import current_user
from app.store import drawings

router = APIRouter(prefix="/api/drawings", tags=["drawings"])


class Drawings(BaseModel):
    drawings: list[dict] = Field(default_factory=list, max_length=500)


@router.get("")
def get_drawings(symbol: str = Query(...), user: str = Depends(current_user)):
    r = store.row(sa.select(drawings.c.data).where(drawings.c.owner == user, drawings.c.symbol == symbol))
    return {"drawings": r["data"] if r else []}


@router.put("")
def put_drawings(body: Drawings, symbol: str = Query(...), user: str = Depends(current_user)):
    with store.tx() as c:
        c.execute(sa.delete(drawings).where(drawings.c.owner == user, drawings.c.symbol == symbol))
        if body.drawings:
            c.execute(sa.insert(drawings).values(owner=user, symbol=symbol, data=body.drawings, updated=store.now()))
    return {"count": len(body.drawings)}
