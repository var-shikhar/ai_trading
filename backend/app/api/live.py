"""Live data: quotes snapshot, watchlists, and the /api/live tick stream."""

import asyncio
import uuid
from functools import lru_cache

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from app import store
from app.deps import LOCAL_USER, current_user, get_candle_service, get_fyers
from app.store import watchlists
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


def _wl(r: dict) -> dict:
    return {"id": r["id"], "name": r["name"], "items": r["items"], "position": r["position"]}


@router.get("/watchlists")
def list_watchlists(user: str = Depends(current_user)):
    q = sa.select(watchlists).where(watchlists.c.owner == user).order_by(watchlists.c.position, watchlists.c.name)
    return [_wl(r) for r in store.rows(q)]


@router.post("/watchlists")
def create_watchlist(body: WatchlistIn, user: str = Depends(current_user)):
    wid = uuid.uuid4().hex[:10]
    items = [i.model_dump() for i in body.items or []]
    name = (body.name or "Watchlist").strip() or "Watchlist"
    with store.tx() as c:
        position = c.execute(
            sa.select(sa.func.coalesce(sa.func.max(watchlists.c.position), -1) + 1).where(watchlists.c.owner == user)
        ).scalar()
        c.execute(sa.insert(watchlists).values(id=wid, owner=user, name=name, items=items, position=position,
                                               updated=store.now()))
    return {"id": wid, "name": name, "items": items, "position": position}


def _own_watchlist(c, wid: str, user: str) -> dict:
    r = c.execute(sa.select(watchlists).where(watchlists.c.id == wid, watchlists.c.owner == user)).first()
    if not r:
        raise HTTPException(404, "Watchlist not found")
    return dict(r._mapping)


@router.put("/watchlists/{wid}")
def update_watchlist(wid: str, body: WatchlistIn, user: str = Depends(current_user)):
    with store.tx() as c:
        r = _own_watchlist(c, wid, user)
        name = body.name.strip() if body.name and body.name.strip() else r["name"]
        items = [i.model_dump() for i in body.items] if body.items is not None else r["items"]
        c.execute(sa.update(watchlists).where(watchlists.c.id == wid).values(name=name, items=items,
                                                                            updated=store.now()))
    return {"id": wid, "name": name, "items": items, "position": r["position"]}


@router.delete("/watchlists/{wid}")
def delete_watchlist(wid: str, user: str = Depends(current_user)):
    with store.tx() as c:
        c.execute(sa.delete(watchlists).where(watchlists.c.id == wid, watchlists.c.owner == user))
    return {"ok": True}


# --- live ticks -------------------------------------------------------------------------------


@router.websocket("/live")
async def live(ws: WebSocket):
    """Send {"subscribe": [symbols]} (the full set, replaces the previous one);
    receive {"type": "tick", ...} and {"type": "status", ...} messages."""
    from app.config import get_settings
    from app.services import accounts

    # HTTP middleware doesn't run for WebSockets: check the session here.
    user = accounts.session_user(ws.cookies.get(accounts.SESSION_COOKIE))
    if not user and get_settings().auth_required:
        await ws.close(code=4401, reason="Not signed in")
        return
    await ws.accept()
    hub = get_hub()
    client = hub.add()
    client.user = user or LOCAL_USER  # alerts are delivered to their owner only
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
