from datetime import datetime

from app.db import get_conn


def save_token(provider: str, access_token: str, expires_at: datetime) -> None:
    get_conn().execute(
        "INSERT OR REPLACE INTO tokens VALUES (?, ?, ?)", [provider, access_token, expires_at]
    )


def load_token(provider: str, now: datetime) -> str | None:
    row = get_conn().execute(
        "SELECT access_token FROM tokens WHERE provider = ? AND expires_at > ?", [provider, now]
    ).fetchone()
    return row[0] if row else None


def clear_token(provider: str) -> None:
    get_conn().execute("DELETE FROM tokens WHERE provider = ?", [provider])
