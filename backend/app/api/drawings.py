"""Chart drawings, saved per symbol (shown on every timeframe, like
TradingView). The frontend owns the drawing format; we store it as JSON."""

import json
from datetime import datetime

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.db import get_conn

router = APIRouter(prefix="/api/drawings", tags=["drawings"])


class Drawings(BaseModel):
    drawings: list[dict] = Field(default_factory=list, max_length=500)


@router.get("")
def get_drawings(symbol: str = Query(...)):
    row = get_conn().execute("SELECT data FROM drawings WHERE symbol = ?", [symbol]).fetchone()
    return {"drawings": json.loads(row[0]) if row else []}


@router.put("")
def put_drawings(body: Drawings, symbol: str = Query(...)):
    con = get_conn()
    if body.drawings:
        con.execute(
            "INSERT OR REPLACE INTO drawings VALUES (?, ?, ?)",
            [symbol, json.dumps(body.drawings), datetime.now()],
        )
    else:
        con.execute("DELETE FROM drawings WHERE symbol = ?", [symbol])
    return {"count": len(body.drawings)}
