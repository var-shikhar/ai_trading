"""Daily bars for every NSE stock, so a scan can cover the whole market.

Scanning ~2,000 stocks can't ask Fyers for each one on every scan (150
calls/min). Instead this job keeps the DuckDB cache current:

  1. History: the daily bars a scan needs (`BARS`) for every NSE equity,
     through the candle service, so only what is missing is fetched. The
     first run takes ~25 minutes (two calls per stock); later runs add a day
     only for stocks the quotes step couldn't cover.
  2. Today: the day's bar for all of them from the quotes API (50 stocks per
     call, under a minute), stored as that day's daily candle.

A stock whose previous close (from the quote) disagrees with the stored
close had a split/bonus or a gap in our data: its stored history is dropped
and refetched, so indicators don't see a fake crash.

Scans of the "nse_liquid" universe then read the cache only (max_age). The
job runs by itself after the close on trading days and can be started from
the Screener.
"""

import asyncio
import logging
import time as clock
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from app.db import get_conn
from app.providers.base import AuthRequired, Candle
from app.providers.fyers import now_ist
from app.services.candles import CandleService

log = logging.getLogger(__name__)

BARS = 400  # same depth scans use (EMA 200 settles, 52-week lookback)
CONCURRENCY = 4
QUOTES_CHUNK = 50
AUTO_AFTER = time(15, 50)  # IST: after the NSE close, bars are final
CHECK_EVERY_SECONDS = 600
SPLIT_TOLERANCE = 0.03  # quote prev close vs stored close
# A whole-market scan accepts cached bars up to this old (no API calls).
SCAN_MAX_AGE = 36 * 3600

# "Liquid": tradeable names only. Rs 1 crore average daily traded value and
# a price of at least Rs 20 leave roughly 1,000 of ~2,000 NSE equities.
MIN_PRICE = 20.0
MIN_TRADED_VALUE = 1e7
MIN_BARS = 50
LIQUIDITY_BARS = 20


@dataclass
class SyncState:
    status: str = "idle"  # idle | running | done | error
    phase: str = ""  # history | today
    done: int = 0
    total: int = 0
    message: str = ""
    started: float | None = None
    finished: float | None = None
    last_success: str | None = None  # ISO date of the last trading day fully synced
    errors: list[str] = field(default_factory=list)


_state = SyncState()
_task: asyncio.Task | None = None


def nse_equities() -> list[tuple[str, str, str]]:
    """(symbol, ticker, name) of every NSE equity in series EQ."""
    return get_conn().execute(
        "SELECT symbol, ticker, name FROM instruments "
        "WHERE exchange = 'NSE' AND kind = 'EQ' AND symbol LIKE '%-EQ' ORDER BY ticker"
    ).fetchall()


def liquid_members() -> list[dict]:
    """NSE equities with enough history, price and traded value (from the cache)."""
    rows = get_conn().execute(
        f"""
        WITH eq AS (
            SELECT symbol, ticker, name FROM instruments
            WHERE exchange = 'NSE' AND kind = 'EQ' AND symbol LIKE '%-EQ'
        ),
        bars AS (
            SELECT c.symbol, c.close, c.volume,
                   row_number() OVER (PARTITION BY c.symbol ORDER BY c.ts DESC) AS rn,
                   count(*) OVER (PARTITION BY c.symbol) AS n
            FROM candles c JOIN eq USING (symbol)
            WHERE c.resolution = 'D'
        )
        SELECT eq.symbol, eq.ticker, eq.name
        FROM bars JOIN eq USING (symbol)
        WHERE rn <= {LIQUIDITY_BARS}
        GROUP BY eq.symbol, eq.ticker, eq.name, n
        HAVING n >= ? AND arg_min(close, rn) >= ? AND avg(close * volume) >= ?
        ORDER BY eq.ticker
        """,
        [MIN_BARS, MIN_PRICE, MIN_TRADED_VALUE],
    ).fetchall()
    return [{"symbol": s, "ticker": t, "name": n, "industry": ""} for s, t, n in rows]


def coverage_summary() -> dict:
    con = get_conn()
    total = len(nse_equities())
    stored, latest = con.execute(
        """SELECT count(*), max(covered_to) FROM coverage
           WHERE resolution = 'D' AND symbol IN (
               SELECT symbol FROM instruments WHERE exchange = 'NSE' AND kind = 'EQ' AND symbol LIKE '%-EQ')"""
    ).fetchone()
    return {
        "equities": total,
        "stored": stored,
        "latest_bar": latest.isoformat() if latest else None,
        "liquid": len(liquid_members()) if stored else 0,
    }


def status() -> dict:
    s = asdict(_state)
    s["errors"] = s["errors"][-10:]
    elapsed = (_state.finished or clock.time()) - _state.started if _state.started else 0
    rate = _state.done / elapsed if elapsed > 0 and _state.done else 0
    s["eta_seconds"] = round((_state.total - _state.done) / rate) if rate and _state.status == "running" else None
    return {**s, **coverage_summary()}


def start(service: CandleService) -> bool:
    """Start a sync unless one is running. False if already running."""
    global _task
    if _task and not _task.done():
        return False
    _task = asyncio.create_task(_run(service))
    return True


