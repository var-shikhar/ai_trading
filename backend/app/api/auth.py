"""Fyers OAuth: /login sends the browser to Fyers, Fyers sends it back to
/callback with a one-time auth code, which we exchange for the day's token.

The OAuth `state` (proof that the flow started from this app) is stored in
the database with a 15-minute lifetime, so a backend restart between the two
steps doesn't break the login. The callback never shows a bare error page: it
always returns to the app with ?fyers=ok or ?fyers=error&reason=..., and a
reload of the callback after a successful login simply reports success.
"""

import logging
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlencode

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app import store
from app.config import get_settings
from app.deps import get_fyers, require_admin
from app.store import oauth_states
from app.providers.base import ProviderError
from app.providers.fyers import FyersProvider
from app.services import tokens

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

STATE_MINUTES = 15


@router.get("/status")
def status(fyers: FyersProvider = Depends(get_fyers)):
    # One shared Fyers connection for the whole app; only admins manage it.
    return {
        "fyers": {
            "configured": fyers.configured,
            "authenticated": fyers.is_authenticated(),
            "login_url": "/api/auth/fyers/login",
        }
    }


@router.get("/fyers/login")
def fyers_login(fyers: FyersProvider = Depends(get_fyers), _: str = Depends(require_admin)):
    if not fyers.configured:
        raise HTTPException(400, "Set FYERS_APP_ID and FYERS_SECRET_KEY in backend/.env")
    now = datetime.now()
    state = secrets.token_urlsafe(16)
    with store.tx() as c:
        c.execute(sa.delete(oauth_states).where(oauth_states.c.created < now - timedelta(days=1)))
        c.execute(sa.insert(oauth_states).values(state=state, created=now, used=False))
    return RedirectResponse(fyers.login_url(state))


def _back(result: str, reason: str = "") -> RedirectResponse:
    params = {"fyers": result, **({"reason": reason} if reason else {})}
    return RedirectResponse(f"{get_settings().frontend_url}/?{urlencode(params)}")


@router.get("/fyers/callback")
async def fyers_callback(
    auth_code: str | None = None,
    state: str | None = None,
    s: str | None = None,
    message: str | None = None,
    fyers: FyersProvider = Depends(get_fyers),
):
    row = store.row(sa.select(oauth_states).where(oauth_states.c.state == (state or "")))
    fresh = row is not None and row["created"] > datetime.now() - timedelta(minutes=STATE_MINUTES)

    if row is None or not fresh or row["used"]:
        # Reloaded / revisited callback, or a link older than 15 minutes.
        if fyers.is_authenticated():
            return _back("ok")
        log.info("Fyers callback with unknown, used or expired state")
        return _back("error", "That Fyers login link has expired. Click Connect Fyers to start again.")

    with store.tx() as c:
        c.execute(sa.update(oauth_states).where(oauth_states.c.state == state).values(used=True))
    if s != "ok" or not auth_code:
        log.warning("Fyers login not completed: s=%s message=%s", s, message)
        return _back("error", message or "Fyers login was cancelled or didn't complete.")
    try:
        await fyers.exchange_auth_code(auth_code)
    except ProviderError as e:
        log.warning("Fyers token exchange failed: %s", e)
        return _back("error", str(e))
    log.info("Fyers connected")
    if get_settings().alerts_enabled:
        from app.api.alerts import get_engine

        await get_engine().refresh()
    return _back("ok")


@router.post("/fyers/logout")
def fyers_logout(_: str = Depends(require_admin)):
    tokens.clear_token("fyers")
    return {"ok": True}
