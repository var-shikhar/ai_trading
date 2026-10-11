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
import json
import logging
import time
import uuid
from datetime import datetime

import pandas as pd

from app.alerts import notify
from app.alerts.evaluate import PriceRule, check_price, last_closed_bar, line_level, should_fire
from app.analysis import scanner
from app.db import get_conn
from app.providers.base import AuthRequired
from app.services import universes

log = logging.getLogger(__name__)

IST_OFFSET = 19800
LOOP_SECONDS = 30
COLUMNS = ["time", "open", "high", "low", "close", "volume"]


def now_ist() -> int:
    return int(time.time()) + IST_OFFSET


# --- storage ----------------------------------------------------------------------------


def _row(r) -> dict:
    keys = ["id", "kind", "symbol", "ticker", "name", "config", "tf", "frequency", "channels", "message",
            "status", "expires", "created", "last_fired", "fire_count", "state"]
    d = dict(zip(keys, r))
    d["config"] = json.loads(d["config"])
    d["channels"] = json.loads(d["channels"])
    d["state"] = json.loads(d["state"] or "{}")
    d["expires"] = d["expires"].isoformat() if d["expires"] else None
    d["created"] = d["created"].isoformat(timespec="seconds")
    return d


SELECT = ("SELECT id, kind, symbol, ticker, name, config, tf, frequency, channels, message, status, expires, "
          "created, last_fired, fire_count, state FROM alerts")


def list_alerts() -> list[dict]:
    return [_row(r) for r in get_conn().execute(SELECT + " ORDER BY created DESC").fetchall()]


def get_alert(alert_id: str) -> dict | None:
    r = get_conn().execute(SELECT + " WHERE id = ?", [alert_id]).fetchone()
    return _row(r) if r else None


def save_alert(a: dict) -> dict:
    con = get_conn()
    aid = a.get("id") or uuid.uuid4().hex[:12]
    existing = get_alert(aid)
    con.execute(
        "INSERT OR REPLACE INTO alerts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            aid, a["kind"], a.get("symbol"), a.get("ticker"), a.get("name", ""), json.dumps(a.get("config", {})),
            a.get("tf"), a.get("frequency", "once"), json.dumps(a.get("channels", ["app"])), a.get("message", ""),
            a.get("status", "active"), a.get("expires"),
            datetime.fromisoformat(existing["created"]) if existing else datetime.now(),
            existing["last_fired"] if existing and a.get("status") != "active" else None,
            existing["fire_count"] if existing else 0,
            json.dumps({} if a.get("reset_state", True) else (existing or {}).get("state", {})),
        ],
    )
    return get_alert(aid)


def delete_alert(alert_id: str) -> None:
    get_conn().execute("DELETE FROM alerts WHERE id = ?", [alert_id])


def list_events(limit: int = 200) -> list[dict]:
    rows = get_conn().execute(
        "SELECT id, alert_id, time, symbol, title, body, delivered FROM alert_events ORDER BY time DESC LIMIT ?",
        [limit],
    ).fetchall()
    return [
        {"id": i, "alert_id": a, "time": t, "symbol": s, "title": ti, "body": b, "delivered": json.loads(d)}
        for i, a, t, s, ti, b, d in rows
    ]


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
    async def fire(self, alert: dict, title: str, body: str, bar_time: int | None = None) -> None:
        now = now_ist()
        if not should_fire(alert["frequency"], alert["last_fired"], now, bar_time, alert["state"].get("last_bar")):
            return
        event = {"type": "alert", "alert_id": alert["id"], "symbol": alert.get("symbol"), "title": title,
                 "body": body, "time": now}
        delivered = await notify.deliver(alert["channels"], title, body, lambda: self.hub.broadcast(event))
        con = get_conn()
        state = {**alert["state"], "last_bar": bar_time}
        status = "triggered" if alert["frequency"] == "once" else alert["status"]
        con.execute(
            "UPDATE alerts SET last_fired = ?, fire_count = fire_count + 1, status = ?, state = ? WHERE id = ?",
            [now, status, json.dumps(state), alert["id"]],
        )
        con.execute(
            "INSERT INTO alert_events VALUES (?, ?, ?, ?, ?, ?, ?)",
            [uuid.uuid4().hex[:12], alert["id"], now, alert.get("symbol"), title, body, json.dumps(delivered)],
        )
        alert.update(last_fired=now, status=status, state=state)
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
            get_conn().execute("UPDATE alerts SET status = 'expired' WHERE id = ?", [a["id"]])
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
            get_conn().execute("UPDATE alerts SET state = ? WHERE id = ?", [json.dumps(state), a["id"]])
            a["state"] = state
            if len(df) < 30 or int(df["time"].iloc[-1]) != closed:
                continue  # no bar for this period (holiday) or not enough data
            matched, details = scanner.evaluate(df, a["config"]["conditions"])
            if matched:
                body = "; ".join(details) + (f". {a['message']}" if a["message"] else "")
                await self.fire(a, f"{a['ticker']} {a['tf']}: conditions met", body, bar_time=closed)

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
        members = await universes.members(cfg["universe"], cfg.get("custom", []))
        matches: dict[str, list[str]] = {}
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
        previous = set(a["state"].get("matches", []))
        new = sorted(set(matches) - previous)
        state = {**a["state"], "ran_on": today, "matches": sorted(matches)}
        get_conn().execute("UPDATE alerts SET state = ? WHERE id = ?", [json.dumps(state), a["id"]])
        a["state"] = state
        if new:
            lines = [f"{t}: {'; '.join(matches[t])}" for t in new[:30]]
            more = f"\n…and {len(new) - 30} more" if len(new) > 30 else ""
            await self.fire(a, f"Scan '{a['name'] or cfg['universe']}': {len(new)} new", "\n".join(lines) + more)


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
