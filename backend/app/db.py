"""DuckDB: the market-data cache (candles, coverage, instruments, index lists).

People and their data live in the app database (app.store).

DuckDB storage.

Candles are stored per provider resolution code ('15', 'D', '60', ...).
'15' and 'D' are the base resolutions other timeframes are resampled from;
other codes are only stored when fetched directly as a fallback.
"""

import threading

import duckdb

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
    symbol     VARCHAR   NOT NULL,   -- e.g. NSE:SBIN-EQ
    resolution VARCHAR   NOT NULL,   -- provider code: '15', '60', 'D', ...
    ts         TIMESTAMP NOT NULL,   -- candle open time, IST (daily: 00:00)
    open       DOUBLE    NOT NULL,
    high       DOUBLE    NOT NULL,
    low        DOUBLE    NOT NULL,
    close      DOUBLE    NOT NULL,
    volume     BIGINT    NOT NULL,
    PRIMARY KEY (symbol, resolution, ts)
);

-- Date range already fetched per (symbol, resolution), so we only call
-- the API for what is missing.
CREATE TABLE IF NOT EXISTS coverage (
    symbol       VARCHAR   NOT NULL,
    resolution   VARCHAR   NOT NULL,
    covered_from DATE      NOT NULL,
    covered_to   DATE      NOT NULL,
    fetched_at   TIMESTAMP NOT NULL, -- last time covered_to was refreshed
    PRIMARY KEY (symbol, resolution)
);

CREATE TABLE IF NOT EXISTS instruments (
    symbol        VARCHAR PRIMARY KEY, -- provider symbol, e.g. NSE:SBIN-EQ, or alias NSE:NIFTY1!
    ticker        VARCHAR NOT NULL,    -- e.g. SBIN, NIFTY26OCTFUT, NIFTY1!
    name          VARCHAR NOT NULL,
    exchange      VARCHAR NOT NULL,    -- NSE, BSE, MCX
    kind          VARCHAR NOT NULL,    -- EQ, ETF, INDEX, FUT (NSE futures), COM (MCX)
    lot_size      INTEGER NOT NULL,
    tick_size     DOUBLE  NOT NULL,
    provider      VARCHAR NOT NULL,
    updated       DATE    NOT NULL,
    expiry        DATE,                -- futures only
    underlying    VARCHAR,
    session_start VARCHAR NOT NULL,    -- 'HH:MM' IST
    session_end   VARCHAR NOT NULL,
    actual        VARCHAR              -- continuous aliases: the contract they point to
);

CREATE TABLE IF NOT EXISTS universe_members (
    universe VARCHAR NOT NULL,   -- e.g. nifty500
    ticker   VARCHAR NOT NULL,   -- NSE symbol, e.g. RELIANCE
    industry VARCHAR,
    updated  DATE    NOT NULL,
    PRIMARY KEY (universe, ticker)
);

"""

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return a per-call cursor on a single shared connection."""
    global _conn
    with _lock:
        if _conn is None:
            db_file = get_settings().db_file
            db_file.parent.mkdir(parents=True, exist_ok=True)
            settings = get_settings()
            _conn = duckdb.connect(
                str(db_file),
                config={"memory_limit": settings.db_memory_limit, "threads": settings.db_threads},
            )
            _migrate(_conn)
            _conn.execute(SCHEMA)
        return _conn.cursor()


def _migrate(conn: duckdb.DuckDBPyConnection) -> None:
    """instruments is a daily-refreshed cache: recreate it when its columns change."""
    cols = {r[0] for r in conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'instruments'"
    ).fetchall()}
    if cols and "actual" not in cols:
        conn.execute("DROP TABLE instruments")


def close_conn() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
