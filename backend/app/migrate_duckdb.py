"""One-time import of app data from older versions, which kept everything in
the DuckDB file, into the app database (Postgres/Neon).

Runs on startup and records `imported_duckdb` in app_meta so it never runs
twice. Data that had no owner (watchlists, drawings, alerts, backtests) is
given to the first admin. Market data stays in DuckDB.
"""

import json
import logging
from datetime import datetime

import sqlalchemy as sa

from app import db, store

log = logging.getLogger(__name__)
FLAG = "imported_duckdb"


def _tables(con) -> set[str]:
    return {r[0] for r in con.execute("SELECT table_name FROM information_schema.tables").fetchall()}


def _rows(con, sql: str) -> list[dict]:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def _json(v):
    if v is None or isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return v


def run() -> dict:
    if store.get_meta(FLAG):
        return {}
    con = db.get_conn()
    have = _tables(con)
    counts: dict[str, int] = {}
    if "users" not in have or not con.execute("SELECT count(*) FROM users").fetchone()[0]:
        store.set_meta(FLAG, datetime.now().isoformat(timespec="seconds"))
        return counts

    old_users = _rows(con, "SELECT * FROM users ORDER BY created")
    with store.tx() as c:
        existing = {r[0] for r in c.execute(sa.select(store.users.c.username))}
        for u in old_users:
            if u["username"] in existing:
                continue
            c.execute(sa.insert(store.users).values(
                username=u["username"], password_hash=u["password_hash"], role=u.get("role") or "user",
                email=u.get("email"), disabled=bool(u.get("disabled")), created=u["created"],
                last_login=u.get("last_login"), created_by=u.get("created_by"),
            ))
        counts["users"] = len(old_users)
        admins = [r[0] for r in c.execute(
            sa.select(store.users.c.username).where(store.users.c.role == "admin").order_by(store.users.c.created))]
        owner = admins[0] if admins else old_users[0]["username"]

        if "tokens" in have:
            for t in _rows(con, "SELECT * FROM tokens"):
                c.execute(sa.delete(store.app_tokens).where(store.app_tokens.c.provider == t["provider"]))
                c.execute(sa.insert(store.app_tokens).values(
                    provider=t["provider"], access_token=t["access_token"], expires_at=t["expires_at"]))
        if "watchlists" in have:
            wl = _rows(con, "SELECT * FROM watchlists")
            for w in wl:
                c.execute(sa.insert(store.watchlists).values(
                    id=w["id"], owner=owner, name=w["name"], items=_json(w["items"]), position=w["position"],
                    updated=w["updated"]))
            counts["watchlists"] = len(wl)
        if "drawings" in have:
            dr = _rows(con, "SELECT * FROM drawings")
            for d in dr:
                c.execute(sa.insert(store.drawings).values(
                    owner=owner, symbol=d["symbol"], data=_json(d["data"]), updated=d["updated"]))
            counts["drawings"] = len(dr)
        if "alerts" in have:
            al = _rows(con, "SELECT * FROM alerts")
            for a in al:
                c.execute(sa.insert(store.alerts).values(
                    id=a["id"], owner=owner, kind=a["kind"], symbol=a["symbol"], ticker=a["ticker"], name=a["name"],
                    config=_json(a["config"]), tf=a["tf"], frequency=a["frequency"], channels=_json(a["channels"]),
                    message=a["message"], status=a["status"], expires=a["expires"], created=a["created"],
                    last_fired=a["last_fired"], fire_count=a["fire_count"] or 0, state=_json(a["state"]) or {}))
            counts["alerts"] = len(al)
        if "alert_events" in have:
            ev = _rows(con, "SELECT * FROM alert_events")
            for e in ev:
                c.execute(sa.insert(store.alert_events).values(
                    id=e["id"], owner=owner, alert_id=e["alert_id"], time=e["time"], symbol=e["symbol"],
                    title=e["title"], body=e["body"], delivered=_json(e["delivered"])))
            counts["alert_events"] = len(ev)
        if "backtests" in have:
            bt = _rows(con, "SELECT * FROM backtests")
            for b in bt:
                c.execute(sa.insert(store.backtests).values(
                    id=b["id"], owner=owner, name=b["name"], created=b["created"], request=_json(b["request"]),
                    summary=_json(b["summary"]), result=_json(b["result"])))
            counts["backtests"] = len(bt)
        c.execute(sa.insert(store.app_meta).values(key=FLAG, value=datetime.now().isoformat(timespec="seconds")))
    log.info("Imported app data from DuckDB into the app database: %s (owner of shared data: %s)", counts, owner)
    return counts
