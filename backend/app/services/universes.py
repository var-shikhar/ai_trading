"""Symbol lists to scan: NSE index constituents (from niftyindices.com,
cached daily), F&O stocks, MCX commodities, or a custom ticker list."""

import csv
import io
import logging
from datetime import date

import httpx
import pandas as pd

from app.db import get_conn

log = logging.getLogger(__name__)

INDEX_URL = "https://www.niftyindices.com/IndexConstituent/{file}"
INDEX_LISTS = {
    "nifty50": ("Nifty 50", "ind_nifty50list.csv"),
    "niftynext50": ("Nifty Next 50", "ind_niftynext50list.csv"),
    "nifty100": ("Nifty 100", "ind_nifty100list.csv"),
    "nifty200": ("Nifty 200", "ind_nifty200list.csv"),
    "nifty500": ("Nifty 500", "ind_nifty500list.csv"),
    "midcap150": ("Nifty Midcap 150", "ind_niftymidcap150list.csv"),
    "smallcap250": ("Nifty Smallcap 250", "ind_niftysmallcap250list.csv"),
}
OTHER_LISTS = {"fno": "F&O stocks", "mcx": "MCX commodities (continuous)"}


def catalog() -> list[dict]:
    return [{"id": k, "name": v[0]} for k, v in INDEX_LISTS.items()] + [
        {"id": k, "name": v} for k, v in OTHER_LISTS.items()
    ] + [{"id": "custom", "name": "Custom list"}]


async def _download_index(universe: str, client: httpx.AsyncClient | None = None) -> list[tuple[str, str]]:
    """(ticker, industry) pairs for an NSE index."""
    _, file = INDEX_LISTS[universe]
    own = client is None
    client = client or httpx.AsyncClient(timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    try:
        resp = await client.get(INDEX_URL.format(file=file))
        resp.raise_for_status()
        rows = list(csv.DictReader(io.StringIO(resp.text)))
    finally:
        if own:
            await client.aclose()
    return [(r["Symbol"].strip(), r.get("Industry", "").strip()) for r in rows if r.get("Symbol")]


async def members(universe: str, custom: list[str] | None = None, client: httpx.AsyncClient | None = None) -> list[dict]:
    """Instruments in a universe: symbol, ticker, name, industry."""
    con = get_conn()
    if universe in INDEX_LISTS:
        cached = con.execute(
            "SELECT ticker, industry FROM universe_members WHERE universe = ? AND updated = ?",
            [universe, date.today()],
        ).fetchall()
        if not cached:
            pairs = await _download_index(universe, client)
            df = pd.DataFrame(pairs, columns=["ticker", "industry"]).assign(universe=universe, updated=date.today())
            con.execute("DELETE FROM universe_members WHERE universe = ?", [universe])
            con.register("new_members", df[["universe", "ticker", "industry", "updated"]])
            con.execute("INSERT INTO universe_members SELECT * FROM new_members")
            con.unregister("new_members")
            cached = pairs
        industry = dict(cached)
        rows = con.execute(
            f"""SELECT symbol, ticker, name FROM instruments
                WHERE exchange = 'NSE' AND kind = 'EQ' AND ticker IN ({",".join("?" * len(industry))})
                  AND symbol LIKE '%-EQ'""",
            list(industry),
        ).fetchall() if industry else []
        return [{"symbol": s, "ticker": t, "name": n, "industry": industry.get(t, "")} for s, t, n in rows]

    if universe == "fno":
        rows = con.execute(
            """SELECT symbol, ticker, name FROM instruments
               WHERE exchange = 'NSE' AND kind = 'EQ' AND symbol LIKE '%-EQ' AND ticker IN (
                   SELECT DISTINCT underlying FROM instruments WHERE kind = 'FUT' AND exchange = 'NSE')"""
        ).fetchall()
    elif universe == "mcx":
        rows = con.execute(
            "SELECT symbol, ticker, name FROM instruments WHERE exchange = 'MCX' AND actual IS NOT NULL"
        ).fetchall()
    elif universe == "custom":
        tickers = [t.strip().upper() for t in (custom or []) if t.strip()]
        if not tickers:
            return []
        marks = ",".join("?" * len(tickers))
        # Accept full symbols (NSE:SBIN-EQ, NIFTY1!) or bare NSE tickers (SBIN).
        rows = con.execute(
            f"SELECT symbol, ticker, name FROM instruments WHERE upper(symbol) IN ({marks}) OR upper(ticker) IN ({marks})",
            tickers * 2,
        ).fetchall()
        # Prefer the NSE equity when a bare ticker matches several instruments.
        best: dict[str, tuple] = {}
        for s, t, n in rows:
            key = t.upper()
            if key not in best or s.startswith("NSE:") and s.endswith("-EQ"):
                best[key] = (s, t, n)
        rows = list(best.values())
    else:
        raise KeyError(universe)
    return [{"symbol": s, "ticker": t, "name": n, "industry": ""} for s, t, n in rows]