def previous_weekday(d: date) -> date:
    d -= timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


async def _run(service: CandleService) -> None:
    _state.__dict__.update(asdict(SyncState(last_success=_state.last_success)))
    _state.status, _state.started = "running", clock.time()
    symbols = [s for s, _, _ in nse_equities()]
    if not symbols:
        _state.status, _state.message = "error", "No NSE instruments yet: the symbol list is still loading."
        _state.finished = clock.time()
        return
    try:
        await _history(service, symbols)
        await _today(service, symbols)
        _state.status = "done"
        _state.message = f"{len(symbols)} NSE stocks up to date."
        _state.last_success = service._now().date().isoformat()
    except AuthRequired:
        _state.status, _state.message = "error", "Fyers login expired: connect again and re-run."
    except asyncio.CancelledError:
        _state.status, _state.message = "error", "Stopped."
        raise
    except Exception as e:
        log.exception("market sync failed")
        _state.status, _state.message = "error", str(e)
    finally:
        _state.finished = clock.time()


async def _history(service: CandleService, symbols: list[str]) -> None:
    """Bars up to the previous trading day (today comes from quotes)."""
    _state.phase, _state.done, _state.total = "history", 0, len(symbols)
    # The candle service's clock, so "today" means the same to both.
    end = previous_weekday(service._now().date())
    sem = asyncio.Semaphore(CONCURRENCY)
    auth_failed = asyncio.Event()

    async def one(symbol: str) -> None:
        async with sem:
            if auth_failed.is_set():
                return
            try:
                await service.get_candles(symbol, "1D", BARS, end=end)
            except AuthRequired:
                auth_failed.set()
            except Exception as e:  # one bad symbol shouldn't stop the sync
                _state.errors.append(f"{symbol}: {e}")
            finally:
                _state.done += 1

    await asyncio.gather(*(one(s) for s in symbols))
    if auth_failed.is_set():
        raise AuthRequired("Fyers login required")


async def _today(service: CandleService, symbols: list[str]) -> None:
    _state.phase, _state.done, _state.total = "today", 0, len(symbols)
    for i in range(0, len(symbols), QUOTES_CHUNK):
        chunk = symbols[i : i + QUOTES_CHUNK]
        quotes = await service.provider.get_quotes(chunk)
        # Same clock as the candle service's coverage checks.
        now = service._now()
        for symbol, q in quotes.items():
            store_quote_bar(service, symbol, q, now)
        _state.done += len(chunk)


def store_quote_bar(service: CandleService, symbol: str, q: dict, now: datetime) -> None:
    """Save a quote as its day's daily candle and move coverage up to it."""
    if not q.get("time") or not q.get("ltp") or q.get("open") in (None, 0):
        return
    # quote["time"] is IST wall time as epoch (see the provider).
    day = datetime.fromtimestamp(q["time"], timezone.utc).date()
    con = get_conn()
    row = con.execute(
        "SELECT arg_max(close, ts) FROM candles WHERE symbol = ? AND resolution = 'D' AND ts < ?",
        [symbol, datetime.combine(day, time.min)],
    ).fetchone()
    stored_close = row[0] if row else None
    prev = q.get("prev_close")
    if stored_close and prev and abs(prev / stored_close - 1) > SPLIT_TOLERANCE:
        # Split/bonus (history adjusted since we stored it) or missing days:
        # drop it; the next sync's history step fetches it again in full.
        con.execute("DELETE FROM candles WHERE symbol = ? AND resolution = 'D'", [symbol])
        con.execute("DELETE FROM coverage WHERE symbol = ? AND resolution = 'D'", [symbol])
        log.info("market sync: %s prev close %s != stored %s, refetching history", symbol, prev, stored_close)
        return
    cov = con.execute(
        "SELECT covered_from, covered_to FROM coverage WHERE symbol = ? AND resolution = 'D'", [symbol]
    ).fetchone()
    if cov is None or cov[1] < previous_weekday(day):
        return  # history doesn't reach the day before: leave it to the history step
    bar = Candle(
        datetime.combine(day, time.min),
        float(q["open"]),
        float(max(q.get("high") or q["ltp"], q["ltp"])),
        float(min(q.get("low") or q["ltp"], q["ltp"])),
        float(q["ltp"]),
        int(q.get("volume") or 0),
    )
    service._store(symbol, "D", [bar])
    con.execute(
        "INSERT OR REPLACE INTO coverage VALUES (?, 'D', ?, ?, ?)",
        [symbol, cov[0], max(cov[1], day), now],
    )


async def auto_sync_forever(service: CandleService) -> None:
    """After the close on weekdays, sync once (if Fyers is connected)."""
    while True:
        await asyncio.sleep(CHECK_EVERY_SECONDS)
        try:
            now = now_ist()
            due = now.weekday() < 5 and now.time() >= AUTO_AFTER and _state.last_success != now.date().isoformat()
            if due and _state.status != "running" and service.provider.is_authenticated():
                log.info("market sync: starting the daily run")
                start(service)
        except Exception:
            log.exception("market sync scheduler")
