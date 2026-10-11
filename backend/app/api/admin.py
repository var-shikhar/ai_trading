"""User management for admins (there is no public sign-up)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.services import accounts

router = APIRouter(prefix="/api/admin", tags=["admin"])


def require_admin(request: Request) -> str:
    user = getattr(request.state, "user", None)
    info = accounts.get_user(user) if user else None
    if not info:
        raise HTTPException(401, "Not signed in")
    if info["role"] != "admin":
        raise HTTPException(403, "Only admins can manage users")
    return info["username"]


class NewUser(BaseModel):
    username: str = Field(..., max_length=32)
    password: str = Field(..., max_length=256)
    email: str | None = Field(None, max_length=254)
    role: Literal["admin", "user"] = "user"


class UserPatch(BaseModel):
    role: Literal["admin", "user"] | None = None
    disabled: bool | None = None
    email: str | None = Field(None, max_length=254)
    set_email: bool = False  # distinguishes "clear the email" from "don't touch it"


class NewPassword(BaseModel):
    password: str = Field(..., max_length=256)


def _bad(e: Exception):
    if isinstance(e, LookupError):
        return HTTPException(404, str(e))
    return HTTPException(400, str(e))


@router.get("/users")
def list_users(_: str = Depends(require_admin)):
    return accounts.list_users()


@router.post("/users")
def create_user(body: NewUser, admin: str = Depends(require_admin)):
    try:
        return accounts.create_user(body.username, body.password, body.role, body.email, created_by=admin)
    except ValueError as e:
        raise _bad(e) from e


@router.patch("/users/{username}")
def update_user(username: str, body: UserPatch, admin: str = Depends(require_admin)):
    try:
        kwargs = {"role": body.role, "disabled": body.disabled}
        if body.set_email:
            kwargs["email"] = body.email
        return accounts.update_user(username, actor=admin, **kwargs)
    except (ValueError, LookupError) as e:
        raise _bad(e) from e


@router.post("/users/{username}/password")
def reset_password(username: str, body: NewPassword, _: str = Depends(require_admin)):
    try:
        accounts.set_password(username, body.password)
    except (ValueError, LookupError) as e:
        raise _bad(e) from e
    return {"ok": True}


@router.delete("/users/{username}")
def delete_user(username: str, admin: str = Depends(require_admin)):
    try:
        accounts.delete_user(username, actor=admin)
    except (ValueError, LookupError) as e:
        raise _bad(e) from e
    return {"ok": True}
