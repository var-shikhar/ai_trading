"""Accounts: invite-only signup, cookie sessions, roles, API keys.

- Passwords: scrypt with a random salt (stdlib).
- Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored.
  Lookups are cached in memory for SESSION_CACHE_SECONDS so a remote
  database (Neon) isn't queried on every request; anything that ends a
  session clears the cache for that user.
- Invites: one-time codes created by admins; only the hash is stored.
- API keys: per-user keys for scripts/agents ("Authorization: Bearer ik_...").
- Failed logins and signups are throttled per username/code and address.
"""

import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta

import sqlalchemy as sa

from app import store
from app.store import api_keys, invites, sessions, users

SESSION_COOKIE = "indicator_session"
SESSION_DAYS = 30
SESSION_CACHE_SECONDS = 60
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

ROLES = ("admin", "user")
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TELEGRAM_RE = re.compile(r"^-?\d{3,20}$")
MIN_PASSWORD = 8
INVITE_MAX_DAYS = 30

MAX_FAILURES = 5
FAILURE_WINDOW = 300  # seconds
_failures: dict[str, deque] = defaultdict(deque)
# token hash -> (username, role, cached_at)
_session_cache: dict[str, tuple[str, str, float]] = {}


class AccountDisabled(PermissionError):
    pass


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


def _sha(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


_token_hash = _sha


# --- validation ------------------------------------------------------------------------


def _clean_username(username: str) -> str:
    u = username.strip().lower()
    if not USERNAME_RE.match(u):
        raise ValueError("Username: 3-32 characters, letters, digits, '.', '_' or '-'")
    return u


def _clean_email(email: str | None) -> str | None:
    if email is None or not email.strip():
        return None
    e = email.strip().lower()
    if not EMAIL_RE.match(e):
        raise ValueError("That doesn't look like an email address")
    return e


def _check_password(password: str) -> None:
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"Password must be at least {MIN_PASSWORD} characters")


# --- users ---------------------------------------------------------------------------------


def _public(r: dict | None) -> dict | None:
    if not r:
        return None
    return {
        "username": r["username"],
        "role": r["role"],
        "email": r["email"],
        "telegram_chat_id": r["telegram_chat_id"],
        "disabled": bool(r["disabled"]),
        "created": r["created"].isoformat(timespec="seconds"),
        "last_login": r["last_login"].isoformat(timespec="seconds") if r["last_login"] else None,
        "created_by": r["created_by"],
    }


def get_user(username: str) -> dict | None:
    return _public(store.row(sa.select(users).where(users.c.username == username.strip().lower())))


def list_users() -> list[dict]:
    return [_public(r) for r in store.rows(sa.select(users).order_by(users.c.created))]


def user_count() -> int:
    return store.scalar(sa.select(sa.func.count()).select_from(users))


def _email_taken(conn, email: str | None, except_user: str = "") -> bool:
    if not email:
        return False
    q = sa.select(users.c.username).where(users.c.email == email, users.c.username != except_user)
    return conn.execute(q).first() is not None


def create_user(
    username: str,
    password: str,
    role: str = "user",
    email: str | None = None,
    created_by: str | None = None,
    conn=None,
) -> dict:
    username = _clean_username(username)
    _check_password(password)
    if role not in ROLES:
        raise ValueError(f"Role must be one of {ROLES}")
    email = _clean_email(email)

    def insert(c):
        if c.execute(sa.select(users.c.username).where(users.c.username == username)).first():
            raise ValueError(f"User '{username}' already exists")
        if _email_taken(c, email):
            raise ValueError("Another account already uses that email")
        c.execute(
            sa.insert(users).values(
                username=username, password_hash=hash_password(password), role=role, email=email,
                disabled=False, created=store.now(), created_by=created_by,
            )
        )

    if conn is not None:
        insert(conn)
    else:
        with store.tx() as c:
            insert(c)
    return get_user(username) if conn is None else {"username": username, "role": role}


def _active_admins(conn, exclude: str = "") -> int:
    q = sa.select(sa.func.count()).select_from(users).where(
        users.c.role == "admin", users.c.disabled.is_(False), users.c.username != exclude
    )
    return conn.execute(q).scalar()


def _end_sessions(conn, username: str, keep_hash: str = "") -> None:
    conn.execute(sa.delete(sessions).where(sessions.c.username == username, sessions.c.token_hash != keep_hash))
    for th, (u, _, _) in list(_session_cache.items()):
        if u == username and th != keep_hash:
            _session_cache.pop(th, None)


