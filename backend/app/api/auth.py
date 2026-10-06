import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.deps import get_fyers
from app.providers.base import ProviderError
from app.providers.fyers import FyersProvider
from app.services import tokens

router = APIRouter(prefix="/api/auth", tags=["auth"])

# OAuth state values issued by /login, checked once in /callback.
_pending_states: set[str] = set()


@router.get("/status")
def status(fyers: FyersProvider = Depends(get_fyers)):
    return {
        "fyers": {
            "configured": fyers.configured,
            "authenticated": fyers.is_authenticated(),
            "login_url": "/api/auth/fyers/login",
        }
    }


@router.get("/fyers/login")
def fyers_login(fyers: FyersProvider = Depends(get_fyers)):
    if not fyers.configured:
        raise HTTPException(400, "Set FYERS_APP_ID and FYERS_SECRET_KEY in backend/.env")
    state = secrets.token_urlsafe(16)
    _pending_states.add(state)
    return RedirectResponse(fyers.login_url(state))


@router.get("/fyers/callback")
async def fyers_callback(
    auth_code: str | None = None,
    state: str | None = None,
    s: str | None = None,
    fyers: FyersProvider = Depends(get_fyers),
):
    frontend = get_settings().frontend_url
    if state not in _pending_states:
        raise HTTPException(400, "Unknown login state; start again from the app")
    _pending_states.discard(state)
    if s != "ok" or not auth_code:
        return RedirectResponse(f"{frontend}/?login=failed")
    try:
        await fyers.exchange_auth_code(auth_code)
    except ProviderError:
        return RedirectResponse(f"{frontend}/?login=failed")
    return RedirectResponse(f"{frontend}/?login=ok")


@router.post("/fyers/logout")
def fyers_logout():
    tokens.clear_token("fyers")
    return {"ok": True}
