"""Live prices: one Fyers data socket shared by every browser tab.

Browser tabs connect to /api/live and say which symbols they want; the hub
keeps the union subscribed on a single Fyers WebSocket (via the official
SDK, which runs its own thread) and forwards each tick to the tabs that
asked for it. Continuous futures aliases (NSE:NIFTY1!) subscribe to their
front contract and the tick is relabelled with the alias.
"""

import asyncio
import logging
import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field

from app.config import get_settings

log = logging.getLogger(__name__)

IST_OFFSET = 5 * 3600 + 1800


@dataclass(eq=False)
class Client:
    queue: asyncio.Queue
    symbols: set[str] = field(default_factory=set)
    internal: bool = False  # e.g. the alert engine; doesn't receive broadcasts
    user: str | None = None  # signed-in user of a browser tab


def tick_from_message(msg: dict) -> dict | None:
    """Normalise an SDK SymbolUpdate/index message."""
    symbol = msg.get("symbol")
    ltp = msg.get("ltp")
    if not symbol or ltp is None:
        return None
    t = next((msg[k] for k in ("last_traded_time", "exch_feed_time") if msg.get(k) is not None), None)
    if t is None:
        t = int(time.time())
    return {
        "symbol": symbol,
        "ltp": ltp,
        "time": int(t) + IST_OFFSET,  # IST wall time as epoch, like bars
        "volume": msg.get("vol_traded_today"),  # cumulative for the day
        "open": msg.get("open_price"),
        "high": msg.get("high_price"),
        "low": msg.get("low_price"),
        "prev_close": msg.get("prev_close_price"),
        "ch": msg.get("ch"),
        "chp": msg.get("chp"),
    }


class LiveHub:
    def __init__(self, token: Callable[[], str | None], resolve: Callable[[str], str], socket_factory=None):
        self._token = token
        self._resolve = resolve  # requested symbol -> provider symbol
        self._socket_factory = socket_factory or _fyers_socket
        self._socket = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self.clients: set[Client] = set()
        self._wanted: dict[str, set[str]] = defaultdict(set)  # provider symbol -> requested symbols
        self._subscribed: set[str] = set()
        self.last: dict[str, dict] = {}  # requested symbol -> last tick
        self.status = "idle"
        self.message = ""
        self._lock = asyncio.Lock()

    # --- clients ---------------------------------------------------------------

    def add(self) -> Client:
        client = Client(asyncio.Queue(maxsize=2000))
        self.clients.add(client)
        return client

    async def remove(self, client: Client) -> None:
        self.clients.discard(client)
        await self._sync()

    async def set_symbols(self, client: Client, symbols: list[str]) -> None:
        client.symbols = set(symbols[:200])
        for s in client.symbols:  # snapshot of what we already know
            if s in self.last:
                self._put(client, {"type": "tick", **self.last[s]})
        await self._sync()

    def _put(self, client: Client, message: dict) -> None:
        try:
            client.queue.put_nowait(message)
        except asyncio.QueueFull:
            pass  # a stalled tab drops ticks rather than growing memory

    def broadcast(self, message: dict, user: str | None = None) -> None:
        """Send to browser tabs: all of them, or only `user`'s (e.g. an alert that fired)."""
        for c in self.clients:
            if not c.internal and (user is None or c.user == user):
                self._put(c, message)

    def _broadcast_status(self) -> None:
        for c in self.clients:
            self._put(c, {"type": "status", "status": self.status, "message": self.message})

    # --- Fyers socket ---------------------------------------------------------------

    async def _sync(self) -> None:
        """Subscribe/unsubscribe so the socket carries the clients' union."""
        async with self._lock:
            wanted: dict[str, set[str]] = defaultdict(set)
            for c in self.clients:
                for s in c.symbols:
                    wanted[self._resolve(s)].add(s)
            self._wanted = wanted
            add = set(wanted) - self._subscribed
            drop = self._subscribed - set(wanted)
            if drop and self._socket is not None:
                await asyncio.to_thread(self._socket.unsubscribe, symbols=sorted(drop), data_type="SymbolUpdate")
                self._subscribed -= drop
            if not add:
                return
            if self._socket is None:
                token = self._token()
                if not token:
                    self._set_status("error", "Fyers login required for live prices")
                    return
                self._loop = asyncio.get_running_loop()
                self._set_status("connecting", "")
                self._socket = await asyncio.to_thread(self._socket_factory, token, self)
                self._subscribed = set()
                add = set(wanted)
            await asyncio.to_thread(self._socket.subscribe, symbols=sorted(add), data_type="SymbolUpdate")
            self._subscribed |= add

    def _set_status(self, status: str, message: str) -> None:
        if (status, message) != (self.status, self.message):
            self.status, self.message = status, message
            self._broadcast_status()

    # Called from the SDK's thread.
    def on_message(self, msg) -> None:
        if self._loop and isinstance(msg, dict):
            self._loop.call_soon_threadsafe(self._dispatch, msg)

    def on_connect(self) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(self._set_status, "connected", "")

    def on_error(self, err) -> None:
        log.warning("Fyers live socket error: %s", err)
        text = err.get("message") if isinstance(err, dict) else str(err)
        if self._loop:
            self._loop.call_soon_threadsafe(self._set_status, "error", text or "socket error")

    def on_close(self, msg) -> None:
        if self._loop:
            self._loop.call_soon_threadsafe(self._set_status, "closed", "")

    def _dispatch(self, msg: dict) -> None:
        tick = tick_from_message(msg)
        if tick is None:
            return
        if self.status != "connected":
            self._set_status("connected", "")
        for requested in self._wanted.get(tick["symbol"], ()):
            labelled = {**tick, "symbol": requested}
            self.last[requested] = labelled
            for c in self.clients:
                if requested in c.symbols:
                    self._put(c, {"type": "tick", **labelled})

    async def close(self) -> None:
        if self._socket is not None:
            await asyncio.to_thread(self._socket.close_connection)
            self._socket = None


def _fyers_socket(token: str, hub: LiveHub):
    from fyers_apiv3.FyersWebsocket import data_ws

    log_dir = get_settings().db_file.parent
    socket = data_ws.FyersDataSocket(
        access_token=token,
        write_to_file=False,
        log_path=str(log_dir),
        litemode=False,
        reconnect=True,
        on_message=hub.on_message,
        on_error=hub.on_error,
        on_connect=hub.on_connect,
        on_close=hub.on_close,
    )
    socket.connect()
    return socket