def update_user(
    username: str, actor: str, role: str | None = None, disabled: bool | None = None, email: str | None = ...
) -> dict:
    """Admin edits. Guards: no self demotion/disable; keep at least one active admin."""
    user = get_user(username)
    if not user:
        raise LookupError(f"No user '{username}'")
    u = user["username"]
    with store.tx() as c:
        if role is not None and role != user["role"]:
            if role not in ROLES:
                raise ValueError(f"Role must be one of {ROLES}")
            if u == actor:
                raise ValueError("You can't change your own role")
            if user["role"] == "admin" and _active_admins(c, exclude=u) == 0:
                raise ValueError("There must be at least one admin")
            c.execute(sa.update(users).where(users.c.username == u).values(role=role))
            _end_cache(u)  # role is cached with the session
        if disabled is not None and disabled != user["disabled"]:
            if u == actor:
                raise ValueError("You can't disable your own account")
            if disabled and user["role"] == "admin" and _active_admins(c, exclude=u) == 0:
                raise ValueError("There must be at least one active admin")
            c.execute(sa.update(users).where(users.c.username == u).values(disabled=disabled))
            if disabled:
                _end_sessions(c, u)
        if email is not ...:
            e = _clean_email(email)
            if _email_taken(c, e, except_user=u):
                raise ValueError("Another account already uses that email")
            c.execute(sa.update(users).where(users.c.username == u).values(email=e))
    return get_user(u)


def update_profile(username: str, email: str | None = ..., telegram_chat_id: str | None = ...) -> dict:
    """A user's own notification settings."""
    values = {}
    with store.tx() as c:
        if email is not ...:
            e = _clean_email(email)
            if _email_taken(c, e, except_user=username):
                raise ValueError("Another account already uses that email")
            values["email"] = e
        if telegram_chat_id is not ...:
            t = (telegram_chat_id or "").strip() or None
            if t and not TELEGRAM_RE.match(t):
                raise ValueError("Telegram chat id is a number, e.g. 123456789")
            values["telegram_chat_id"] = t
        if values:
            c.execute(sa.update(users).where(users.c.username == username).values(**values))
    return get_user(username)


def delete_user(username: str, actor: str) -> None:
    user = get_user(username)
    if not user:
        raise LookupError(f"No user '{username}'")
    if user["username"] == actor:
        raise ValueError("You can't delete your own account")
    with store.tx() as c:
        if user["role"] == "admin" and _active_admins(c, exclude=user["username"]) == 0:
            raise ValueError("There must be at least one admin")
        _end_sessions(c, user["username"])
        # Their watchlists, alerts, backtests etc. go with them (ON DELETE CASCADE).
        c.execute(sa.delete(users).where(users.c.username == user["username"]))


def set_password(username: str, password: str) -> None:
    """Set a new password and sign that user out everywhere."""
    _check_password(password)
    u = username.strip().lower()
    with store.tx() as c:
        if not c.execute(sa.select(users.c.username).where(users.c.username == u)).first():
            raise LookupError(f"No user '{username}'")
        c.execute(sa.update(users).where(users.c.username == u).values(password_hash=hash_password(password)))
        _end_sessions(c, u)


def change_own_password(username: str, current: str, new: str, keep_token: str | None) -> None:
    r = store.row(sa.select(users.c.password_hash).where(users.c.username == username))
    if not r or not verify_password(current, r["password_hash"]):
        raise PermissionError("Current password is wrong")
    _check_password(new)
    with store.tx() as c:
        c.execute(sa.update(users).where(users.c.username == username).values(password_hash=hash_password(new)))
        # Sign out other devices; keep the session that made the change.
        _end_sessions(c, username, keep_hash=_sha(keep_token) if keep_token else "")


# --- login / sessions -----------------------------------------------------------------------


def _throttled(key: str) -> bool:
    q = _failures[key]
    now = time.monotonic()
    while q and now - q[0] > FAILURE_WINDOW:
        q.popleft()
    return len(q) >= MAX_FAILURES


def _fail(*keys: str) -> None:
    for k in keys:
        _failures[k].append(time.monotonic())


def _new_session(conn, username: str) -> str:
    token = secrets.token_urlsafe(32)
    now = store.now()
    conn.execute(sa.update(users).where(users.c.username == username).values(last_login=now))
    conn.execute(
        sa.insert(sessions).values(
            token_hash=_sha(token), username=username, created=now, expires=now + timedelta(days=SESSION_DAYS)
        )
    )
    return token


