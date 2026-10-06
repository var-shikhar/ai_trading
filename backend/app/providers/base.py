"""Common interface every market-data provider (Fyers, Kotak, ...) implements.

The rest of the app only talks to this interface, so providers can be
swapped or combined without touching charting/analysis code.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Candle:
    ts: datetime  # candle open time, IST
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass(frozen=True)
class Tick:
    symbol: str
    ts: datetime
    ltp: float
    volume: int | None = None


@dataclass(frozen=True)
class Instrument:
    symbol: str
    name: str
    exchange: str
    segment: str
    lot_size: int = 1
    tick_size: float = 0.05


class MarketDataProvider(ABC):
    name: str

    @property
    @abstractmethod
    def supports_history(self) -> bool: ...

    @abstractmethod
    async def is_authenticated(self) -> bool: ...

    @abstractmethod
    async def get_history(
        self, symbol: str, resolution: str, start: datetime, end: datetime
    ) -> list[Candle]:
        """Fetch candles. Providers handle their own per-request range limits."""

    @abstractmethod
    async def search_instruments(self, query: str, limit: int = 20) -> list[Instrument]: ...

    @abstractmethod
    def stream_ticks(self, symbols: list[str]) -> AsyncIterator[Tick]: ...
