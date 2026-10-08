import math

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.analysis import studies
from app.analysis.indicators import CHART_INDICATORS, WARMUP_BARS
from app.deps import get_candle_service
from app.providers.base import AuthRequired, ProviderError
from app.services.candles import TIMEFRAMES, CandleService

router = APIRouter(prefix="/api", tags=["chart"])


COLUMNS = ["time", "open", "high", "low", "close", "volume"]


async def load_frame(service: CandleService, symbol: str, tf: str, limit: int) -> pd.DataFrame:
    """The latest `limit` bars plus WARMUP_BARS before them, as a DataFrame."""
    if tf not in TIMEFRAMES:
        raise HTTPException(400, f"Unknown timeframe '{tf}'. Use one of {list(TIMEFRAMES)}")
    try:
        rows = await service.get_candles(symbol, tf, limit + WARMUP_BARS)
    except AuthRequired as e:
        raise HTTPException(401, str(e)) from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    return pd.DataFrame(rows, columns=COLUMNS)


def candle_records(df: pd.DataFrame) -> list[dict]:
    """Plain-Python candle dicts (numpy scalars don't serialise to JSON)."""
    return [
        {"time": int(t), "open": float(o), "high": float(h), "low": float(l), "close": float(c), "volume": int(v)}
        for t, o, h, l, c, v in df[COLUMNS].itertuples(index=False)
    ]


@router.get("/chart")
async def chart(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("1D"),
    limit: int = Query(500, ge=1, le=20000),
    service: CandleService = Depends(get_candle_service),
):
    """Latest `limit` candles plus indicators. To load older history, call
    again with a larger `limit`; indicators stay consistent across reloads."""
    df = await load_frame(service, symbol, tf, limit)
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
        "candles": candle_records(df.iloc[-limit:]),
        "indicators": indicators,
        # Fewer bars than asked for means we reached the start of available history.
        "has_more": len(df) >= limit + WARMUP_BARS,
    }


class StudyRequest(BaseModel):
    uid: str = Field(..., max_length=64, description="Client id for this instance, echoed back")
    id: str
    params: dict = Field(default_factory=dict)


class ChartRequest(BaseModel):
    symbol: str
    tf: str = "1D"
    limit: int = Field(500, ge=1, le=20000)
    studies: list[StudyRequest] = Field(default_factory=list, max_length=30)


def series_points(df: pd.DataFrame, values: pd.Series, visible: pd.Index) -> list[dict]:
    out = []
    for i in visible:
        v = float(values[i])
        if math.isfinite(v):  # skips warm-up NaNs and divide-by-zero infs
            out.append({"time": int(df.at[i, "time"]), "value": round(v, 4)})
    return out


@router.post("/chart")
async def chart_with_studies(
    req: ChartRequest, service: CandleService = Depends(get_candle_service)
):
    """Candles plus any configured studies (see /api/studies/catalog)."""
    unknown = [s.id for s in req.studies if s.id not in studies.STUDIES_BY_ID]
    if unknown:
        raise HTTPException(400, f"Unknown studies: {unknown}")

    df = await load_frame(service, req.symbol, req.tf, req.limit)
    visible = df.index[-req.limit :]
    results = {}
    for s in req.studies:
        study = studies.STUDIES_BY_ID[s.id]
        params = studies.resolve_params(study, s.params)
        values = studies.compute(study, df, params)
        results[s.uid] = {
            "params": params,
            "outputs": {key: series_points(df, series, visible) for key, series in values.items()},
        }
    return {
        "candles": candle_records(df.iloc[-req.limit :]),
        "studies": results,
        "has_more": len(df) >= req.limit + WARMUP_BARS,
    }


@router.get("/studies/catalog")
def studies_catalog():
    return studies.catalog()
