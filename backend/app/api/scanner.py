from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.analysis import scanner
from app.deps import current_user, get_candle_service
from app.services import scan_jobs, universes
from app.services.candles import CandleService

router = APIRouter(prefix="/api/scanner", tags=["scanner"])

SCAN_TIMEFRAMES = {"1D", "1W"}


class Condition(BaseModel):
    type: str
    params: dict = Field(default_factory=dict)


class ScanRequest(BaseModel):
    universe: str
    tf: str = "1D"
    conditions: list[Condition] = Field(..., min_length=1, max_length=10)
    custom: list[str] = Field(default_factory=list, max_length=500)


@router.get("/catalog")
def catalog(user: str = Depends(current_user)):
    return {
        "universes": universes.catalog(user),
        "conditions": list(scanner.CONDITIONS),
        "presets": scanner.PRESETS,
        "timeframes": sorted(SCAN_TIMEFRAMES),
    }


@router.post("/run")
async def run(req: ScanRequest, service: CandleService = Depends(get_candle_service),
              user: str = Depends(current_user)):
    if req.tf not in SCAN_TIMEFRAMES:
        raise HTTPException(400, f"Scans run on {sorted(SCAN_TIMEFRAMES)}")
    unknown = [c.type for c in req.conditions if c.type not in scanner.CONDITIONS]
    if unknown:
        raise HTTPException(400, f"Unknown conditions: {unknown}")
    try:
        symbols = await universes.members(req.universe, req.custom, owner=user)
    except KeyError:
        raise HTTPException(400, f"Unknown universe '{req.universe}'") from None
    except Exception as e:
        raise HTTPException(502, f"Couldn't load the {req.universe} list: {e}") from e
    if not symbols:
        raise HTTPException(400, "No symbols to scan (empty list, or symbols not found)")
    job = scan_jobs.start(service, req.universe, req.tf, [c.model_dump() for c in req.conditions], symbols, owner=user)
    return job.view()


@router.get("/jobs/{job_id}")
def job(job_id: str, user: str = Depends(current_user)):
    j = scan_jobs.get(job_id, user)
    if not j:
        raise HTTPException(404, "Scan not found (the server may have restarted)")
    return j.view()


@router.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, user: str = Depends(current_user)):
    return {"cancelled": scan_jobs.cancel(job_id, user)}
