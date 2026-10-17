"""Hybrid candle lookup.

Each chart timeframe is either resampled from a stored base resolution or
fetched natively from the provider:

  15m, 30m, 1h, 2h, 4h  <- resampled from 15m base candles kept for
                           `intraday_base_days`; older ranges fall back to
                           the timeframe's own candles fetched from the API
  1D, 1W, 1M            <- resampled from daily candles (any range)
  1m, 5m                <- fetched natively on demand (no base)

Data is fetched lazily: only for symbols and ranges actually requested, and
only the part not already covered (see the `coverage` table).

Intraday buckets start at each instrument's session open (NSE/BSE 09:15,
MCX 09:00), so e.g. MCX hourly bars are 09:00, 10:00, ... like the exchange's.
Continuous futures aliases (NSE:NIFTY1!) are fetched from the current front
contract but stored under the alias, so the chart survives expiries.
"""

import asyncio
import math
from calendar import timegm
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

import pandas as pd

from app.config import Settings
from app.db import get_conn
from app.providers.base import Candle, MarketDataProvider

@dataclass(frozen=True)
class Session:
    start: time
    end: time

    @property
    def minutes(self) -> int:
        return (self.end.hour * 60 + self.end.minute) - (self.start.hour * 60 + self.start.minute)

    @property
    def origin(self) -> str:
        """time_bucket origin: a Monday at session open."""
        return f"TIMESTAMP '2000-01-03 {self.start:%H:%M}:00'"

    @property
    def final_after(self) -> time:
        """A little after the close, when the day's last candle is final."""
        minutes = min(self.end.hour * 60 + self.end.minute + 15, 23 * 60 + 59)
        return time(minutes // 60, minutes % 60)


NSE_SESSION = Session(time(9, 15), time(15, 30))
MCX_SESSION = Session(time(9, 0), time(23, 30))


@dataclass(frozen=True)
class Timeframe:
    native: str  # provider resolution code when fetched directly
    base: str | None  # stored base resolution it is resampled from
    bucket: str | None  # DuckDB time_bucket interval when resampling
    minutes: int | None  # intraday bar length; None for daily and above
    days_per_bar: float = 1  # daily+ bars: trading days per bar


TIMEFRAMES: dict[str, Timeframe] = {
    "1m": Timeframe("1", None, None, 1),
    "5m": Timeframe("5", None, None, 5),
    "15m": Timeframe("15", "15", None, 15),
    "30m": Timeframe("30", "15", "30 minutes", 30),
    "1h": Timeframe("60", "15", "1 hour", 60),
    "2h": Timeframe("120", "15", "2 hours", 120),
    "4h": Timeframe("240", "15", "4 hours", 240),
    "1D": Timeframe("D", "D", None, None),
    "1W": Timeframe("D", "D", "1 week", None, 5),
    "1M": Timeframe("D", "D", "1 month", None, 21),
}


def estimate_start(tf: Timeframe, limit: int, end: date, session: Session = NSE_SESSION) -> date:
    """Calendar start date that should yield at least `limit` bars."""
    bars_per_day = session.minutes / tf.minutes if tf.minutes else 1 / tf.days_per_bar
    trading_days = math.ceil(limit / bars_per_day)
    calendar_days = math.ceil(trading_days * 7 / 5 * 1.1) + 7  # weekends + holidays
    return end - timedelta(days=calendar_days)


class CandleService:
    def __init__(self, provider: MarketDataProvider, settings: Settings, now=None):
        self.provider = provider
        self.settings = settings
        self._now = now or datetime.now
        self._locks: dict[tuple[str, str], asyncio.Lock] = {}

    def instrument_info(self, symbol: str) -> tuple[str, Session]:
        """(symbol to fetch from the provider, trading session) for `symbol`."""
        row = get_conn().execute(
            "SELECT actual, session_start, session_end FROM instruments WHERE symbol = ?", [symbol]
        ).fetchone()
        default = MCX_SESSION if symbol.startswith("MCX:") else NSE_SESSION
        if row is None:
            return symbol, default
        actual, start, end = row
        try:
            session = Session(time.fromisoformat(start), time.fromisoformat(end))
            if session.minutes <= 0:
                session = default
        except (TypeError, ValueError):
            session = default
        return actual or symbol, session

    async def get_candles(
        self, symbol: str, tf_name: str, limit: int, end: date | None = None, max_age: float | None = None
    ) -> list[dict]:
        """`max_age` (seconds): accept stored daily bars fetched that recently
        without asking the provider for newer ones (whole-market scans read
        the cache that the market sync keeps current)."""
        tf = TIMEFRAMES[tf_name]
        source, session = self.instrument_info(symbol)
        today = self._now().date()
        end = min(end or today, today)
        start = estimate_start(tf, limit, end, session)
        # Start on a bucket boundary so the first weekly/monthly bar is complete.
        if tf.bucket == "1 week":
            start -= timedelta(days=start.weekday())
        elif tf.bucket == "1 month":
            start = start.replace(day=1)

        if tf.base is None or (tf.base == tf.native and tf.bucket is None):
            # Native-only (1m, 5m) or the base itself (15m, 1D).
            await self.ensure(symbol, tf.native, start, end, source, session, max_age)
            rows = self._query(symbol, tf.native, None, start, end, session)
        elif tf.base == "D":
            await self.ensure(symbol, "D", start, end, source, session, max_age)
            rows = self._query(symbol, "D", tf.bucket, start, end, session)
        else:
            # Intraday derived from 15m: base inside the window, native before it.
            window_start = today - timedelta(days=self.settings.intraday_base_days)
            rows = []
            if start < window_start:
                older_end = min(window_start - timedelta(days=1), end)
                await self.ensure(symbol, tf.native, start, older_end, source, session)
                rows += self._query(symbol, tf.native, None, start, older_end, session)
            base_start = max(start, window_start)
            if base_start <= end:
                await self.ensure(symbol, tf.base, base_start, end, source, session)
                rows += self._query(symbol, tf.base, tf.bucket, base_start, end, session)

        return [
            # IST wall time sent as UTC epoch so the chart labels show IST.
            {"time": timegm(ts.timetuple()), "open": o, "high": h, "low": l, "close": c, "volume": v}
            for ts, o, h, l, c, v in rows[-limit:]
        ]

    async def ensure(
        self,
        symbol: str,
        resolution: str,
        start: date,
        end: date,
        source: str | None = None,
        session: Session = NSE_SESSION,
        max_age: float | None = None,
    ) -> None:
        """Fetch whatever part of [start, end] isn't stored yet. `source` is
        the provider symbol to fetch (differs from `symbol` for aliases)."""
        source = source or symbol
        lock = self._locks.setdefault((symbol, resolution), asyncio.Lock())
        async with lock:
            con = get_conn()
            cov = con.execute(
                "SELECT covered_from, covered_to, fetched_at FROM coverage "
                "WHERE symbol = ? AND resolution = ?",
                [symbol, resolution],
            ).fetchone()

            now = self._now()
            if (
                max_age is not None
                and cov is not None
                and start >= cov[0]
                and (now - cov[2]).total_seconds() < max_age
            ):
                return
            if cov is None:
                ranges = [(start, end)]
            else:
                cov_from, cov_to, fetched_at = cov
                ranges = []
                if start < cov_from:
                    ranges.append((start, cov_from))
                # Past days are final; only re-fetch the last covered day if it
                # was still in progress when fetched and the refresh interval passed.
                last_day_final = (
                    fetched_at.date() > cov_to
                    or cov_to.weekday() >= 5
                    or (fetched_at.date() == cov_to and fetched_at.time() >= session.final_after)
                )
                stale = (now - fetched_at).total_seconds() >= self.settings.refresh_seconds
                if end > cov_to or (end == cov_to and not last_day_final and stale):
                    ranges.append((cov_to, end))

            for r_start, r_end in ranges:
                candles = await self.provider.get_history(source, resolution, r_start, r_end)
                self._store(symbol, resolution, candles)

            if ranges:
                new_from = min(start, cov[0]) if cov else start
                new_to = max(end, cov[1]) if cov else end
                # fetched_at tracks when the latest covered day was last fetched.
                fetched_at = now if any(r_end == new_to for _, r_end in ranges) else cov[2]
                con.execute(
                    "INSERT OR REPLACE INTO coverage VALUES (?, ?, ?, ?, ?)",
                    [symbol, resolution, new_from, new_to, fetched_at],
                )

    def _store(self, symbol: str, resolution: str, candles: list[Candle]) -> None:
        if not candles:
            return
        df = pd.DataFrame(
            {
                "symbol": symbol,
                "resolution": resolution,
                "ts": [c.ts for c in candles],
                "open": [c.open for c in candles],
                "high": [c.high for c in candles],
                "low": [c.low for c in candles],
                "close": [c.close for c in candles],
                "volume": [c.volume for c in candles],
            }
        )
        con = get_conn()
        con.register("new_candles", df)
        con.execute("INSERT OR REPLACE INTO candles SELECT * FROM new_candles")
        con.unregister("new_candles")

    def _query(
        self,
        symbol: str,
        resolution: str,
        bucket: str | None,
        start: date,
        end: date,
        session: Session = NSE_SESSION,
    ) -> list[tuple]:
        params = [symbol, resolution, start, end + timedelta(days=1)]
        where = "symbol = ? AND resolution = ? AND ts >= ? AND ts < ?"
        con = get_conn()
        if bucket is None:
            return con.execute(
                f"SELECT ts, open, high, low, close, volume FROM candles WHERE {where} ORDER BY ts",
                params,
            ).fetchall()
        if bucket == "1 month":
            key = "date_trunc('month', ts)"
        elif bucket == "1 week":
            key = "date_trunc('week', ts)"  # ISO weeks start Monday
        else:
            key = f"time_bucket(INTERVAL '{bucket}', ts, {session.origin})"
        return con.execute(
            f"""
            SELECT {key} AS b, arg_min(open, ts), max(high), min(low), arg_max(close, ts), sum(volume)
            FROM candles WHERE {where}
            GROUP BY b ORDER BY b
            """,
            params,
        ).fetchall()
