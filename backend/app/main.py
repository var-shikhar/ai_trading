import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth, candles, chart, drawings, instruments, live, patterns, scanner, session
from app.config import get_settings
from app.db import close_conn, get_conn
from app.deps import get_fyers
from app.services import accounts
from app.services.instruments import refresh_if_stale

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# Reachable without signing in. The Fyers callback is protected by its
# one-time OAuth state instead (it may arrive on a different host/port than
# the app's cookie, e.g. 127.0.0.1:8000 vs localhost:5173 in development).
PUBLIC_PATHS = {"/api/session/login", "/api/session/logout", "/api/session/me", "/api/health", "/api/auth/fyers/callback"}


def bootstrap_admin() -> None:
    s = get_settings()
    if s.admin_username and s.admin_password and accounts.user_count() == 0:
        accounts.create_user(s.admin_username, s.admin_password)
        log.info("Created admin user '%s' from .env", s.admin_username)
    if s.auth_required and accounts.user_count() == 0:
        log.warning("No users yet: create one with `python -m app.cli create-user <name>`")


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_conn()  # create DB file and schema on startup
    bootstrap_admin()
    # Symbol master is public (no login needed); refresh in the background.
    task = asyncio.create_task(refresh_if_stale(get_fyers()))
    yield
    task.cancel()
    await live.get_hub().close()
    close_conn()


app = FastAPI(title="Indicator", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def require_login(request: Request, call_next):
    token = request.cookies.get(accounts.SESSION_COOKIE)
    request.state.user = accounts.session_user(token)
    path = request.url.path
    if (
        get_settings().auth_required
        and path.startswith("/api")
        and path not in PUBLIC_PATHS
        and not request.state.user
    ):
        return JSONResponse({"detail": "Not signed in"}, status_code=401)
    return await call_next(request)


app.include_router(session.router)
app.include_router(auth.router)
app.include_router(instruments.router)
app.include_router(candles.router)
app.include_router(chart.router)
app.include_router(patterns.router)
app.include_router(drawings.router)
app.include_router(scanner.router)
app.include_router(live.router)


@app.get("/api/health")
def health():
    con = get_conn()
    candles_count = con.execute("SELECT count(*) FROM candles").fetchone()[0]
    instruments_count = con.execute("SELECT count(*) FROM instruments").fetchone()[0]
    return {"status": "ok", "candles": candles_count, "instruments": instruments_count}
