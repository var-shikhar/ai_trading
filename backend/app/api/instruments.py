from fastapi import APIRouter, Depends, Query

from app.deps import get_fyers
from app.providers.fyers import FyersProvider
from app.services import instruments

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


@router.get("/search")
def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=100),
    kind: str | None = Query(None, description="EQ, ETF, INDEX, FUT or COM"),
):
    return instruments.search(q, limit, kind)


@router.post("/refresh")
async def refresh(fyers: FyersProvider = Depends(get_fyers)):
    count = await instruments.refresh_instruments(fyers)
    return {"count": count}
