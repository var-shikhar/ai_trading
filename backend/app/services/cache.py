"""Keep the DuckDB market-data cache small.

Daily candles (and the weekly/monthly built from them) are kept forever.
Intraday candles are trimmed: the 15m base after INTRADAY_BASE_DAYS (+ a
margin), other intraday resolutions (1m, 5m, and natively fetched 30m-4h)
after SHORT_INTRADAY_DAYS. Coverage is moved forward so trimmed ranges are
re-fetched from Fyers if someone scrolls back to them later.
"""

import asyncio
import logging
from datetime import date, timedelta

from app.config import get_settings
from app.db import get_conn

log = logging.getLogger(__name__)

SHORT_INTRADAY_DAYS = 60
MARGIN_DAYS = 30
TRIM_EVERY_SECONDS = 24 * 3600


def stats() -> dict:
    con = get_conn()
    s = get_settings()
    by_res = con.execute(
        "SELECT resolution, count(*), count(DISTINCT symbol), min(ts), max(ts) FROM candles GROUP BY 1 ORDER BY 1"
    ).fetchall()
    size = s.db_file.stat().st_size if s.db_file.exists() else 0
    return {
        "file_mb": round(size / 1e6, 1),
        "candles": [
            {"resolution": r, "rows": n, "symbols": syms, "from": a.isoformat() if a else None,
             "to": b.isoformat() if b else None}
            for r, n, syms, a, b in by_res
        ],
        "instruments": con.execute("SELECT count(*) FROM instruments").fetchone()[0],
        "policy": {
            "daily": "kept",
            "15m_days": s.intraday_base_days + MARGIN_DAYS,
            "other_intraday_days": SHORT_INTRADAY_DAYS,
        },
    }


def trim(today: date | None = None) -> dict:
    today = today or date.today()
    s = get_settings()
    cutoffs = {"15": today - timedelta(days=s.intraday_base_days + MARGIN_DAYS)}
    short = today - timedelta(days=SHORT_INTRADAY_DAYS)
    con = get_conn()
    resolutions = [r[0] for r in con.execute("SELECT DISTINCT resolution FROM candles").fetchall()]
    removed = {}
    for res in resolutions:
        if res in ("D", "1D"):
            continue
        cutoff = cutoffs.get(res, short)
        n = con.execute("SELECT count(*) FROM candles WHERE resolution = ? AND ts < ?", [res, cutoff]).fetchone()[0]
        if n:
            con.execute("DELETE FROM candles WHERE resolution = ? AND ts < ?", [res, cutoff])
            removed[res] = n
        con.execute(
            "UPDATE coverage SET covered_from = ? WHERE resolution = ? AND covered_from < ?", [cutoff, res, cutoff]
        )
        # Coverage that ended before the cutoff now covers nothing: drop it.
        con.execute("DELETE FROM coverage WHERE resolution = ? AND covered_to < covered_from", [res])
    if removed:
        con.execute("CHECKPOINT")  # return freed space to the file
        log.info("Trimmed market-data cache: %s", removed)
    return {"removed": removed}


async def trim_forever() -> None:
    while True:
        try:
            await asyncio.to_thread(trim)
        except Exception:
            log.exception("cache trim failed")
        await asyncio.sleep(TRIM_EVERY_SECONDS)
