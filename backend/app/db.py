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

CREATE TABLE IF NOT EXISTS watchlists (
    id       VARCHAR PRIMARY KEY,
    name     VARCHAR   NOT NULL,
    items    VARCHAR   NOT NULL,     -- JSON list of {symbol, ticker, name, kind, exchange}
    position INTEGER   NOT NULL,
    updated  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS drawings (
    symbol  VARCHAR PRIMARY KEY,
    data    VARCHAR   NOT NULL,      -- JSON list, format owned by the frontend
    updated TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS backtests (
    id      VARCHAR PRIMARY KEY,
    name    VARCHAR   NOT NULL,
    created TIMESTAMP NOT NULL,
    request VARCHAR   NOT NULL,      -- JSON strategy definition
    summary VARCHAR   NOT NULL,      -- JSON headline stats (for the history list)
    result  VARCHAR   NOT NULL       -- JSON full result (equity, trades, ...)
);

CREATE TABLE IF NOT EXISTS alerts (
    id         VARCHAR PRIMARY KEY,
    kind       VARCHAR   NOT NULL,   -- price | drawing | condition | scan
    symbol     VARCHAR,
    ticker     VARCHAR,
    name       VARCHAR,
    config     VARCHAR   NOT NULL,   -- JSON rule
    tf         VARCHAR,
    frequency  VARCHAR   NOT NULL,   -- once | once_per_bar | every
    channels   VARCHAR   NOT NULL,   -- JSON list: app, telegram, email
    message    VARCHAR,
    status     VARCHAR   NOT NULL,   -- active | paused | triggered | expired
    expires    TIMESTAMP,
    created    TIMESTAMP NOT NULL,
    last_fired BIGINT,               -- IST wall time as epoch
    fire_count INTEGER   NOT NULL,
    state      VARCHAR               -- JSON engine bookkeeping
);

CREATE TABLE IF NOT EXISTS alert_events (
    id        VARCHAR PRIMARY KEY,
    alert_id  VARCHAR,
    time      BIGINT  NOT NULL,
    symbol    VARCHAR,
    title     VARCHAR NOT NULL,
    body      VARCHAR,
    delivered VARCHAR               -- JSON {channel: ok | error}
);

CREATE TABLE IF NOT EXISTS users (
    username      VARCHAR PRIMARY KEY,
    password_hash VARCHAR   NOT NULL,   -- scrypt$salt$digest
    created       TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash VARCHAR PRIMARY KEY,     -- sha256 of the cookie value
    username   VARCHAR   NOT NULL,
    created    TIMESTAMP NOT NULL,
    expires    TIMESTAMP NOT NULL
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
