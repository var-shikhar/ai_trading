"""Common interface every market-data provider (Fyers, Kotak, ...) implements.

The rest of the app only talks to this interface, so providers can be
swapped or combined without touching charting/analysis code.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import date, datetime


@dataclass(frozen=True)
class Candle:
    ts: datetime  # candle open time, naive IST (daily candles: 00:00)
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
    symbol: str  # provider symbol, e.g. NSE:SBIN-EQ (or alias NSE:NIFTY1!)
    ticker: str  # e.g. SBIN
    name: str
    exchange: str  # NSE, BSE, MCX
    kind: str  # EQ, ETF, INDEX, FUT (NSE futures), COM (MCX commodities)
    lot_size: int = 1
    tick_size: float = 0.05
    expiry: date | None = None
    underlying: str = ""
    session_start: str = "09:15"  # IST
    session_end: str = "15:30"
    actual: str | None = None  # continuous alias -> current front contract


class ProviderError(Exception):
    pass


class AuthRequired(ProviderError):
    """The provider needs a (new) login before it can serve data."""


class MarketDataProvider(ABC):
    name: str
    supports_history: bool

    @abstractmethod
    def is_authenticated(self) -> bool: ...

    @abstractmethod
    async def get_history(
        self, symbol: str, resolution: str, start: date, end: date
    ) -> list[Candle]:
        """Candles for [start, end] inclusive, in provider resolution codes
        ('1', '5', '15', '60', '240', 'D', ...). Providers split the range
        into chunks to respect their own per-request limits."""

    @abstractmethod
    async def fetch_instruments(self) -> list[Instrument]: ...

    @abstractmethod
    def stream_ticks(self, symbols: list[str]) -> AsyncIterator[Tick]: ...
