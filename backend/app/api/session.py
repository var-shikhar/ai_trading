from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.config import get_settings
from app.services import accounts

router = APIRouter(prefix="/api/session", tags=["session"])


class LoginIn(BaseModel):
    username: str = Field(..., max_length=64)
    password: str = Field(..., max_length=256)


def client_address(request: Request) -> str:
    # Behind a reverse proxy (Caddy/Nginx) the real address is forwarded.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and get_settings().trust_proxy:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    try:
        token = accounts.login(body.username, body.password, client_address(request))
    except PermissionError as e:
        raise HTTPException(429, str(e)) from e
    if token is None:
        raise HTTPException(401, "Wrong username or password")
    response.set_cookie(
        accounts.SESSION_COOKIE,
        token,
        max_age=accounts.SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=get_settings().cookie_secure,
        path="/",
    )
    return {"username": body.username.strip().lower()}


@router.post("/logout")
def logout(request: Request, response: Response):
    accounts.logout(request.cookies.get(accounts.SESSION_COOKIE))
    response.delete_cookie(accounts.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Not signed in")
    return {"username": user}