def login(username: str, password: str, client: str) -> str | None:
    """Session token on success, None on bad credentials. Raises
    PermissionError when throttled, AccountDisabled for disabled accounts."""
    username = username.strip().lower()
    keys = (f"user:{username}", f"ip:{client}")
    if any(_throttled(k) for k in keys):
        raise PermissionError("Too many failed attempts. Try again in a few minutes.")
    r = store.row(sa.select(users.c.password_hash, users.c.disabled).where(users.c.username == username))
    # Verify against a dummy hash for unknown users so timing doesn't reveal them.
    ok = verify_password(password, r["password_hash"] if r else _DUMMY_HASH)
    if not (r and ok):
        _fail(*keys)
        return None
    for k in keys:
        _failures.pop(k, None)
    if r["disabled"]:
        raise AccountDisabled("This account is disabled. Ask the admin.")
    with store.tx() as c:
        return _new_session(c, username)


def session_info(token: str | None) -> tuple[str, str] | None:
    """(username, role) for a valid session, else None. Slides the expiry."""
    if not token:
        return None
    th = _sha(token)
    hit = _session_cache.get(th)
    if hit and time.monotonic() - hit[2] < SESSION_CACHE_SECONDS:
        return hit[0], hit[1]
    q = (
        sa.select(sessions.c.username, sessions.c.expires, users.c.disabled, users.c.role)
        .join(users, users.c.username == sessions.c.username)
        .where(sessions.c.token_hash == th)
    )
    r = store.row(q)
    if not r or r["disabled"]:
        _session_cache.pop(th, None)
        return None
    now = store.now()
    if r["expires"] <= now:
        with store.tx() as c:
            c.execute(sa.delete(sessions).where(sessions.c.token_hash == th))
        _session_cache.pop(th, None)
        return None
    # Renew at most once a day to avoid a write per request.
    if r["expires"] - now < timedelta(days=SESSION_DAYS - 1):
        with store.tx() as c:
            c.execute(
                sa.update(sessions).where(sessions.c.token_hash == th).values(expires=now + timedelta(days=SESSION_DAYS))
            )
    _session_cache[th] = (r["username"], r["role"], time.monotonic())
    return r["username"], r["role"]


def session_user(token: str | None) -> str | None:
    info = session_info(token)
    return info[0] if info else None


def logout(token: str | None) -> None:
    if token:
        th = _sha(token)
        _session_cache.pop(th, None)
        with store.tx() as c:
            c.execute(sa.delete(sessions).where(sessions.c.token_hash == th))


def _end_cache(username: str) -> None:
    for th, (u, _, _) in list(_session_cache.items()):
        if u == username:
            _session_cache.pop(th, None)


def reset_throttle() -> None:
    _failures.clear()
    _session_cache.clear()


# --- invites ----------------------------------------------------------------------------------


def create_invite(created_by: str, email: str | None = None, role: str = "user", days: int = 7,
                  note: str | None = None) -> dict:
    """Returns the invite including the plain code (shown once)."""
    if role not in ROLES:
        raise ValueError(f"Role must be one of {ROLES}")
    if not 1 <= days <= INVITE_MAX_DAYS:
        raise ValueError(f"Invites last 1-{INVITE_MAX_DAYS} days")
    email = _clean_email(email)
    code = secrets.token_urlsafe(18)
    now = store.now()
    values = dict(
        code_hash=_sha(code), prefix=code[:6], email=email, role=role, note=(note or "").strip()[:120] or None,
        created_by=created_by, created=now, expires=now + timedelta(days=days), revoked=False,
    )
    with store.tx() as c:
        c.execute(sa.insert(invites).values(**values))
    return {**_invite_public(values), "code": code}


def _invite_status(r: dict) -> str:
    if r["used_by"]:
        return "used"
    if r["revoked"]:
        return "revoked"
    return "expired" if r["expires"] <= store.now() else "open"


def _invite_public(r: dict) -> dict:
    return {
        "id": r["code_hash"][:16],
        "prefix": r["prefix"],
        "email": r["email"],
        "role": r["role"],
        "note": r["note"],
        "created_by": r["created_by"],
        "created": r["created"].isoformat(timespec="seconds"),
        "expires": r["expires"].isoformat(timespec="seconds"),
        "used_by": r.get("used_by"),
        "used_at": r["used_at"].isoformat(timespec="seconds") if r.get("used_at") else None,
        "status": _invite_status({"used_by": r.get("used_by"), "revoked": r.get("revoked"), "expires": r["expires"]}),
    }


