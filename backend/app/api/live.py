"""Live data: quotes snapshot, watchlists, and the /api/live tick stream."""

import asyncio
import json
import uuid
from datetime import datetime
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app.db import get_conn
from app.deps import get_candle_service, get_fyers
from app.providers.base import AuthRequired, ProviderError
from app.providers.fyers import FyersProvider
from app.services.live import LiveHub

router = APIRouter(prefix="/api", tags=["live"])


@lru_cache
def get_hub() -> LiveHub:
    fyers = get_fyers()
    service = get_candle_service()
    return LiveHub(token=fyers.access_token, resolve=lambda s: service.instrument_info(s)[0])


# --- quotes ------------------------------------------------------------------------------


@router.get("/quotes")
async def quotes(symbols: str = Query(..., description="Comma-separated"), fyers: FyersProvider = Depends(get_fyers)):
    requested = [s for s in dict.fromkeys(symbols.split(",")) if s][:200]
    service = get_candle_service()
    actual = {s: service.instrument_info(s)[0] for s in requested}
    try:
        data = await fyers.get_quotes(sorted(set(actual.values())))
    except AuthRequired as e:
        raise HTTPException(401, str(e)) from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return {s: data.get(a) for s, a in actual.items()}


# --- watchlists ----------------------------------------------------------------------------


class WatchItem(BaseModel):
    symbol: str
    ticker: str
    name: str = ""
    kind: str = "EQ"
    exchange: str | None = None


class WatchlistIn(BaseModel):
    name: str | None = Field(None, max_length=60)
    items: list[WatchItem] | None = Field(None, max_length=500)


def _row(r) -> dict:
    return {"id": r[0], "name": r[1], "items": json.loads(r[2]), "position": r[3]}


@router.get("/watchlists")
def list_watchlists():
    rows = get_conn().execute("SELECT id, name, items, position FROM watchlists ORDER BY position, name").fetchall()
    return [_row(r) for r in rows]


@router.post("/watchlists")
def create_watchlist(body: WatchlistIn):
    con = get_conn()
    position = con.execute("SELECT coalesce(max(position), -1) + 1 FROM watchlists").fetchone()[0]
    wid = uuid.uuid4().hex[:10]
    items = [i.model_dump() for i in body.items or []]
    con.execute(
        "INSERT INTO watchlists VALUES (?, ?, ?, ?, ?)",
        [wid, (body.name or "Watchlist").strip() or "Watchlist", json.dumps(items), position, datetime.now()],
    )
    return _row((wid, body.name or "Watchlist", json.dumps(items), position))


@router.put("/watchlists/{wid}")
def update_watchlist(wid: str, body: WatchlistIn):
    con = get_conn()
    row = con.execute("SELECT id, name, items, position FROM watchlists WHERE id = ?", [wid]).fetchone()
    if not row:
        raise HTTPException(404, "Watchlist not found")
    name = body.name.strip() if body.name and body.name.strip() else row[1]
    items = json.dumps([i.model_dump() for i in body.items]) if body.items is not None else row[2]
    con.execute("UPDATE watchlists SET name = ?, items = ?, updated = ? WHERE id = ?", [name, items, datetime.now(), wid])
    return _row((wid, name, items, row[3]))


@router.delete("/watchlists/{wid}")
def delete_watchlist(wid: str):
    get_conn().execute("DELETE FROM watchlists WHERE id = ?", [wid])
    return {"ok": True}


# --- live ticks -------------------------------------------------------------------------------


@router.websocket("/live")
async def live(ws: WebSocket):
    """Send {"subscribe": [symbols]} (the full set, replaces the previous one);
    receive {"type": "tick", ...} and {"type": "status", ...} messages."""
    await ws.accept()
    hub = get_hub()
    client = hub.add()
    await ws.send_json({"type": "status", "status": hub.status, "message": hub.message})

    async def pump():
        while True:
            await ws.send_json(await client.queue.get())

    sender = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            if isinstance(msg, dict) and isinstance(msg.get("subscribe"), list):
                await hub.set_symbols(client, [str(s) for s in msg["subscribe"]])
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        sender.cancel()
        await hub.remove(client)
