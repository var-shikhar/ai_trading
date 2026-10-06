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
        }
    )
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


def search(query: str, limit: int = 20) -> list[dict]:
    q = query.strip().upper()
    if not q:
        return []
    rows = get_conn().execute(
        """
        SELECT symbol, ticker, name, kind FROM instruments
        WHERE upper(ticker) LIKE '%' || ? || '%' OR upper(name) LIKE '%' || ? || '%'
        ORDER BY
            CASE WHEN upper(ticker) = ? THEN 0
                 WHEN upper(ticker) LIKE ? || '%' THEN 1
                 WHEN upper(name) LIKE ? || '%' THEN 2
                 ELSE 3 END,
            CASE kind WHEN 'INDEX' THEN 0 WHEN 'EQ' THEN 1 ELSE 2 END,
            length(ticker)
        LIMIT ?
        """,
        [q, q, q, q, q, limit],
    ).fetchall()
    return [{"symbol": s, "ticker": t, "name": n, "kind": k} for s, t, n, k in rows]
