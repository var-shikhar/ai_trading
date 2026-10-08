"""Fyers API v3 provider: OAuth login, historical candles, symbol master.

Endpoints mirror the official fyers-apiv3 SDK; we call them with httpx
directly so everything stays async.
"""

import asyncio
import csv
import hashlib
import io
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
SYMBOL_MASTER_URL = "https://public.fyers.in/sym_details/{segment}.csv"

IST = timezone(timedelta(hours=5, minutes=30))

# Symbol master files and the instrument-type codes we keep from each
# (options are left out: ~100k contracts). Our kinds: EQ, ETF, INDEX,
# FUT (NSE index/stock futures), COM (MCX commodity futures).
SYMBOL_MASTERS: dict[str, dict[int, str]] = {
    "NSE_CM": {0: "EQ", 9: "ETF", 10: "INDEX"},
    "BSE_CM": {0: "EQ", 4: "ETF", 10: "INDEX"},
    "NSE_FO": {11: "FUT", 13: "FUT"},
    "MCX_COM": {30: "COM", 11: "COM"},
}

# Column positions in the (headerless) symbol master CSVs.
COL_NAME, COL_TYPE, COL_LOT, COL_TICK, COL_SESSION, COL_EXPIRY, COL_SYMBOL, COL_UNDERLYING = (
    1, 2, 3, 4, 6, 8, 9, 13,
)

# Retries for "request limit reached" (HTTP 429), with exponential backoff.
RETRIES = 4
RETRY_BASE_SECONDS = 1.0

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
        # Fyers documents 10/s and 200/min, but its history endpoint answers
        # 429 below that in practice; stay well under and retry 429s.
        self.limiter = RateLimiter((5, 1.0), (150, 60.0))

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
        for attempt in range(RETRIES + 1):
            await self.limiter.acquire()
            resp = await self.client.get(
                url, params=params, headers={"Authorization": header, "version": "3"}
            )
            try:
                body = resp.json()
            except ValueError:
                raise ProviderError(f"Fyers HTTP {resp.status_code}: {resp.text[:200]}") from None
            if (resp.status_code == 429 or body.get("code") == 429) and attempt < RETRIES:
                await asyncio.sleep(RETRY_BASE_SECONDS * 2**attempt)  # 1, 2, 4, 8 s
                continue
            break
        if resp.status_code == 401 or body.get("code") in AUTH_ERROR_CODES:
            tokens.clear_token(self.name)
            raise AuthRequired(body.get("message", "Fyers token expired"))
        if body.get("s") not in ("ok", "no_data"):
            raise ProviderError(f"Fyers error {body.get('code')}: {body.get('message', body)}")
        return body

    # --- instruments ----------------------------------------------------------

    async def fetch_instruments(self) -> list[Instrument]:
        """All instruments from the public symbol masters (no login needed),
        plus continuous futures aliases like NSE:NIFTY1!."""
        texts = await asyncio.gather(*(self._download_master(seg) for seg in SYMBOL_MASTERS))
        today = now_ist().date()
        out: list[Instrument] = []
        for (segment, kinds), text in zip(SYMBOL_MASTERS.items(), texts):
            for row in csv.reader(io.StringIO(text)):
                inst = parse_master_row(row, kinds, today)
                if inst:
                    out.append(inst)
        return out + continuous_aliases(out)

    async def _download_master(self, segment: str) -> str:
        resp = await self.client.get(SYMBOL_MASTER_URL.format(segment=segment), timeout=120)
        resp.raise_for_status()
        return resp.text

    # --- live -----------------------------------------------------------------

    def stream_ticks(self, symbols: list[str]) -> AsyncIterator[Tick]:
        # Swing charts refresh today's candles via history (see candle service);
        # websocket streaming comes later.
        raise NotImplementedError("Fyers live streaming not implemented yet")


def _session(raw: str) -> tuple[str, str]:
    """'0915-1530|1815-1915:' -> ('09:15', '15:30'); the first range is the
    regular session."""
    try:
        start, end = raw.split("|")[0].strip(":").split("-")
        return f"{start[:2]}:{start[2:4]}", f"{end[:2]}:{end[2:4]}"
    except ValueError:
        return "09:15", "15:30"


def parse_master_row(row: list[str], kinds: dict[int, str], today: date) -> Instrument | None:
    try:
        kind = kinds.get(int(row[COL_TYPE]))
    except (IndexError, ValueError):
        return None
    if kind is None:
        return None
    symbol = row[COL_SYMBOL]
    exchange = symbol.split(":")[0]
    code = symbol.split(":")[1]
    expiry = None
    if kind in ("FUT", "COM"):
        try:
            expiry = datetime.fromtimestamp(int(row[COL_EXPIRY]), IST).date()
        except ValueError:
            return None
        if expiry < today:
            return None
        ticker = code
    else:
        # NSE:SBIN-EQ -> SBIN, BSE:RELIANCE-A -> RELIANCE, NSE:NIFTY50-INDEX -> NIFTY50
        ticker = code.rsplit("-", 1)[0]
    name = row[COL_NAME]
    if kind == "INDEX":
        name = name.removesuffix("-INDEX")
    start, end = _session(row[COL_SESSION])
    return Instrument(
        symbol=symbol,
        ticker=ticker,
        name=name,
        exchange=exchange,
        kind=kind,
        lot_size=int(float(row[COL_LOT] or 1)) or 1,
        tick_size=float(row[COL_TICK] or 0.05),
        expiry=expiry,
        underlying=row[COL_UNDERLYING],
        session_start=start,
        session_end=end,
    )


def continuous_aliases(instruments: list[Instrument]) -> list[Instrument]:
    """One TradingView-style 'X1!' alias per underlying, pointing at its
    nearest-expiry contract. Fyers returns continuous history for futures
    (cont_flag=1), so the alias chart spans past expiries."""
    front: dict[tuple[str, str], Instrument] = {}
    for inst in instruments:
        if inst.expiry is None:
            continue
        key = (inst.exchange, inst.underlying)
        if key not in front or inst.expiry < front[key].expiry:
            front[key] = inst
    out = []
    for (exchange, underlying), f in front.items():
        out.append(
            Instrument(
                symbol=f"{exchange}:{underlying}1!",
                ticker=f"{underlying}1!",
                name=f"{underlying} futures · continuous",
                exchange=exchange,
                kind=f.kind,
                lot_size=f.lot_size,
                tick_size=f.tick_size,
                expiry=f.expiry,
                underlying=underlying,
                session_start=f.session_start,
                session_end=f.session_end,
                actual=f.symbol,
            )
        )
    return out
