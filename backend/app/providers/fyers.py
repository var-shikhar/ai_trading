"""Fyers API v3 provider: OAuth login, historical candles, symbol master.

Endpoints mirror the official fyers-apiv3 SDK; we call them with httpx
directly so everything stays async.
"""

import hashlib
from collections.abc import AsyncIterator
from datetime import date, datetime, time, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import Settings
from app.providers.base import (
    AuthRequired,
    Candle,
    Instrument,
    MarketDataProvider,
    ProviderError,
    Tick,
)
from app.services import tokens
from app.services.ratelimit import RateLimiter

API = "https://api-t1.fyers.in/api/v3"
DATA_API = "https://api-t1.fyers.in/data"
SYMBOL_MASTER_URL = "https://public.fyers.in/sym_details/NSE_CM_sym_master.json"

IST = timezone(timedelta(hours=5, minutes=30))

# Fyers 'exInstType' codes in the NSE_CM symbol master we care about for swing.
INSTRUMENT_KINDS = {0: "EQ", 9: "ETF", 10: "INDEX"}

# Error codes Fyers returns for missing/expired/invalid tokens.
AUTH_ERROR_CODES = {-8, -15, -16, -17}

# Max days per history request: 100 for intraday, 366 for daily. Kept one
# under because both ends of the range are inclusive.
MAX_DAYS_INTRADAY = 99
MAX_DAYS_DAILY = 365


def now_ist() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


class FyersProvider(MarketDataProvider):
    name = "fyers"
    supports_history = True

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None):
        self.settings = settings
        self.client = client or httpx.AsyncClient(timeout=30)
        # Fyers allows 10/s and 200/min; stay a little under.
        self.limiter = RateLimiter((8, 1.0), (180, 60.0))

    # --- auth ---------------------------------------------------------------

    @property
    def configured(self) -> bool:
        return bool(self.settings.fyers_app_id and self.settings.fyers_secret_key)

    def login_url(self, state: str) -> str:
        params = {
            "client_id": self.settings.fyers_app_id,
            "redirect_uri": self.settings.fyers_redirect_uri,
            "response_type": "code",
            "state": state,
        }
        return f"{API}/generate-authcode?{urlencode(params)}"

    async def exchange_auth_code(self, auth_code: str) -> None:
        app_hash = hashlib.sha256(
            f"{self.settings.fyers_app_id}:{self.settings.fyers_secret_key}".encode()
        ).hexdigest()
        resp = await self.client.post(
            f"{API}/validate-authcode",
            json={"grant_type": "authorization_code", "appIdHash": app_hash, "code": auth_code},
        )
        body = resp.json()
        if body.get("s") != "ok" or "access_token" not in body:
            raise ProviderError(f"Fyers login failed: {body.get('message', body)}")
        # Access tokens are valid until the end of the day they were issued.
        expires = datetime.combine(now_ist().date() + timedelta(days=1), time.min)
        tokens.save_token(self.name, body["access_token"], expires)

    def is_authenticated(self) -> bool:
        return tokens.load_token(self.name, now_ist()) is not None

    def _auth_header(self) -> str:
        token = tokens.load_token(self.name, now_ist())
        if token is None:
            raise AuthRequired("Fyers login required")
        return f"{self.settings.fyers_app_id}:{token}"

    # --- history --------------------------------------------------------------

    async def get_history(
        self, symbol: str, resolution: str, start: date, end: date
    ) -> list[Candle]:
        is_daily = resolution in ("D", "1D")
        step = MAX_DAYS_DAILY if is_daily else MAX_DAYS_INTRADAY
        candles: dict[datetime, Candle] = {}
        chunk_start = start
        while chunk_start <= end:
            chunk_end = min(chunk_start + timedelta(days=step), end)
            for c in await self._history_chunk(symbol, resolution, chunk_start, chunk_end, is_daily):
                candles[c.ts] = c
            chunk_start = chunk_end + timedelta(days=1)
        return sorted(candles.values(), key=lambda c: c.ts)

    async def _history_chunk(
        self, symbol: str, resolution: str, start: date, end: date, is_daily: bool
    ) -> list[Candle]:
        body = await self._get(
            f"{DATA_API}/history",
            {
                "symbol": symbol,
                "resolution": "D" if is_daily else resolution,
                "date_format": 1,
                "range_from": start.isoformat(),
                "range_to": end.isoformat(),
                "cont_flag": 1,
            },
        )
        if body.get("s") == "no_data":
            return []
        out = []
        for epoch, o, h, l, c, v in body.get("candles", []):
            ts = datetime.fromtimestamp(epoch, IST).replace(tzinfo=None)
            if is_daily:
                ts = datetime.combine(ts.date(), time.min)
            out.append(Candle(ts, float(o), float(h), float(l), float(c), int(v)))
        return out

    async def _get(self, url: str, params: dict) -> dict:
        header = self._auth_header()
        await self.limiter.acquire()
        resp = await self.client.get(
            url, params=params, headers={"Authorization": header, "version": "3"}
        )
        try:
            body = resp.json()
        except ValueError:
            raise ProviderError(f"Fyers HTTP {resp.status_code}: {resp.text[:200]}") from None
        if resp.status_code == 401 or body.get("code") in AUTH_ERROR_CODES:
            tokens.clear_token(self.name)
            raise AuthRequired(body.get("message", "Fyers token expired"))
        if body.get("s") not in ("ok", "no_data"):
            raise ProviderError(f"Fyers error {body.get('code')}: {body.get('message', body)}")
        return body

    # --- instruments ----------------------------------------------------------

    async def fetch_instruments(self) -> list[Instrument]:
        resp = await self.client.get(SYMBOL_MASTER_URL, timeout=120)
        resp.raise_for_status()
        out = []
        for symbol, row in resp.json().items():
            kind = INSTRUMENT_KINDS.get(row.get("exInstType"))
            if kind is None or row.get("tradeStatus") != 1:
                continue
            out.append(
                Instrument(
                    symbol=symbol,
                    ticker=row.get("exSymbol") or symbol,
                    name=row.get("exSymName") or row.get("symDetails") or symbol,
                    exchange=row.get("exchangeName") or "NSE",
                    kind=kind,
                    lot_size=int(row.get("minLotSize") or 1),
                    tick_size=float(row.get("tickSize") or 0.05),
                )
            )
        return out

    # --- live -----------------------------------------------------------------

    def stream_ticks(self, symbols: list[str]) -> AsyncIterator[Tick]:
        # Swing charts refresh today's candles via history (see candle service);
        # websocket streaming comes later.
        raise NotImplementedError("Fyers live streaming not implemented yet")
