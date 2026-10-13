"""Server-side alert engine (runs while the browser is closed).

- price / drawing alerts: an internal client of the live hub receives ticks
  for every symbol with such an alert; each tick is checked against the
  previous one.
- condition alerts: every LOOP_SECONDS, alerts whose timeframe has a newly
  closed bar are evaluated on closed bars only (scanner conditions).
- scan alerts: once per trading day at their time, the scan runs and only
  symbols that weren't matching in the previous run are reported.
Alerts need market data, so they pause when the Fyers login has expired.
"""

import asyncio
import logging
import time
import uuid
from datetime import datetime

import pandas as pd
import sqlalchemy as sa

from app.alerts import notify
from app.alerts.evaluate import PriceRule, check_price, last_closed_bar, line_level, should_fire
from app.analysis import scanner
from app import store
from app.store import alert_events as events_t
from app.store import alerts as alerts_t
from app.store import signals as signals_t
from app.providers.base import AuthRequired
from app.services import universes

log = logging.getLogger(__name__)

IST_OFFSET = 19800
LOOP_SECONDS = 30
COLUMNS = ["time", "open", "high", "low", "close", "volume"]


def now_ist() -> int:
    return int(time.time()) + IST_OFFSET


# --- storage (all alerts are kept in memory; the database is written on change) ---------

_cache: list[dict] | None = None


def _public(r: dict) -> dict:
    d = dict(r)
    d["state"] = d.get("state") or {}
    d["expires"] = d["expires"].isoformat() if d.get("expires") else None
    d["created"] = d["created"].isoformat(timespec="seconds")
    return d


def _all() -> list[dict]:
    global _cache
    if _cache is None:
        _cache = [_public(r) for r in store.rows(sa.select(alerts_t).order_by(alerts_t.c.created.desc()))]
    return _cache


def invalidate() -> None:
    global _cache
    _cache = None


def list_alerts(owner: str | None = None) -> list[dict]:
    """Alerts of one user, or every user's (engine)."""
    return [a for a in _all() if owner is None or a["owner"] == owner]


def get_alert(alert_id: str, owner: str | None = None) -> dict | None:
    return next((a for a in _all() if a["id"] == alert_id and (owner is None or a["owner"] == owner)), None)


def save_alert(a: dict, owner: str) -> dict:
    aid = a.get("id") or uuid.uuid4().hex[:12]
    existing = get_alert(aid)
    if existing and existing["owner"] != owner:
        raise PermissionError("Not your alert")
    expires = datetime.fromisoformat(a["expires"]) if a.get("expires") else None
    values = dict(
        id=aid, owner=owner, kind=a["kind"], symbol=a.get("symbol"), ticker=a.get("ticker"), name=a.get("name", ""),
        config=a.get("config", {}), tf=a.get("tf"), frequency=a.get("frequency", "once"),
        channels=a.get("channels", ["app"]), message=a.get("message", ""), status=a.get("status", "active"),
        expires=expires,
        created=datetime.fromisoformat(existing["created"]) if existing else datetime.now(),
        last_fired=existing["last_fired"] if existing and a.get("status") != "active" else None,
        fire_count=existing["fire_count"] if existing else 0,
        state={} if a.get("reset_state", True) else (existing or {}).get("state", {}),
    )
    with store.tx() as c:
        c.execute(sa.delete(alerts_t).where(alerts_t.c.id == aid))
        c.execute(sa.insert(alerts_t).values(**values))
    invalidate()
    return get_alert(aid)


def delete_alert(alert_id: str, owner: str) -> None:
    with store.tx() as c:
        c.execute(sa.delete(alerts_t).where(alerts_t.c.id == alert_id, alerts_t.c.owner == owner))
    invalidate()


def _write(alert_id: str, **values) -> None:
    with store.tx() as c:
        c.execute(sa.update(alerts_t).where(alerts_t.c.id == alert_id).values(**values))


def list_events(owner: str, limit: int = 200) -> list[dict]:
    q = (sa.select(events_t).where(events_t.c.owner == owner).order_by(events_t.c.time.desc()).limit(limit))
    return store.rows(q)


# --- engine -------------------------------------------------------------------------------


