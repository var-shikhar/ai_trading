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
import sqlalchemy as sa

from app import store
from app.store import backtests as backtests_t
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
    owner: str
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


def get(job_id: str, owner: str) -> Job | None:
    j = _jobs.get(job_id)
    return j if j and j.owner == owner else None


def cancel(job_id: str, owner: str) -> bool:
    j = get(job_id, owner)
    if j and j.task and j.status in ("loading", "simulating"):
        j.task.cancel()
        return True
    return False


def bars_needed(start: date, tf: str) -> int:
    days = (date.today() - start).days
    trading = days * 5 / 7
    return int((trading if tf == "1D" else trading / 5) * 1.05) + WARMUP_BARS


def start(service: CandleService, request: dict, symbols: list[dict], rules: engine.Rules, owner: str) -> Job:
    job = Job(uuid.uuid4().hex[:12], owner, request, len(symbols))
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
        with store.tx() as c:
            c.execute(sa.insert(backtests_t).values(
                id=result_id, owner=job.owner, strategy_id=req.get("strategy_id"), name=req.get("name") or "Backtest",
                created=datetime.now(), request=_jsonable(req), summary=_jsonable(summary), result=_jsonable(payload),
            ))
        job.result_id = result_id
        job.status = "done"
    except AuthRequired:
        job.status, job.message = "error", "Fyers login expired: connect again and re-run."
    except asyncio.CancelledError:
        job.status = "cancelled"
    except Exception as e:
        log.exception("backtest failed")
        job.status, job.message = "error", str(e)


async def run_chart(service: CandleService, req: dict, rules: engine.Rules) -> dict:
    """One symbol on the chart's timeframe, computed straight away (not saved).
    Uses the same bars the chart shows, so trades line up with its candles."""
    df = await _load(service, req["symbol"], req["tf"], req["bars"])
    if len(df) < 30:
        raise ValueError("Not enough bars on this chart to backtest")
    data = await asyncio.to_thread(engine.prepare, df, req["entry"], req.get("exit_conditions", []))
    start_t, end_t = int(df["time"].iloc[0]), int(df["time"].iloc[-1])
    result = await asyncio.to_thread(engine.run, {req["symbol"]: data}, rules, start_t, end_t)
    trades, equity = result["trades"], result["equity"]
    summary = metrics.summarize(trades, equity, rules.capital, req["tf"])
    summary["exposure_pct"] = metrics.exposure_pct(trades, equity)
    first, last = float(df["close"].iloc[0]), float(df["close"].iloc[-1])
    summary["buy_hold_return_pct"] = round((last / first - 1) * 100, 2)
    ticker = req["symbol"].split(":")[-1].split("-")[0]
    return _jsonable({
        "request": req,
        "summary": summary,
        "equity": [[t, v] for t, v in equity],
        "buy_hold": [[int(t), round(rules.capital * c / first, 2)] for t, c in zip(df["time"], df["close"])],
        "trades": [{**asdict(t), "ticker": ticker} for t in trades],
        "bars_tested": len(df),
        "from": start_t,
        "to": end_t,
    })


def _jsonable(x):
    """JSON round-trip: numpy numbers etc. become plain types for the JSON column."""
    return json.loads(json.dumps(x, default=float))


def list_results(owner: str) -> list[dict]:
    q = (sa.select(backtests_t.c.id, backtests_t.c.name, backtests_t.c.created, backtests_t.c.request,
                   backtests_t.c.summary, backtests_t.c.strategy_id)
         .where(backtests_t.c.owner == owner).order_by(backtests_t.c.created.desc()).limit(100))
    return [{**r, "created": r["created"].isoformat(timespec="seconds")} for r in store.rows(q)]


def load_result(result_id: str, owner: str) -> dict | None:
    r = store.row(sa.select(backtests_t.c.result).where(backtests_t.c.id == result_id, backtests_t.c.owner == owner))
    return r["result"] if r else None


def delete_result(result_id: str, owner: str) -> None:
    with store.tx() as c:
        c.execute(sa.delete(backtests_t).where(backtests_t.c.id == result_id, backtests_t.c.owner == owner))
