"""Background scan jobs. Each job loads bars for every symbol in the
universe (through the candle service, so data is cached and only missing
days hit the API, within Fyers' rate limits) and evaluates the conditions.
Jobs live in memory; results are kept for the latest few jobs."""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field

import pandas as pd

from app.analysis import scanner
from app.providers.base import AuthRequired
from app.services import market_sync, universes
from app.services.candles import CandleService

log = logging.getLogger(__name__)

BARS = 400  # enough for EMA 200 to settle and a 52-week lookback
CONCURRENCY = 4
KEEP_JOBS = 10
COLUMNS = ["time", "open", "high", "low", "close", "volume"]


@dataclass
class Job:
    id: str
    universe: str
    tf: str
    conditions: list[dict]
    total: int
    owner: str = ""
    status: str = "running"  # running | done | cancelled | error
    done: int = 0
    matches: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    message: str = ""
    started: float = field(default_factory=time.time)
    finished: float | None = None
    task: asyncio.Task | None = None

    def view(self) -> dict:
        elapsed = (self.finished or time.time()) - self.started
        rate = self.done / elapsed if elapsed > 0 and self.done else 0
        return {
            "id": self.id,
            "universe": self.universe,
            "tf": self.tf,
            "status": self.status,
            "message": self.message,
            "total": self.total,
            "done": self.done,
            "eta_seconds": round((self.total - self.done) / rate) if rate and self.status == "running" else None,
            "elapsed_seconds": round(elapsed),
            "matches": sorted(self.matches, key=lambda m: m["ticker"]),
            "errors": self.errors[-20:],
        }


_jobs: dict[str, Job] = {}


def get(job_id: str, owner: str | None = None) -> Job | None:
    job = _jobs.get(job_id)
    return job if job and (owner is None or job.owner == owner) else None


def start(service: CandleService, universe: str, tf: str, conditions: list[dict], symbols: list[dict],
          owner: str = "") -> Job:
    job = Job(uuid.uuid4().hex[:12], universe, tf, conditions, len(symbols), owner=owner)
    _jobs[job.id] = job
    for old in list(_jobs)[:-KEEP_JOBS]:
        _jobs.pop(old, None)
    job.task = asyncio.create_task(_run(job, service, symbols))
    return job


def cancel(job_id: str, owner: str | None = None) -> bool:
    job = get(job_id, owner)
    if not job or job.status != "running" or not job.task:
        return False
    job.task.cancel()
    return True


async def _run(job: Job, service: CandleService, symbols: list[dict]) -> None:
    # The whole market reads the cache the market sync keeps current: no
    # API calls, so more at once.
    cached = job.universe == universes.MARKET and job.tf in ("1D", "1W")
    max_age = market_sync.SCAN_MAX_AGE if cached else None
    sem = asyncio.Semaphore(16 if cached else CONCURRENCY)
    auth_failed = asyncio.Event()

    async def one(inst: dict) -> None:
        async with sem:
            if auth_failed.is_set():
                return
            try:
                rows = await service.get_candles(inst["symbol"], job.tf, BARS, max_age=max_age)
                df = pd.DataFrame(rows, columns=COLUMNS)
                if len(df) < 30:
                    return
                # Pattern detection is CPU work: keep it off the event loop.
                matched, details = await asyncio.to_thread(scanner.evaluate, df, job.conditions)
                if matched:
                    last, prev = df["close"].iloc[-1], df["close"].iloc[-2]
                    job.matches.append(
                        {
                            **inst,
                            "close": round(float(last), 2),
                            "change_pct": round(float((last / prev - 1) * 100), 2),
                            "time": int(df["time"].iloc[-1]),
                            "details": details,
                        }
                    )
            except AuthRequired:
                auth_failed.set()
            except Exception as e:  # one bad symbol shouldn't stop the scan
                log.warning("scan %s failed: %s", inst["symbol"], e)
                job.errors.append(f"{inst['ticker']}: {e}")
            finally:
                job.done += 1

    try:
        await asyncio.gather(*(one(s) for s in symbols))
        if auth_failed.is_set():
            job.status, job.message = "error", "Fyers login expired: connect again and re-run."
        else:
            job.status = "done"
    except asyncio.CancelledError:
        job.status = "cancelled"
    finally:
        job.finished = time.time()
