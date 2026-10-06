from functools import lru_cache

from app.config import get_settings
from app.providers.fyers import FyersProvider
from app.services.candles import CandleService


@lru_cache
def get_fyers() -> FyersProvider:
    return FyersProvider(get_settings())


@lru_cache
def get_candle_service() -> CandleService:
    # Fyers is the history source; Kotak Neo has no historical API.
    return CandleService(get_fyers(), get_settings())
