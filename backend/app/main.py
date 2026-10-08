import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, candles, chart, drawings, instruments, patterns, scanner
from app.config import get_settings
from app.db import close_conn, get_conn
from app.deps import get_fyers
from app.services.instruments import refresh_if_stale

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_conn()  # create DB file and schema on startup
    # Symbol master is public (no login needed); refresh in the background.
    task = asyncio.create_task(refresh_if_stale(get_fyers()))
    yield
    task.cancel()
    close_conn()


app = FastAPI(title="Indicator", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(instruments.router)
app.include_router(candles.router)
app.include_router(chart.router)
app.include_router(patterns.router)
app.include_router(drawings.router)
app.include_router(scanner.router)


@app.get("/api/health")
def health():
    con = get_conn()
    candles_count = con.execute("SELECT count(*) FROM candles").fetchone()[0]
    instruments_count = con.execute("SELECT count(*) FROM instruments").fetchone()[0]
    return {"status": "ok", "candles": candles_count, "instruments": instruments_count}
