"""Backtest jobs: load bars for every symbol (through the candle cache, within
Fyers' rate limits), build signals, simulate, store the result."""

import asyncio
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date, datetime

import pandas as pd

from app.backtest import engine, metrics
from app.db import get_conn
from app.providers.base import AuthRequired
from app.services.candles import CandleService

log = logging.getLogger(__name__)

COLUMNS = ["time", "open", "high", "low", "close", "volume"]
WARMUP_BARS = 300  # bars before the start date so EMA 200 etc. are settled
CONCURRENCY = 4
BENCHMARK = "NSE:NIFTY50-INDEX"
_jobs: dict[str, "Job"] = {}


@dataclass
class Job:
    id: str
    request: dict
    total: int
    status: str = "loading"  # loading | simulating | done | error | cancelled
    loaded: int = 0
    message: str = ""
    result_id: str | None = None
    errors: list[str] = field(default_factory=list)
    started: float = field(default_factory=time.time)
    task: asyncio.Task | None = None

    def view(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "message": self.message,
            "total": self.total,
            "loaded": self.loaded,
            "result_id": self.result_id,
            "errors": self.errors[-20:],
            "elapsed_seconds": round(time.time() - self.started),
        }


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def cancel(job_id: str) -> bool:
    j = _jobs.get(job_id)
    if j and j.task and j.status in ("loading", "simulating"):
        j.task.cancel()
        return True
    return False


def bars_needed(start: date, tf: str) -> int:
    days = (date.today() - start).days
    trading = days * 5 / 7
    return int((trading if tf == "1D" else trading / 5) * 1.05) + WARMUP_BARS


def start(service: CandleService, request: dict, symbols: list[dict], rules: engine.Rules) -> Job:
    job = Job(uuid.uuid4().hex[:12], request, len(symbols))
    _jobs[job.id] = job
    job.task = asyncio.create_task(_run(job, service, symbols, rules))
    return job


async def _load(service: CandleService, symbol: str, tf: str, bars: int) -> pd.DataFrame:
    rows = await service.get_candles(symbol, tf, bars)
    return pd.DataFrame(rows, columns=COLUMNS)


async def _run(job: Job, service: CandleService, symbols: list[dict], rules: engine.Rules) -> None:
    req = job.request
    tf = req["tf"]
    start_date = date.fromisoformat(req["start"])
    end_date = date.fromisoformat(req["end"]) if req.get("end") else date.today()
    # Bar times are IST wall-clock encoded as UTC epoch seconds.
    start_t = int(pd.Timestamp(start_date).timestamp())
    end_t = int(pd.Timestamp(end_date).timestamp()) + 86399
    bars = bars_needed(start_date, tf)
    sem = asyncio.Semaphore(CONCURRENCY)
    data: dict[str, engine.SymbolData] = {}
    names = {s["symbol"]: s for s in symbols}

    async def one(inst: dict) -> None:
        async with sem:
            try:
                df = await _load(service, inst["symbol"], tf, bars)
                if len(df) > 30:
                    data[inst["symbol"]] = await asyncio.to_thread(
                        engine.prepare, df, req["entry"], req.get("exit_conditions", [])
                    )
            except AuthRequired:
                raise
            except Exception as e:
                job.errors.append(f"{inst['ticker']}: {e}")
            finally:
                job.loaded += 1

    try:
        await asyncio.gather(*(one(s) for s in symbols))
        job.status = "simulating"
        result = await asyncio.to_thread(engine.run, data, rules, start_t, end_t)
        trades, equity = result["trades"], result["equity"]
        summary = metrics.summarize(trades, equity, rules.capital, tf)
        summary["exposure_pct"] = metrics.exposure_pct(trades, equity)

        benchmark = None
        try:
            bdf = await _load(service, BENCHMARK, tf, bars)
            bdf = bdf[(bdf["time"] >= start_t) & (bdf["time"] <= end_t)]
            if len(bdf):
                first = float(bdf["close"].iloc[0])
                benchmark = [[int(t), round(rules.capital * c / first, 2)] for t, c in zip(bdf["time"], bdf["close"])]
                summary["benchmark_return_pct"] = round((benchmark[-1][1] / rules.capital - 1) * 100, 2)
        except Exception as e:  # benchmark is optional
            log.info("benchmark unavailable: %s", e)

        result_id = uuid.uuid4().hex[:12]
        payload = {
            "id": result_id,
            "request": req,
            "summary": summary,
            "equity": [[t, v] for t, v in equity],
            "benchmark": benchmark,
            "yearly": metrics.yearly_returns(equity, rules.capital),
            "per_symbol": metrics.per_symbol(trades),
            "trades": [
                {**asdict(t), "ticker": names.get(t.symbol, {}).get("ticker", t.symbol)} for t in trades
            ],
            "skipped": job.errors[-50:],
            "symbols_tested": len(data),
        }
        get_conn().execute(
            "INSERT INTO backtests VALUES (?, ?, ?, ?, ?, ?)",
            [result_id, req.get("name") or "Backtest", datetime.now(), json.dumps(req), json.dumps(summary),
             json.dumps(payload)],
        )
        job.result_id = result_id
        job.status = "done"
    except AuthRequired:
        job.status, job.message = "error", "Fyers login expired: connect again and re-run."
    except asyncio.CancelledError:
        job.status = "cancelled"
    except Exception as e:
        log.exception("backtest failed")
        job.status, job.message = "error", str(e)


def list_results() -> list[dict]:
    rows = get_conn().execute(
        "SELECT id, name, created, request, summary FROM backtests ORDER BY created DESC LIMIT 100"
    ).fetchall()
    return [
        {"id": i, "name": n, "created": c.isoformat(timespec="seconds"), "request": json.loads(r), "summary": json.loads(s)}
        for i, n, c, r, s in rows
    ]


def load_result(result_id: str) -> dict | None:
    row = get_conn().execute("SELECT result FROM backtests WHERE id = ?", [result_id]).fetchone()
    return json.loads(row[0]) if row else None


def delete_result(result_id: str) -> None:
    get_conn().execute("DELETE FROM backtests WHERE id = ?", [result_id])
