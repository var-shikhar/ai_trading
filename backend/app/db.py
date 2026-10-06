"""DuckDB storage for candles.

We store 1-minute (and daily) candles as fetched; higher timeframes are
resampled from these on read.
"""

import threading

import duckdb

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS candles (
    symbol     VARCHAR   NOT NULL,   -- e.g. NSE:SBIN-EQ
    resolution VARCHAR   NOT NULL,   -- '1' (minute) or 'D' (day)
    ts         TIMESTAMP NOT NULL,   -- candle open time, IST
    open       DOUBLE    NOT NULL,
    high       DOUBLE    NOT NULL,
    low        DOUBLE    NOT NULL,
    close      DOUBLE    NOT NULL,
    volume     BIGINT    NOT NULL,
    PRIMARY KEY (symbol, resolution, ts)
);

CREATE TABLE IF NOT EXISTS instruments (
    symbol      VARCHAR PRIMARY KEY, -- provider symbol, e.g. NSE:SBIN-EQ
    name        VARCHAR,
    exchange    VARCHAR,
    segment     VARCHAR,             -- CM, FO, CD, COMM
    lot_size    INTEGER,
    tick_size   DOUBLE,
    provider    VARCHAR NOT NULL
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
