"""App login: accounts created by the owner (no public sign-up), cookie sessions.

- Passwords: scrypt with a random salt (stdlib, no extra dependency).
- Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored,
  so a copy of the database can't be used to log in.
- Failed logins are throttled per username and per client address.
"""

import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from app.db import get_conn

SESSION_COOKIE = "indicator_session"
SESSION_DAYS = 30
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

class AccountDisabled(PermissionError):
    pass


MAX_FAILURES = 5
FAILURE_WINDOW = 300  # seconds
_failures: dict[str, deque] = defaultdict(deque)


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


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- users -------------------------------------------------------------------------

ROLES = ("admin", "user")
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,31}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD = 8


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


def create_user(
    username: str, password: str, role: str = "user", email: str | None = None, created_by: str | None = None
) -> dict:
    username = _clean_username(username)
    _check_password(password)
    if role not in ROLES:
        raise ValueError(f"Role must be one of {ROLES}")
    email = _clean_email(email)
    con = get_conn()
    if con.execute("SELECT 1 FROM users WHERE username = ?", [username]).fetchone():
        raise ValueError(f"User '{username}' already exists")
    if email and con.execute("SELECT 1 FROM users WHERE email = ?", [email]).fetchone():
        raise ValueError("Another account already uses that email")
    con.execute(
        "INSERT INTO users (username, password_hash, created, role, email, disabled, created_by) "
        "VALUES (?, ?, ?, ?, ?, false, ?)",
        [username, hash_password(password), datetime.now(), role, email, created_by],
    )
    return get_user(username)


def get_user(username: str) -> dict | None:
    row = get_conn().execute(
        "SELECT username, role, email, disabled, created, last_login, created_by FROM users WHERE username = ?",
        [username.strip().lower()],
    ).fetchone()
    if not row:
        return None
    u, role, email, disabled, created, last_login, created_by = row
    return {
        "username": u,
        "role": role,
        "email": email,
        "disabled": bool(disabled),
        "created": created.isoformat(timespec="seconds"),
        "last_login": last_login.isoformat(timespec="seconds") if last_login else None,
        "created_by": created_by,
    }


def list_users() -> list[dict]:
    names = [r[0] for r in get_conn().execute("SELECT username FROM users ORDER BY created").fetchall()]
    return [get_user(n) for n in names]


def _active_admins(exclude: str | None = None) -> int:
    return get_conn().execute(
        "SELECT count(*) FROM users WHERE role = 'admin' AND NOT disabled AND username <> ?", [exclude or ""]
    ).fetchone()[0]


def _end_sessions(username: str) -> None:
    get_conn().execute("DELETE FROM sessions WHERE username = ?", [username])


def update_user(
    username: str, actor: str, role: str | None = None, disabled: bool | None = None, email: str | None = ...
) -> dict:
    """Admin edits. Guards: an admin can't demote/disable themselves, and the
    last active admin can't be demoted or disabled."""
    user = get_user(username)
    if not user:
        raise LookupError(f"No user '{username}'")
    u = user["username"]
    con = get_conn()
    if role is not None and role != user["role"]:
        if role not in ROLES:
            raise ValueError(f"Role must be one of {ROLES}")
        if u == actor:
            raise ValueError("You can't change your own role")
        if user["role"] == "admin" and _active_admins(exclude=u) == 0:
            raise ValueError("There must be at least one admin")
        con.execute("UPDATE users SET role = ? WHERE username = ?", [role, u])
    if disabled is not None and disabled != user["disabled"]:
        if u == actor:
            raise ValueError("You can't disable your own account")
        if disabled and user["role"] == "admin" and _active_admins(exclude=u) == 0:
            raise ValueError("There must be at least one active admin")
        con.execute("UPDATE users SET disabled = ? WHERE username = ?", [disabled, u])
        if disabled:
            _end_sessions(u)
    if email is not ...:
        e = _clean_email(email)
        if e and con.execute("SELECT 1 FROM users WHERE email = ? AND username <> ?", [e, u]).fetchone():
            raise ValueError("Another account already uses that email")
        con.execute("UPDATE users SET email = ? WHERE username = ?", [e, u])
    return get_user(u)


