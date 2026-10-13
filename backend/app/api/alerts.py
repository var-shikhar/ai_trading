from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.alerts import engine as alert_engine
from app.alerts import notify
from app.analysis import scanner
from app.deps import current_user

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@lru_cache
def get_engine() -> alert_engine.AlertEngine:
    from app.api.live import get_hub
    from app.deps import get_candle_service, get_fyers

    return alert_engine.AlertEngine(get_hub(), get_candle_service(), get_fyers().is_authenticated)


class AlertIn(BaseModel):
    kind: Literal["price", "drawing", "condition", "scan"]
    symbol: str | None = None
    ticker: str | None = None
    name: str = Field("", max_length=80)
    config: dict
    tf: str | None = None
    frequency: Literal["once", "once_per_bar", "every"] = "once"
    channels: list[Literal["app", "telegram", "email"]] = Field(default_factory=lambda: ["app"], min_length=1)
    message: str = Field("", max_length=300)
    expires: str | None = None  # ISO date/time
    status: Literal["active", "paused"] = "active"

    @model_validator(mode="after")
    def check(self):
        c = self.config
        if self.kind in ("price", "drawing", "condition") and not self.symbol:
            raise ValueError("Alert needs a symbol")
        if self.kind == "price" and ("op" not in c or "value" not in c):
            raise ValueError("Price alert needs op and value")
        if self.kind == "drawing" and not (1 <= len(c.get("points", [])) <= 2):
            raise ValueError("Drawing alert needs the line's points")
        if self.kind in ("condition", "scan"):
            conds = c.get("conditions") or []
            if not conds or any(x.get("type") not in scanner.CONDITIONS for x in conds):
                raise ValueError("Unknown or missing conditions")
        if self.kind == "condition" and not self.tf:
            raise ValueError("Condition alert needs a timeframe")
        if self.kind == "scan" and not c.get("universe"):
            raise ValueError("Scan alert needs a symbol list")
        return self


@router.get("")
def list_alerts(user: str = Depends(current_user)):
    eng = get_engine()
    return {"alerts": alert_engine.list_alerts(user), "engine": eng.status, "channels": notify.available_channels(user)}


@router.post("")
async def create(body: AlertIn, user: str = Depends(current_user)):
    a = alert_engine.save_alert(body.model_dump(), owner=user)
    await get_engine().refresh()
    return a


@router.put("/{alert_id}")
async def update(alert_id: str, body: AlertIn, user: str = Depends(current_user)):
    if not alert_engine.get_alert(alert_id, owner=user):
        raise HTTPException(404, "Alert not found")
    a = alert_engine.save_alert({**body.model_dump(), "id": alert_id}, owner=user)
    await get_engine().refresh()
    return a


@router.delete("/{alert_id}")
async def delete(alert_id: str, user: str = Depends(current_user)):
    alert_engine.delete_alert(alert_id, owner=user)
    await get_engine().refresh()
    return {"ok": True}


@router.get("/events")
def events(limit: int = 200, user: str = Depends(current_user)):
    return alert_engine.list_events(user, min(limit, 1000))


@router.post("/test")
async def test(channels: list[str] | None = None, user: str = Depends(current_user)):
    """Send a test notification to check the channel setup."""
    eng = get_engine()
    event = {"type": "alert", "alert_id": None, "symbol": None, "title": "Test alert", "body": "Notifications work.",
             "time": alert_engine.now_ist()}
    return await notify.deliver(channels or ["app", "telegram", "email"], "Test alert", "Notifications work.",
                                lambda: eng.hub.broadcast(event, user=user), owner=user)
