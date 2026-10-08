import logging
from datetime import date

import pandas as pd

from app.db import get_conn
from app.providers.base import MarketDataProvider

log = logging.getLogger(__name__)


def last_refresh(provider: str) -> date | None:
    row = get_conn().execute(
        "SELECT max(updated) FROM instruments WHERE provider = ?", [provider]
    ).fetchone()
    return row[0]


async def refresh_instruments(provider: MarketDataProvider) -> int:
    instruments = await provider.fetch_instruments()
    df = pd.DataFrame(
        {
            "symbol": [i.symbol for i in instruments],
            "ticker": [i.ticker for i in instruments],
            "name": [i.name for i in instruments],
            "exchange": [i.exchange for i in instruments],
            "kind": [i.kind for i in instruments],
            "lot_size": [i.lot_size for i in instruments],
            "tick_size": [i.tick_size for i in instruments],
            "provider": provider.name,
            "updated": date.today(),
            "expiry": [i.expiry for i in instruments],
            "underlying": [i.underlying for i in instruments],
            "session_start": [i.session_start for i in instruments],
            "session_end": [i.session_end for i in instruments],
            "actual": [i.actual for i in instruments],
        }
    )
    # pandas makes an all-None column 'object'; DuckDB needs a real type.
    df["expiry"] = pd.to_datetime(df["expiry"]).dt.date
    con = get_conn()
    con.execute("BEGIN")
    try:
        con.execute("DELETE FROM instruments WHERE provider = ?", [provider.name])
        con.register("new_instruments", df)
        con.execute("INSERT INTO instruments SELECT * FROM new_instruments")
        con.unregister("new_instruments")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    log.info("Loaded %d %s instruments", len(df), provider.name)
    return len(df)


async def refresh_if_stale(provider: MarketDataProvider) -> None:
    """Symbol masters change daily (listings, delistings, ticker changes)."""
    if last_refresh(provider.name) == date.today():
        return
    try:
        await refresh_instruments(provider)
    except Exception:
        log.exception("Instrument refresh failed for %s", provider.name)


KINDS = {"EQ", "ETF", "INDEX", "FUT", "COM"}


def search(query: str, limit: int = 20, kind: str | None = None) -> list[dict]:
    """Ranked symbol search. Matches on ticker, name or the futures'
    underlying; continuous futures (NIFTY1!) rank above dated contracts,
    and dated contracts by nearest expiry."""
    q = query.strip().upper()
    if not q:
        return []
    kind_filter = "AND kind = ?" if kind in KINDS else ""
    params = [q, q, q] + ([kind] if kind_filter else []) + [q, q, q, q, limit]
    rows = get_conn().execute(
        f"""
        SELECT symbol, ticker, name, kind, exchange, expiry FROM instruments
        WHERE (upper(ticker) LIKE '%' || ? || '%' OR upper(name) LIKE '%' || ? || '%'
               OR upper(underlying) = ?)
          {kind_filter}
        ORDER BY
            CASE WHEN upper(ticker) = ? OR upper(underlying) = ? THEN 0
                 WHEN upper(ticker) LIKE ? || '%' THEN 1
                 WHEN upper(name) LIKE ? || '%' THEN 2
                 ELSE 3 END,
            CASE kind WHEN 'INDEX' THEN 0 WHEN 'EQ' THEN 1 WHEN 'FUT' THEN 2 WHEN 'COM' THEN 3 ELSE 4 END,
            CASE WHEN actual IS NOT NULL THEN 0 ELSE 1 END,
            expiry NULLS FIRST,
            CASE exchange WHEN 'NSE' THEN 0 WHEN 'MCX' THEN 1 ELSE 2 END,
            length(ticker)
        LIMIT ?
        """,
        params,
    ).fetchall()
    return [
        {"symbol": s, "ticker": t, "name": n, "kind": k, "exchange": e, "expiry": x.isoformat() if x else None}
        for s, t, n, k, e, x in rows
    ]