def delete_user(username: str, actor: str) -> None:
    user = get_user(username)
    if not user:
        raise LookupError(f"No user '{username}'")
    if user["username"] == actor:
        raise ValueError("You can't delete your own account")
    if user["role"] == "admin" and _active_admins(exclude=user["username"]) == 0:
        raise ValueError("There must be at least one admin")
    _end_sessions(user["username"])
    get_conn().execute("DELETE FROM users WHERE username = ?", [user["username"]])


def set_password(username: str, password: str) -> None:
    """Set a new password and sign that user out everywhere."""
    _check_password(password)
    u = username.strip().lower()
    con = get_conn()
    if not con.execute("SELECT 1 FROM users WHERE username = ?", [u]).fetchone():
        raise LookupError(f"No user '{username}'")
    con.execute("UPDATE users SET password_hash = ? WHERE username = ?", [hash_password(password), u])
    _end_sessions(u)


def change_own_password(username: str, current: str, new: str, keep_token: str | None) -> None:
    row = get_conn().execute("SELECT password_hash FROM users WHERE username = ?", [username]).fetchone()
    if not row or not verify_password(current, row[0]):
        raise PermissionError("Current password is wrong")
    _check_password(new)
    con = get_conn()
    con.execute("UPDATE users SET password_hash = ? WHERE username = ?", [hash_password(new), username])
    # Sign out other devices; keep the session that made the change.
    keep = _token_hash(keep_token) if keep_token else ""
    con.execute("DELETE FROM sessions WHERE username = ? AND token_hash <> ?", [username, keep])


def user_count() -> int:
    return get_conn().execute("SELECT count(*) FROM users").fetchone()[0]


# --- login throttling --------------------------------------------------------------


def _throttled(key: str) -> bool:
    q = _failures[key]
    now = time.monotonic()
    while q and now - q[0] > FAILURE_WINDOW:
        q.popleft()
    return len(q) >= MAX_FAILURES


def login(username: str, password: str, client: str) -> str | None:
    """Session token on success, None on bad credentials. Raises
    PermissionError when too many recent failures."""
    username = username.strip().lower()
    keys = (f"user:{username}", f"ip:{client}")
    if any(_throttled(k) for k in keys):
        raise PermissionError("Too many failed attempts. Try again in a few minutes.")
    row = get_conn().execute("SELECT password_hash, disabled FROM users WHERE username = ?", [username]).fetchone()
    # Verify against a dummy hash for unknown users so timing doesn't reveal them.
    ok = verify_password(password, row[0] if row else _DUMMY_HASH)
    if not (row and ok):
        for k in keys:
            _failures[k].append(time.monotonic())
        return None
    for k in keys:
        _failures.pop(k, None)
    if row[1]:
        raise AccountDisabled("This account is disabled. Ask the admin.")
    token = secrets.token_urlsafe(32)
    now = datetime.now()
    get_conn().execute("UPDATE users SET last_login = ? WHERE username = ?", [now, username])
    get_conn().execute(
        "INSERT INTO sessions VALUES (?, ?, ?, ?)",
        [_token_hash(token), username, now, now + timedelta(days=SESSION_DAYS)],
    )
    return token


def session_user(token: str | None) -> str | None:
    """Username for a valid session (and slide its expiry), else None."""
    if not token:
        return None
    con = get_conn()
    th = _token_hash(token)
    row = con.execute(
        "SELECT s.username, s.expires, u.disabled FROM sessions s JOIN users u ON u.username = s.username "
        "WHERE s.token_hash = ?",
        [th],
    ).fetchone()
    if not row or row[2]:
        return None  # unknown token, deleted or disabled user
    username, expires, _ = row
    now = datetime.now()
    if expires <= now:
        con.execute("DELETE FROM sessions WHERE token_hash = ?", [th])
        return None
    # Renew at most once a day to avoid a write per request.
    if expires - now < timedelta(days=SESSION_DAYS - 1):
        con.execute("UPDATE sessions SET expires = ? WHERE token_hash = ?", [now + timedelta(days=SESSION_DAYS), th])
    return username


def logout(token: str | None) -> None:
    if token:
        get_conn().execute("DELETE FROM sessions WHERE token_hash = ?", [_token_hash(token)])


def reset_throttle() -> None:
    _failures.clear()


_DUMMY_HASH = hash_password(secrets.token_hex(8))
