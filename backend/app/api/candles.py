from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.deps import get_candle_service
from app.providers.base import AuthRequired, ProviderError
from app.services.candles import TIMEFRAMES, CandleService

router = APIRouter(prefix="/api", tags=["candles"])


@router.get("/timeframes")
def timeframes() -> list[str]:
    return list(TIMEFRAMES)


@router.get("/candles")
async def candles(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("1D"),
    limit: int = Query(500, ge=1, le=5000),
    end: date | None = Query(None, description="Last date to include (default today)"),
    service: CandleService = Depends(get_candle_service),
):
    if tf not in TIMEFRAMES:
        raise HTTPException(400, f"Unknown timeframe '{tf}'. Use one of {list(TIMEFRAMES)}")
    try:
        return await service.get_candles(symbol, tf, limit, end)
    except AuthRequired as e:
        raise HTTPException(401, str(e)) from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
