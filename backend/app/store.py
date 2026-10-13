"""App database: people and their data (PostgreSQL, e.g. Neon).

    users, sessions, invites, api_keys      who can sign in
    app_tokens, oauth_states                the shared Fyers connection
    watchlists, drawings, alerts,
    alert_events, backtests,
    strategies, signals                     per-user data (owner = username)

Market data (candles, instruments) stays in the DuckDB cache (app.db).
DATABASE_URL picks the server; empty means a local SQLite file, which is
also what the tests use. Tables are created on startup; app_meta records
one-time steps such as the import of data from older DuckDB versions.
"""

import threading
from contextlib import contextmanager
from datetime import datetime

import sqlalchemy as sa

from app.config import get_settings

metadata = sa.MetaData()

_ts = lambda name, **kw: sa.Column(name, sa.DateTime, **kw)  # noqa: E731

users = sa.Table(
    "users", metadata,
    sa.Column("username", sa.String(32), primary_key=True),
    sa.Column("password_hash", sa.String(200), nullable=False),
    sa.Column("role", sa.String(10), nullable=False, server_default="user"),  # admin | user
    sa.Column("email", sa.String(254), unique=True),
    sa.Column("telegram_chat_id", sa.String(40)),
    sa.Column("disabled", sa.Boolean, nullable=False, server_default=sa.false()),
    _ts("created", nullable=False),
    _ts("last_login"),
    sa.Column("created_by", sa.String(32)),
)

_owner = lambda: sa.Column(  # noqa: E731
    "owner", sa.String(32), sa.ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True
)

sessions = sa.Table(
    "sessions", metadata,
    sa.Column("token_hash", sa.String(64), primary_key=True),
    sa.Column("username", sa.String(32), sa.ForeignKey("users.username", ondelete="CASCADE"), nullable=False, index=True),
    _ts("created", nullable=False),
    _ts("expires", nullable=False),
)

invites = sa.Table(
    "invites", metadata,
    sa.Column("code_hash", sa.String(64), primary_key=True),
    sa.Column("prefix", sa.String(8), nullable=False),  # shown in the admin list
    sa.Column("email", sa.String(254)),  # if set, only this address may use it
    sa.Column("role", sa.String(10), nullable=False, server_default="user"),
    sa.Column("note", sa.String(120)),
    sa.Column("created_by", sa.String(32), nullable=False),
    _ts("created", nullable=False),
    _ts("expires", nullable=False),
    sa.Column("used_by", sa.String(32)),
    _ts("used_at"),
    sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
)

api_keys = sa.Table(
    "api_keys", metadata,
    sa.Column("key_hash", sa.String(64), primary_key=True),
    sa.Column("prefix", sa.String(12), nullable=False),
    _owner(),
    sa.Column("name", sa.String(80), nullable=False),
    _ts("created", nullable=False),
    _ts("last_used"),
    sa.Column("revoked", sa.Boolean, nullable=False, server_default=sa.false()),
)

app_tokens = sa.Table(  # the shared (global) broker connection
    "app_tokens", metadata,
    sa.Column("provider", sa.String(20), primary_key=True),
    sa.Column("access_token", sa.Text, nullable=False),
    _ts("expires_at", nullable=False),
    sa.Column("connected_by", sa.String(32)),
)

oauth_states = sa.Table(
    "oauth_states", metadata,
    sa.Column("state", sa.String(64), primary_key=True),
    _ts("created", nullable=False),
    sa.Column("used", sa.Boolean, nullable=False, server_default=sa.false()),
)

watchlists = sa.Table(
    "watchlists", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("name", sa.String(60), nullable=False),
    sa.Column("items", sa.JSON, nullable=False),
    sa.Column("position", sa.Integer, nullable=False),
    _ts("updated", nullable=False),
)

drawings = sa.Table(
    "drawings", metadata,
    _owner(),
    sa.Column("symbol", sa.String(64), nullable=False),
    sa.Column("data", sa.JSON, nullable=False),
    _ts("updated", nullable=False),
    sa.PrimaryKeyConstraint("owner", "symbol"),
)

alerts = sa.Table(
    "alerts", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("kind", sa.String(12), nullable=False),  # price | drawing | condition | scan
    sa.Column("symbol", sa.String(64)),
    sa.Column("ticker", sa.String(64)),
    sa.Column("name", sa.String(80)),
    sa.Column("config", sa.JSON, nullable=False),
    sa.Column("tf", sa.String(4)),
    sa.Column("frequency", sa.String(16), nullable=False),
    sa.Column("channels", sa.JSON, nullable=False),
    sa.Column("message", sa.String(300)),
    sa.Column("status", sa.String(12), nullable=False),  # active | paused | triggered | expired
    _ts("expires"),
    _ts("created", nullable=False),
    sa.Column("last_fired", sa.BigInteger),  # IST wall time as epoch
    sa.Column("fire_count", sa.Integer, nullable=False, server_default="0"),
    sa.Column("state", sa.JSON),
)

