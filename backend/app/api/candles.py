from calendar import timegm

from fastapi import APIRouter, HTTPException, Query

from app.db import get_conn

router = APIRouter(prefix="/api", tags=["candles"])

# Timeframes the chart can request, mapped to DuckDB intervals.
# All intraday timeframes are resampled from stored 1-minute candles.
TIMEFRAMES = {
    "1m": "1 minute",
    "3m": "3 minutes",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "4h": "4 hours",
}


@router.get("/timeframes")
def timeframes() -> list[str]:
    return [*TIMEFRAMES, "1D"]


@router.get("/candles")
def candles(
    symbol: str = Query(..., examples=["NSE:SBIN-EQ"]),
    tf: str = Query("5m"),
    limit: int = Query(1000, ge=1, le=20000),
):
    con = get_conn()
    if tf == "1D":
        rows = con.execute(
            """
            SELECT ts, open, high, low, close, volume FROM candles
            WHERE symbol = ? AND resolution = 'D'
            ORDER BY ts DESC LIMIT ?
            """,
            [symbol, limit],
        ).fetchall()
    elif tf in TIMEFRAMES:
        # Buckets are aligned to the 09:15 IST session open.
        rows = con.execute(
            f"""
            SELECT time_bucket(INTERVAL '{TIMEFRAMES[tf]}', ts, TIMESTAMP '2000-01-03 09:15:00') AS b,
                   arg_min(open, ts), max(high), min(low), arg_max(close, ts), sum(volume)
            FROM candles
            WHERE symbol = ? AND resolution = '1'
            GROUP BY b ORDER BY b DESC LIMIT ?
            """,
            [symbol, limit],
        ).fetchall()
    else:
        raise HTTPException(400, f"Unknown timeframe '{tf}'")

    return [
        # IST wall time sent as UTC epoch so the chart labels show IST.
        {"time": timegm(ts.timetuple()), "open": o, "high": h, "low": l, "close": c, "volume": v}
        for ts, o, h, l, c, v in reversed(rows)
    ]