def list_invites() -> list[dict]:
    return [_invite_public(r) for r in store.rows(sa.select(invites).order_by(invites.c.created.desc()))]


def revoke_invite(invite_id: str) -> None:
    with store.tx() as c:
        n = c.execute(
            sa.update(invites).where(invites.c.code_hash.startswith(invite_id), invites.c.used_by.is_(None)).values(revoked=True)
        ).rowcount
    if not n:
        raise LookupError("No open invite with that id")


def check_invite(code: str) -> dict:
    """Public preview of an invite (for the signup page)."""
    r = store.row(sa.select(invites).where(invites.c.code_hash == _sha(code.strip())))
    if not r or _invite_status(r) != "open":
        raise LookupError("This invite link is invalid, used or expired. Ask for a new one.")
    return {"email": r["email"], "role": r["role"], "expires": r["expires"].isoformat(timespec="seconds")}


def signup(code: str, username: str, password: str, email: str | None, client: str) -> str:
    """Create the account an invite allows, use up the invite, start a session."""
    keys = (f"ip:{client}", f"invite:{code[:6]}")
    if any(_throttled(k) for k in keys):
        raise PermissionError("Too many attempts. Try again in a few minutes.")
    th = _sha(code.strip())
    with store.tx() as c:
        r = c.execute(sa.select(invites).where(invites.c.code_hash == th)).first()
        r = dict(r._mapping) if r else None
        if not r or _invite_status(r) != "open":
            _fail(*keys)
            raise LookupError("This invite link is invalid, used or expired. Ask for a new one.")
        email = _clean_email(email) or r["email"]
        if r["email"] and email != r["email"]:
            raise ValueError("This invite is for a different email address")
        created = create_user(username, password, role=r["role"], email=email, created_by=r["created_by"], conn=c)
        # Mark used only if still unused (two signups racing for one code).
        n = c.execute(
            sa.update(invites)
            .where(invites.c.code_hash == th, invites.c.used_by.is_(None))
            .values(used_by=created["username"], used_at=store.now())
        ).rowcount
        if n != 1:
            raise LookupError("This invite was just used. Ask for a new one.")
        return _new_session(c, created["username"])


# --- API keys -------------------------------------------------------------------------------------


def create_api_key(owner: str, name: str) -> dict:
    name = name.strip()[:80] or "API key"
    key = "ik_" + secrets.token_urlsafe(30)
    now = store.now()
    with store.tx() as c:
        c.execute(sa.insert(api_keys).values(key_hash=_sha(key), prefix=key[:10], owner=owner, name=name, created=now,
                                             revoked=False))
    return {"key": key, "prefix": key[:10], "name": name, "created": now.isoformat(timespec="seconds")}


def list_api_keys(owner: str) -> list[dict]:
    q = sa.select(api_keys).where(api_keys.c.owner == owner, api_keys.c.revoked.is_(False)).order_by(api_keys.c.created)
    return [
        {"id": r["key_hash"][:16], "prefix": r["prefix"], "name": r["name"],
         "created": r["created"].isoformat(timespec="seconds"),
         "last_used": r["last_used"].isoformat(timespec="seconds") if r["last_used"] else None}
        for r in store.rows(q)
    ]


def revoke_api_key(owner: str, key_id: str) -> None:
    with store.tx() as c:
        n = c.execute(
            sa.update(api_keys).where(api_keys.c.owner == owner, api_keys.c.key_hash.startswith(key_id)).values(revoked=True)
        ).rowcount
    _session_cache.clear()
    if not n:
        raise LookupError("No such API key")


def api_key_info(key: str | None) -> tuple[str, str] | None:
    """(username, role) for a valid API key."""
    if not key or not key.startswith("ik_"):
        return None
    kh = _sha(key)
    hit = _session_cache.get("k:" + kh)
    if hit and time.monotonic() - hit[2] < SESSION_CACHE_SECONDS:
        return hit[0], hit[1]
    q = (
        sa.select(api_keys.c.owner, users.c.role, users.c.disabled)
        .join(users, users.c.username == api_keys.c.owner)
        .where(api_keys.c.key_hash == kh, api_keys.c.revoked.is_(False))
    )
    r = store.row(q)
    if not r or r["disabled"]:
        return None
    with store.tx() as c:
        c.execute(sa.update(api_keys).where(api_keys.c.key_hash == kh).values(last_used=store.now()))
    _session_cache["k:" + kh] = (r["owner"], r["role"], time.monotonic())
    return r["owner"], r["role"]


_DUMMY_HASH = hash_password(secrets.token_hex(8))
