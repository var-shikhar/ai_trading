from fastapi import APIRouter, Depends, HTTPException, Query

from app.analysis import candlestick, chart_patterns
from app.api.chart import load_frame
from app.deps import get_candle_service
from app.services.candles import CandleService

router = APIRouter(prefix="/api/patterns", tags=["patterns"])


@router.get("/candlestick/catalog")
def candlestick_catalog():
    return {
        "patterns": candlestick.catalog(),
        "trend_lookback": candlestick.TREND_LOOKBACK,
        "outcome_bars": candlestick.OUTCOME_BARS,
    }


@router.get("/candlestick")
async def candlestick_patterns(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("1D"),
    limit: int = Query(500, ge=1, le=20000),
    patterns: str | None = Query(
        None, description="Comma-separated pattern ids; default: all common patterns"
    ),
    all_patterns: bool = Query(False, description="Include uncommon/noisy patterns too"),
    in_context: bool = Query(True, description="Only hits where the prior trend fits"),
    service: CandleService = Depends(get_candle_service),
):
    """Pattern hits on the same bars /api/chart returns for these parameters,
    plus per-pattern outcome stats over those hits."""
    if patterns:
        ids = [p.strip() for p in patterns.split(",") if p.strip()]
        unknown = [i for i in ids if i not in candlestick.PATTERNS_BY_ID]
        if unknown:
            raise HTTPException(400, f"Unknown pattern ids: {unknown}")
    elif all_patterns:
        ids = [p.id for p in candlestick.PATTERNS]
    else:
        ids = [p.id for p in candlestick.PATTERNS if p.common]

    df = await load_frame(service, symbol, tf, limit)
    # Detect on everything loaded (so the trend check has bars before the
    # first visible one), then keep hits on visible bars.
    first_visible = len(df) - min(limit, len(df))
    hits = [
        h
        for h in candlestick.detect(df, ids)
        if h["index"] >= first_visible and (h["in_context"] or not in_context)
    ]
    for h in hits:
        del h["index"]
    return {"hits": hits, "stats": candlestick.outcome_stats(hits)}


@router.get("/chart")
async def chart_pattern_scan(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("1D"),
    limit: int = Query(500, ge=1, le=20000),
    sensitivity: str = Query("medium", pattern="^(low|medium|high)$"),
    service: CandleService = Depends(get_candle_service),
):
    """Chart patterns (double tops, H&S, triangles, flags) ending on the
    bars /api/chart shows, plus support/resistance zones."""
    df = await load_frame(service, symbol, tf, limit)
    result = chart_patterns.detect(df, sensitivity)
    if len(df):
        first_visible = int(df["time"].iloc[-min(limit, len(df))])
        result["patterns"] = [p for p in result["patterns"] if p["end_time"] >= first_visible]
        result["swings"] = [s for s in result["swings"] if s["time"] >= first_visible]
    return result
