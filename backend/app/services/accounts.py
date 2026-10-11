"""App login: accounts created by the owner (no public sign-up), cookie sessions.

- Passwords: scrypt with a random salt (stdlib, no extra dependency).
- Sessions: random token in an HttpOnly cookie; only its SHA-256 is stored,
  so a copy of the database can't be used to log in.
- Failed logins are throttled per username and per client address.
"""

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

from app.db import get_conn

SESSION_COOKIE = "indicator_session"
SESSION_DAYS = 30
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}

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


def create_user(username: str, password: str) -> None:
    username = username.strip().lower()
    if not username or len(password) < 8:
        raise ValueError("Username required and password must be at least 8 characters")
    con = get_conn()
    if con.execute("SELECT 1 FROM users WHERE username = ?", [username]).fetchone():
        raise ValueError(f"User '{username}' already exists")
    con.execute("INSERT INTO users VALUES (?, ?, ?)", [username, hash_password(password), datetime.now()])


def set_password(username: str, password: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    con = get_conn()
    if not con.execute("SELECT 1 FROM users WHERE username = ?", [username.lower()]).fetchone():
        raise ValueError(f"No user '{username}'")
    con.execute("UPDATE users SET password_hash = ? WHERE username = ?", [hash_password(password), username.lower()])
    # Changing a password signs out every session of that user.
    con.execute("DELETE FROM sessions WHERE username = ?", [username.lower()])


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
    row = get_conn().execute("SELECT password_hash FROM users WHERE username = ?", [username]).fetchone()
    # Verify against a dummy hash for unknown users so timing doesn't reveal them.
    ok = verify_password(password, row[0] if row else _DUMMY_HASH)
    if not (row and ok):
        for k in keys:
            _failures[k].append(time.monotonic())
        return None
    for k in keys:
        _failures.pop(k, None)
    token = secrets.token_urlsafe(32)
    now = datetime.now()
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
    row = con.execute("SELECT username, expires FROM sessions WHERE token_hash = ?", [th]).fetchone()
    if not row:
        return None
    username, expires = row
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
