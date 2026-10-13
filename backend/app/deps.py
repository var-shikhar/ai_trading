from functools import lru_cache

from fastapi import HTTPException, Request

from app.config import get_settings
from app.providers.fyers import FyersProvider
from app.services.candles import CandleService

# Owner used when login is turned off (AUTH_REQUIRED=false, tests only).
LOCAL_USER = "local"


@lru_cache
def get_fyers() -> FyersProvider:
    return FyersProvider(get_settings())


@lru_cache
def get_candle_service() -> CandleService:
    # Fyers is the history source; Kotak Neo has no historical API.
    return CandleService(get_fyers(), get_settings())


def _ensure_local_user() -> None:
    import sqlalchemy as sa

    from app import store

    if store.row(sa.select(store.users.c.username).where(store.users.c.username == LOCAL_USER)) is None:
        with store.tx() as c:
            c.execute(
                sa.insert(store.users).values(
                    username=LOCAL_USER, password_hash="!", role="admin", disabled=False, created=store.now()
                )
            )


def current_user(request: Request) -> str:
    """Username of the signed-in user (session cookie or API key)."""
    user = getattr(request.state, "user", None)
    if user:
        return user
    if not get_settings().auth_required:
        _ensure_local_user()
        request.state.user, request.state.role = LOCAL_USER, "admin"
        return LOCAL_USER
    raise HTTPException(401, "Not signed in")


def require_admin(request: Request) -> str:
    user = current_user(request)
    if getattr(request.state, "role", None) != "admin":
        raise HTTPException(403, "Only admins can do this")
    return user
