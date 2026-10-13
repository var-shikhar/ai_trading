from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Where `python -m app.serve` listens. Keep 127.0.0.1 behind a reverse
    # proxy (Caddy/Nginx); 0.0.0.0 exposes it on every network interface.
    host: str = "127.0.0.1"
    port: int = 8000

    # App database (users and their data). Postgres URL, e.g. Neon:
    #   postgresql+psycopg://user:pass@host/db?sslmode=require
    # Empty: a local SQLite file at APP_DB_PATH (development and tests).
    database_url: str = ""
    app_db_path: str = "data/app.sqlite"

    # Market-data cache (candles, instruments).
    db_path: str = "data/market.duckdb"
    # DuckDB caps (it may otherwise use up to 80% of RAM on big queries; on a
    # 1 GB server keep it small; larger work spills to disk instead).
    db_memory_limit: str = "256MB"
    db_threads: int = 2
    cors_origins: list[str] = ["http://localhost:5173"]
    frontend_url: str = "http://localhost:5173"

    # How far back 15m base candles are kept; older intraday requests are
    # served from the timeframe's own candles fetched from the API.
    intraday_base_days: int = 730
    # Minimum seconds between API refreshes of today's candles per symbol.
    refresh_seconds: int = 60

    fyers_app_id: str = ""
    fyers_secret_key: str = ""
    fyers_redirect_uri: str = "http://127.0.0.1:8000/api/auth/fyers/callback"

    kotak_consumer_key: str = ""
    kotak_consumer_secret: str = ""

    # App login. Every /api route needs a signed-in user unless this is off
    # (only for tests). Accounts are created with `python -m app.cli create-user`;
    # if ADMIN_USERNAME/ADMIN_PASSWORD are set and no user exists yet, that
    # account is created on startup.
    auth_required: bool = True
    admin_username: str = ""
    admin_password: str = ""
    admin_email: str = ""
    # Send the session cookie only over HTTPS (turn on when hosted).
    cookie_secure: bool = False
    # Trust X-Forwarded-For from a reverse proxy for login throttling.
    trust_proxy: bool = False

    # Alert delivery (optional). Telegram: create a bot with @BotFather, send
    # it a message, then use your chat id. Email: any SMTP server.
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True
    alert_email_to: str = ""
    # Run the alert engine (off in tests).
    alerts_enabled: bool = True

    @property
    def app_db_file(self) -> Path:
        path = Path(self.app_db_path)
        return path if path.is_absolute() else BACKEND_DIR / path

    @property
    def db_file(self) -> Path:
        path = Path(self.db_path)
        return path if path.is_absolute() else BACKEND_DIR / path


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    for prefix in ("postgres://", "postgresql://"):
        if s.database_url.startswith(prefix):
            s.database_url = "postgresql+psycopg://" + s.database_url[len(prefix):]
    return s
