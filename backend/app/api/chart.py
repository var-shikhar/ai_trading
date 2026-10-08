import math

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from app.analysis.indicators import CHART_INDICATORS, WARMUP_BARS
from app.deps import get_candle_service
from app.providers.base import AuthRequired, ProviderError
from app.services.candles import TIMEFRAMES, CandleService

router = APIRouter(prefix="/api", tags=["chart"])


@router.get("/chart")
async def chart(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("1D"),
    limit: int = Query(500, ge=1, le=20000),
    service: CandleService = Depends(get_candle_service),
):
    """Latest `limit` candles plus indicators. To load older history, call
    again with a larger `limit`; indicators stay consistent across reloads."""
    if tf not in TIMEFRAMES:
        raise HTTPException(400, f"Unknown timeframe '{tf}'. Use one of {list(TIMEFRAMES)}")
    try:
        rows = await service.get_candles(symbol, tf, limit + WARMUP_BARS)
    except AuthRequired as e:
        raise HTTPException(401, str(e)) from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e

    df = pd.DataFrame(rows, columns=["time", "open", "high", "low", "close", "volume"])
    visible = df.index[-limit:]
    indicators = {}
    for key, fn in CHART_INDICATORS.items():
        values = fn(df) if len(df) else pd.Series(dtype=float)
        indicators[key] = [
            {"time": int(df.at[i, "time"]), "value": round(float(values[i]), 4)}
            for i in visible
            if not math.isnan(values[i])
        ]

    return {
        "candles": rows[-limit:],
        "indicators": indicators,
        # Fewer bars than asked for means we reached the start of available history.
        "has_more": len(rows) >= limit + WARMUP_BARS,
    }
