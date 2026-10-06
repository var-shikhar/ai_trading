from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    db_path: str = "data/market.duckdb"
    cors_origins: list[str] = ["http://localhost:5173"]

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
