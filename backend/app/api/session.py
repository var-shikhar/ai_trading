from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.deps import current_user
from app.services import accounts

router = APIRouter(prefix="/api/session", tags=["session"])


class LoginIn(BaseModel):
    username: str = Field(..., max_length=64)
    password: str = Field(..., max_length=256)


class SignupIn(BaseModel):
    code: str = Field(..., max_length=64)
    username: str = Field(..., max_length=32)
    password: str = Field(..., max_length=256)
    email: str | None = Field(None, max_length=254)


def client_address(request: Request) -> str:
    # Behind a reverse proxy (Caddy/Nginx) the real address is forwarded.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and get_settings().trust_proxy:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        accounts.SESSION_COOKIE,
        token,
        max_age=accounts.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
        path="/",
    )


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    try:
        token = accounts.login(body.username, body.password, client_address(request))
    except accounts.AccountDisabled as e:
        raise HTTPException(403, str(e)) from e
    except PermissionError as e:
        raise HTTPException(429, str(e)) from e
    if token is None:
        raise HTTPException(401, "Wrong username or password")
    _set_cookie(response, token)
    return {"username": body.username.strip().lower()}


@router.get("/invite")
def check_invite(code: str):
    """Public: is this invite usable? (The signup page shows the result.)"""
    try:
        return accounts.check_invite(code)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/signup")
def signup(body: SignupIn, request: Request, response: Response):
    """Public, but only with a valid invite code (no open registration)."""
    try:
        token = accounts.signup(body.code, body.username, body.password, body.email, client_address(request))
    except PermissionError as e:
        raise HTTPException(429, str(e)) from e
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    _set_cookie(response, token)
    return accounts.get_user(body.username)


@router.post("/logout")
def logout(request: Request, response: Response):
    accounts.logout(request.cookies.get(accounts.SESSION_COOKIE))
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: str = Depends(current_user)):
    info = accounts.get_user(user)
    if not info:
        raise HTTPException(401, "Not signed in")
    return info


class ProfileIn(BaseModel):
    email: str | None = Field(None, max_length=254)
    telegram_chat_id: str | None = Field(None, max_length=40)
    set_email: bool = False
    set_telegram: bool = False


@router.patch("/me")
def update_me(body: ProfileIn, user: str = Depends(current_user)):
    kwargs = {}
    if body.set_email:
        kwargs["email"] = body.email
    if body.set_telegram:
        kwargs["telegram_chat_id"] = body.telegram_chat_id
    try:
        return accounts.update_profile(user, **kwargs)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


class PasswordIn(BaseModel):
    current: str = Field(..., max_length=256)
    new: str = Field(..., max_length=256)


@router.post("/password")
def change_password(body: PasswordIn, request: Request, user: str = Depends(current_user)):
    try:
        accounts.change_own_password(user, body.current, body.new, request.cookies.get(accounts.SESSION_COOKIE))
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


# --- API keys (for scripts and agents) --------------------------------------------------------


class KeyIn(BaseModel):
    name: str = Field("API key", max_length=80)


@router.get("/api-keys")
def list_keys(user: str = Depends(current_user)):
    return accounts.list_api_keys(user)


@router.post("/api-keys")
def create_key(body: KeyIn, user: str = Depends(current_user)):
    return accounts.create_api_key(user, body.name)


@router.delete("/api-keys/{key_id}")
def revoke_key(key_id: str, user: str = Depends(current_user)):
    try:
        accounts.revoke_api_key(user, key_id)
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    return {"ok": True}
