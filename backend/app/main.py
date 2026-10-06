from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import candles
from app.config import get_settings
from app.db import close_conn, get_conn


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_conn()  # create DB file and schema on startup
    yield
    close_conn()


app = FastAPI(title="Indicator", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(candles.router)


@app.get("/api/health")
def health():
    con = get_conn()
    count = con.execute("SELECT count(*) FROM candles").fetchone()[0]
    return {"status": "ok", "candles": count}
