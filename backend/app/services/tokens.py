"""The shared broker connection (one Fyers login for the whole app).

The token is cached in memory so data requests don't wait on the database.
"""

import time
from datetime import datetime

import sqlalchemy as sa

from app import store
from app.store import app_tokens

_cache: dict[str, tuple[str | None, datetime | None, float]] = {}
CACHE_SECONDS = 30


def save_token(provider: str, access_token: str, expires_at: datetime, connected_by: str | None = None) -> None:
    with store.tx() as c:
        c.execute(sa.delete(app_tokens).where(app_tokens.c.provider == provider))
        c.execute(
            sa.insert(app_tokens).values(
                provider=provider, access_token=access_token, expires_at=expires_at, connected_by=connected_by
            )
        )
    _cache[provider] = (access_token, expires_at, time.monotonic())


def load_token(provider: str, now: datetime) -> str | None:
    hit = _cache.get(provider)
    if not hit or time.monotonic() - hit[2] > CACHE_SECONDS:
        r = store.row(sa.select(app_tokens).where(app_tokens.c.provider == provider))
        hit = (r["access_token"], r["expires_at"], time.monotonic()) if r else (None, None, time.monotonic())
        _cache[provider] = hit
    token, expires, _ = hit
    return token if token and expires and expires > now else None


def clear_token(provider: str) -> None:
    with store.tx() as c:
        c.execute(sa.delete(app_tokens).where(app_tokens.c.provider == provider))
    _cache[provider] = (None, None, time.monotonic())


def connected_by(provider: str) -> str | None:
    r = store.row(sa.select(app_tokens.c.connected_by).where(app_tokens.c.provider == provider))
    return r["connected_by"] if r else None