class AlertEngine:
    def __init__(self, hub, service, fyers_ready):
        self.hub = hub
        self.service = service
        self.fyers_ready = fyers_ready  # () -> bool
        self.client = None
        self.prev: dict[str, tuple[int, float]] = {}  # alert id -> (time, price) of the previous tick
        self.status = "starting"
        self._tasks: list[asyncio.Task] = []

    # lifecycle
    def _client(self):
        if self.client is None:
            self.client = self.hub.add()
            self.client.internal = True
        return self.client

    async def start(self) -> None:
        self._client()
        await self.refresh()
        self._tasks = [asyncio.create_task(self._ticks()), asyncio.create_task(self._loop())]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        if self.client:
            await self.hub.remove(self.client)

    async def refresh(self) -> None:
        """Re-read alerts and subscribe to the symbols price/drawing alerts need."""
        symbols = sorted({a["symbol"] for a in list_alerts() if a["status"] == "active" and a["kind"] in ("price", "drawing")})
        if not self.fyers_ready():
            self.status = "paused: Fyers login required"
            return
        self.status = "running"
        await self.hub.set_symbols(self._client(), symbols)

    # firing
    async def fire(self, alert: dict, title: str, body: str, bar_time: int | None = None,
                   signal_symbols: list[str] | None = None) -> None:
        now = now_ist()
        if not should_fire(alert["frequency"], alert["last_fired"], now, bar_time, alert["state"].get("last_bar")):
            return
        owner = alert["owner"]
        event = {"type": "alert", "alert_id": alert["id"], "symbol": alert.get("symbol"), "title": title,
                 "body": body, "time": now}
        delivered = await notify.deliver(
            alert["channels"], title, body, lambda: self.hub.broadcast(event, user=owner), owner=owner
        )
        state = {**alert["state"], "last_bar": bar_time}
        status = "triggered" if alert["frequency"] == "once" else alert["status"]
        with store.tx() as c:
            c.execute(
                sa.update(alerts_t).where(alerts_t.c.id == alert["id"]).values(
                    last_fired=now, fire_count=alerts_t.c.fire_count + 1, status=status, state=state
                )
            )
            c.execute(sa.insert(events_t).values(
                id=uuid.uuid4().hex[:12], owner=owner, alert_id=alert["id"], time=now, symbol=alert.get("symbol"),
                title=title, body=body, delivered=delivered,
            ))
            # Condition and scan alerts are trading signals: record them for review/agents.
            if alert["kind"] in ("condition", "scan") and signal_symbols:
                for sym in signal_symbols:
                    c.execute(sa.insert(signals_t).values(
                        id=uuid.uuid4().hex[:12], owner=owner, source="alert", symbol=sym, tf=alert.get("tf") or "1D",
                        bar_time=bar_time, direction=alert["config"].get("direction", "watch"), reason=body[:2000],
                        payload={"alert_id": alert["id"], "alert_name": alert.get("name")}, status="new",
                        created=datetime.now(),
                    ))
        alert.update(last_fired=now, status=status, state=state, fire_count=alert["fire_count"] + 1)
        if status != "active":
            await self.refresh()

    # ticks -> price / drawing alerts
    async def _ticks(self) -> None:
        while True:
            msg = await self._client().queue.get()
            if msg.get("type") != "tick":
                continue
            try:
                await self.on_tick(msg)
            except Exception:
                log.exception("alert tick handling failed")

    async def on_tick(self, tick: dict) -> None:
        price, t = float(tick["ltp"]), int(tick["time"])
        for a in list_alerts():
            if a["status"] != "active" or a["symbol"] != tick["symbol"] or a["kind"] not in ("price", "drawing"):
                continue
            if self._expired(a):
                continue
            cfg = a["config"]
            rule = PriceRule(cfg.get("op", "crosses"), float(cfg.get("value", 0)))
            level = prev_level = None
            if a["kind"] == "drawing":
                level = line_level(cfg["points"], t)
                if level is None:
                    continue
                prev_t = self.prev.get(a["id"], (t, price))[0]
                prev_level = line_level(cfg["points"], prev_t)
            prev = self.prev.get(a["id"], (None, None))[1]
            self.prev[a["id"]] = (t, price)
            if check_price(rule, prev, price, level, prev_level, tick.get("chp")):
                what = describe_price(a, level)
                await self.fire(a, f"{a['ticker']} {what}", f"{a['ticker']} at {price:,.2f}. {a['message']}".strip())

    # bar closes -> condition and scan alerts
    async def _loop(self) -> None:
        while True:
            try:
                await self.check_bars()
                await self.check_scans()
            except Exception:
                log.exception("alert loop failed")
            await asyncio.sleep(LOOP_SECONDS)

    def _expired(self, a: dict) -> bool:
        if a["expires"] and datetime.fromisoformat(a["expires"]) < datetime.now():
            _write(a["id"], status="expired")
            a["status"] = "expired"
            return True
        return False

    async def check_bars(self, now: int | None = None) -> None:
        if not self.fyers_ready():
            self.status = "paused: Fyers login required"
            return
        self.status = "running"
        now = now or now_ist()
        for a in list_alerts():
            if a["status"] != "active" or a["kind"] != "condition" or self._expired(a):
                continue
            _, session = self.service.instrument_info(a["symbol"])
            closed = last_closed_bar(now, a["tf"], f"{session.start:%H:%M}", f"{session.end:%H:%M}")
            if a["state"].get("checked_bar") == closed:
                continue
            try:
                rows = await self.service.get_candles(a["symbol"], a["tf"], 400)
            except AuthRequired:
                self.status = "paused: Fyers login required"
                return
            df = pd.DataFrame(rows, columns=COLUMNS)
            df = df[df["time"] <= closed].reset_index(drop=True)
            state = {**a["state"], "checked_bar": closed}
            _write(a["id"], state=state)
            a["state"] = state
            if len(df) < 30 or int(df["time"].iloc[-1]) != closed:
                continue  # no bar for this period (holiday) or not enough data
            matched, details = scanner.evaluate(df, a["config"]["conditions"])
            if matched:
                body = "; ".join(details) + (f". {a['message']}" if a["message"] else "")
                await self.fire(a, f"{a['ticker']} {a['tf']}: conditions met", body, bar_time=closed,
                                signal_symbols=[a["symbol"]])

    async def check_scans(self, now: int | None = None) -> None:
        now = now or now_ist()
        hhmm = time.strftime("%H:%M", time.gmtime(now))
        today = time.strftime("%Y-%m-%d", time.gmtime(now))
        weekday = time.gmtime(now).tm_wday
        for a in list_alerts():
            cfg = a["config"]
            if a["status"] != "active" or a["kind"] != "scan" or self._expired(a):
                continue
            if weekday >= 5 or hhmm < cfg.get("at", "15:45") or a["state"].get("ran_on") == today:
                continue
            if not self.fyers_ready():
                return
            await self.run_scan_alert(a, today)

    async def run_scan_alert(self, a: dict, today: str) -> None:
        cfg = a["config"]
        members = await universes.members(cfg["universe"], cfg.get("custom", []), owner=a["owner"])
        matches: dict[str, list[str]] = {}
        symbols_by_ticker: dict[str, str] = {}
        for inst in members:
            try:
                rows = await self.service.get_candles(inst["symbol"], "1D", 400)
            except AuthRequired:
                return
            except Exception:
                continue
            df = pd.DataFrame(rows, columns=COLUMNS)
            if len(df) < 30:
                continue
            ok, details = scanner.evaluate(df, cfg["conditions"])
            if ok:
                matches[inst["ticker"]] = details
                symbols_by_ticker[inst["ticker"]] = inst["symbol"]
        previous = set(a["state"].get("matches", []))
        new = sorted(set(matches) - previous)
        state = {**a["state"], "ran_on": today, "matches": sorted(matches)}
        _write(a["id"], state=state)
        a["state"] = state
        if new:
            lines = [f"{t}: {'; '.join(matches[t])}" for t in new[:30]]
            more = f"\n…and {len(new) - 30} more" if len(new) > 30 else ""
            await self.fire(a, f"Scan '{a['name'] or cfg['universe']}': {len(new)} new", "\n".join(lines) + more,
                            signal_symbols=[symbols_by_ticker[t] for t in new])


def describe_price(a: dict, level: float | None) -> str:
    cfg = a["config"]
    op = cfg.get("op", "crosses")
    value = level if level is not None else cfg.get("value", 0)
    words = {
        "crosses_above": "crossed above",
        "crosses_below": "crossed below",
        "crosses": "crossed",
        "above": "is above",
        "below": "is below",
    }
    if op == "change_up":
        return f"up {cfg.get('value')}% today"
    if op == "change_down":
        return f"down {cfg.get('value')}% today"
    target = "your line" if a["kind"] == "drawing" else ""
    return f"{words.get(op, op)} {target} {value:,.2f}".replace("  ", " ")
