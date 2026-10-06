"""DuckDB storage.

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
    symbol    VARCHAR PRIMARY KEY,   -- provider symbol, e.g. NSE:SBIN-EQ
    ticker    VARCHAR NOT NULL,      -- e.g. SBIN
    name      VARCHAR NOT NULL,
    exchange  VARCHAR NOT NULL,
    kind      VARCHAR NOT NULL,      -- EQ, ETF, INDEX
    lot_size  INTEGER NOT NULL,
    tick_size DOUBLE  NOT NULL,
    provider  VARCHAR NOT NULL,
    updated   DATE    NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
    provider     VARCHAR PRIMARY KEY,
    access_token VARCHAR   NOT NULL,
    expires_at   TIMESTAMP NOT NULL  -- IST
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
            _conn = duckdb.connect(str(db_file))
            _conn.execute(SCHEMA)
        return _conn.cursor()


def close_conn() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
