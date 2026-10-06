from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    db_path: str = "data/market.duckdb"
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

    @property
    def db_file(self) -> Path:
        path = Path(self.db_path)
        return path if path.is_absolute() else BACKEND_DIR / path


@lru_cache
def get_settings() -> Settings:
    return Settings()