alert_events = sa.Table(
    "alert_events", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("alert_id", sa.String(16), index=True),
    sa.Column("time", sa.BigInteger, nullable=False),
    sa.Column("symbol", sa.String(64)),
    sa.Column("title", sa.String(200), nullable=False),
    sa.Column("body", sa.Text),
    sa.Column("delivered", sa.JSON),
)

strategies = sa.Table(
    "strategies", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("name", sa.String(80), nullable=False),
    sa.Column("description", sa.Text),
    sa.Column("definition", sa.JSON, nullable=False),  # entry/exit rules, risk, timeframe
    _ts("created", nullable=False),
    _ts("updated", nullable=False),
)

backtests = sa.Table(
    "backtests", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("strategy_id", sa.String(16), index=True),
    sa.Column("name", sa.String(80), nullable=False),
    _ts("created", nullable=False),
    sa.Column("request", sa.JSON, nullable=False),
    sa.Column("summary", sa.JSON, nullable=False),
    sa.Column("result", sa.JSON, nullable=False),
)

signals = sa.Table(
    "signals", metadata,
    sa.Column("id", sa.String(16), primary_key=True),
    _owner(),
    sa.Column("strategy_id", sa.String(16), index=True),
    sa.Column("source", sa.String(16), nullable=False),  # alert | scanner | agent | manual
    sa.Column("symbol", sa.String(64), nullable=False, index=True),
    sa.Column("tf", sa.String(4)),
    sa.Column("bar_time", sa.BigInteger),  # bar the signal refers to (IST epoch)
    sa.Column("direction", sa.String(8), nullable=False),  # long | short | exit | watch
    sa.Column("price", sa.Float),
    sa.Column("confidence", sa.Float),  # 0..1, e.g. from an agent
    sa.Column("reason", sa.Text),
    sa.Column("payload", sa.JSON),  # anything extra (agent output, matched details)
    sa.Column("status", sa.String(12), nullable=False, server_default="new"),  # new | seen | acted | dismissed
    _ts("created", nullable=False, index=True),
)

app_meta = sa.Table(
    "app_meta", metadata,
    sa.Column("key", sa.String(64), primary_key=True),
    sa.Column("value", sa.Text),
)

_engine: sa.Engine | None = None
_lock = threading.Lock()


def engine() -> sa.Engine:
    global _engine
    with _lock:
        if _engine is None:
            s = get_settings()
            url = s.database_url or f"sqlite:///{s.app_db_file.as_posix()}"
            if url.startswith("sqlite"):
                s.app_db_file.parent.mkdir(parents=True, exist_ok=True)
                _engine = sa.create_engine(url, connect_args={"check_same_thread": False})

                @sa.event.listens_for(_engine, "connect")
                def _fk_on(dbapi_conn, _):  # SQLite enforces foreign keys only when asked
                    dbapi_conn.execute("PRAGMA foreign_keys=ON")
            else:
                # Small pool (1 GB server, Neon connection limits); pre-ping
                # recovers connections Neon closed while scaled to zero.
                _engine = sa.create_engine(
                    url, pool_size=3, max_overflow=2, pool_pre_ping=True, pool_recycle=300
                )
            metadata.create_all(_engine)
        return _engine


@contextmanager
def tx():
    """A transaction: commits on success, rolls back on error."""
    with engine().begin() as conn:
        yield conn


def rows(stmt) -> list[dict]:
    with engine().connect() as c:
        return [dict(r._mapping) for r in c.execute(stmt)]


def row(stmt) -> dict | None:
    with engine().connect() as c:
        r = c.execute(stmt).first()
        return dict(r._mapping) if r else None


def scalar(stmt):
    with engine().connect() as c:
        return c.execute(stmt).scalar()


def get_meta(key: str) -> str | None:
    return scalar(sa.select(app_meta.c.value).where(app_meta.c.key == key))


def set_meta(key: str, value: str) -> None:
    with tx() as c:
        c.execute(sa.delete(app_meta).where(app_meta.c.key == key))
        c.execute(sa.insert(app_meta).values(key=key, value=value))


def dispose() -> None:
    global _engine
    with _lock:
        if _engine is not None:
            _engine.dispose()
            _engine = None


def now() -> datetime:
    return datetime.now()
