"""Strategy 002 backtester (rules: spec.md). Both stacks, both cost models.

    <app>/backend/.venv/Scripts/python.exe backtest.py grid H|D     # in-sample 36-cell grid
    <app>/backend/.venv/Scripts/python.exe backtest.py select H|D   # pre-registered selection -> out/chosen_<stack>.json
    <app>/backend/.venv/Scripts/python.exe backtest.py final H|D    # out-of-sample once + baselines + portfolio
    <app>/backend/.venv/Scripts/python.exe backtest.py sens H|D     # one-at-a-time sensitivity, both periods

Conventions: orders are placed at bar close for the next bar; gaps through
stops fill at the open; within a bar the OHLC path rule (open nearer the high
=> O-H-L-C, else O-L-H-C). Results are in R per planned position (planned
risk = 1R, so a limit entry whose part 2 never fills risks less than 1R).
Every trade is costed under both models: "cash" (0.1% fees + 0.05% slippage
per side, ~0.32% round trip) and "fut" (0.015% + 0.05% per side, ~0.13%).
"""

import itertools
import json
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "common"))
import features  # noqa: E402

OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
COST_SIDE = {"cash": 0.0015, "fut": 0.00065}
BE_PLUS = 0.003  # part 2's stop after T1: breakeven + ~round-trip costs
N_SEEDS = 50

STACK = {
    "D": dict(start="2005-01-01", is_end="2018-12-31", oos_start="2019-01-01", end="2026-12-31",
              max_pb_bars=8, entry_window=3, max_bars=30, scratch_k=3, judged="cash", min_n=300),
    "H": dict(start="2023-11-01", is_end="2025-10-31", oos_start="2025-11-01", end="2026-12-31",
              max_pb_bars=12, entry_window=7, max_bars=35, scratch_k=7, judged="fut", min_n=300),
}


@dataclass(frozen=True)
class Params:
    setup: str = "trap"  # trap | plain
    entry: str = "stop"  # stop | limit | hybrid
    exit: str = "trail"  # trail | twopart
    scratch: str = "none"  # none | time | follow
    mom_min: float = 0.7
    max_pb_bars: int = 8
    entry_window: int = 3
    max_bars: int = 30
    scratch_k: int = 3
    stop_buf: float = 0.1  # x ATR below the pullback low
    t1_gate: float = 1.0  # part 1 at T1 only if T1 - entry >= t1_gate x risk
    nochase: float = 0.5  # x ATR: skip a buy-stop gapped above its trigger by more
    chan: int = 20  # channel period
    gap_rule: bool = True  # stack H: no fills in the first bar of a session gapping > 0.5 daily ATR
    max_risk: float = 0.08
    min_risk_atr: float = 0.5  # skip if the stop is closer than this x ATR (amendment 1, spec.md)


def params_for(stack: str, **kw) -> Params:
    c = STACK[stack]
    base = dict(max_pb_bars=c["max_pb_bars"], entry_window=c["entry_window"], max_bars=c["max_bars"],
                scratch_k=c["scratch_k"], gap_rule=(stack == "H"))
    base.update(kw)
    return Params(**base)


# --- per-symbol arrays ------------------------------------------------------------------------------------

def arrays(f: pd.DataFrame, chan: int = 20) -> dict:
    a = {k: f[k].to_numpy(dtype="float64") for k in ("open", "high", "low", "close", "sh", "l0", "pl", "trail_sl",
                                                      "atr", "bars_since", "mom_pct", "datr", "dclose_prev")}
    if chan == 20:
        a["mid"], a["u"] = f["mid"].to_numpy(dtype="float64"), f["u"].to_numpy(dtype="float64")
    else:
        a["mid"] = f["close"].rolling(chan).mean().to_numpy()
        a["u"] = (f["high"] - f["low"]).rolling(chan).mean().to_numpy()
    a["tradeable"] = f["tradeable"].to_numpy(dtype=bool)
    a["flagged"] = f["flagged"].to_numpy(dtype=bool)
    a["first_bar"] = f["first_bar"].to_numpy(dtype=bool) if "first_bar" in f else np.zeros(len(f), bool)
    a["ts"] = pd.DatetimeIndex(f.index)
    return a


def setup_mask(a: dict, p: Params) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        base = (a["tradeable"] & (a["mom_pct"] >= p.mom_min) & np.isfinite(a["sh"]) & np.isfinite(a["pl"])
                & (a["high"] < a["sh"]) & (a["bars_since"] >= 1) & (a["bars_since"] <= p.max_pb_bars)
                & np.isfinite(a["atr"]) & np.isfinite(a["mid"]))
        if p.setup == "trap":
            prev_close = np.r_[np.nan, a["close"][:-1]]
            return base & (a["pl"] < a["l0"]) & (a["close"] > a["l0"]) & ((prev_close <= a["l0"]) | (a["low"] < a["l0"]))
        with np.errstate(divide="ignore"):
            depth = (a["sh"] - a["pl"]) / (a["sh"] - a["l0"])
        return base & (a["pl"] >= a["l0"]) & (depth >= 0.2) & (depth <= 1.0)


# --- entry ------------------------------------------------------------------------------------------------

def gap_blocked(a: dict, k: int, p: Params) -> bool:
    return bool(p.gap_rule and a["first_bar"][k] and np.isfinite(a["datr"][k])
                and abs(a["open"][k] - a["dclose_prev"][k]) > 0.5 * a["datr"][k])


def try_entry(a: dict, t: int, p: Params, ov: dict | None):
    """Work the entry from bar t+1 for entry_window bars. ov (random baseline):
    {"risk": stop distance as a fraction, "t1r": T1 distance in R}; no SH checks."""
    o, h, l, c = a["open"], a["high"], a["low"], a["close"]
    n = len(o)
    atr_t = a["atr"][t]
    sh = a["sh"][t] if ov is None else np.inf
    trigger = h[t] * 1.0005
    L1 = L2 = None
    if p.entry == "stop":
        stop = a["pl"][t] - p.stop_buf * atr_t if ov is None else trigger * (1 - ov["risk"])
        stop_order = trigger
    else:
        L1 = a["mid"][t]
        stop = a["pl"][t] - p.stop_buf * atr_t if ov is None else L1 * (1 - ov["risk"])
        L2 = a["mid"][t] - 2 * a["u"][t]
        if not (stop < L1 < sh):
            return None, "limit outside stop..SH"
        if L2 <= stop:
            L2 = None
        stop_order = None
    end = min(t + p.entry_window, n - 1)
    for k in range(t + 1, end + 1):
        if o[k] >= sh:
            return None, "opened above SH"
        if o[k] <= stop:
            return None, "opened through stop"
        hf = (h[k] - o[k]) <= (o[k] - l[k])
        blocked = gap_blocked(a, k, p)
        if stop_order is not None and not blocked:
            if o[k] >= stop_order:
                if o[k] > stop_order + p.nochase * atr_t:
                    return None, "no-chase"
                return dict(e=k, kind="stop", fill=o[k], gapfill=True, ref=stop_order, stop=stop, L2=None), None
            if h[k] >= stop_order:
                if not hf and l[k] <= stop:  # O-L-H-C: the low through the stop came first
                    return None, "stopped before fill"
                return dict(e=k, kind="stop", fill=stop_order, gapfill=False, ref=stop_order, stop=stop, L2=None), None
        if L1 is not None and stop_order is None and not blocked:
            if hf and h[k] >= sh:  # ran to SH before coming back: no room left
                return None, "SH before fill"
            if l[k] <= L1:
                return dict(e=k, kind="limit", fill=min(o[k], L1), gapfill=o[k] <= L1, ref=L1, stop=stop,
                            L2=L2, l2_until=end), None
        if l[k] <= stop:
            return None, "stopped before fill"
        if p.entry == "hybrid" and stop_order is None and c[k] > h[t]:
            stop_order = trigger  # never reached the wholesale zone and resumed: switch to the buy-stop
    return None, "not filled"


# --- one trade --------------------------------------------------------------------------------------------

def run_trade(a: dict, t: int, p: Params, ov: dict | None = None):
    ent, why = try_entry(a, t, p, ov)
    if ent is None:
        return None, why
    o, h, l, c = a["open"], a["high"], a["low"], a["close"]
    n = len(o)
    e, stop, P1 = ent["e"], ent["stop"], ent["fill"]
    r1 = P1 - stop
    if r1 <= 0 or r1 / P1 > p.max_risk:
        return None, "risk"
    if r1 < p.min_risk_atr * a["atr"][t]:  # stop too close to mean anything (and costs dwarf R)
        return None, "risk too small"
    L2 = ent.get("L2")
    q = 1.0 / (r1 + (L2 - stop)) if L2 is not None else 1.0 / r1
    fills = [(P1, q)]  # entry fills (price, shares)
    pos = q  # shares open
    T1 = a["sh"][t] if ov is None else P1 + ov["t1r"] * r1
    mode = "twopart" if (p.exit == "twopart" and (T1 - P1) >= p.t1_gate * r1) else "trail"
    t1_done = False
    cur = stop
    best = h[e]
    exits = []  # (price, shares, reason)

    def avg_in():
        return sum(x * s for x, s in fills) / sum(s for _, s in fills)

    def take_l2(k, at_open=False):
        nonlocal L2, pos
        if L2 is not None and k <= ent["l2_until"] and (o[k] <= L2 if at_open else l[k] <= L2):
            fills.append((min(o[k], L2), q))
            pos += q
            L2 = None

    def take_t1(k):
        nonlocal pos, t1_done, cur
        half = pos / 2
        exits.append((max(o[k], T1), half, "t1"))
        pos -= half
        t1_done = True
        cur = max(cur, avg_in() * (1 + BE_PLUS))

    last = min(e + p.max_bars, n) - 1
    k_exit = last
    for k in range(e, last + 1):
        hf = (h[k] - o[k]) <= (o[k] - l[k])
        done = False
        if k == e:
            if ent["kind"] == "limit":  # filled on the way down; the rest of the bar can still hit the stop
                take_l2(k)
                if l[k] <= cur:
                    exits.append((cur, pos, "stop"))
                    done = True
                elif mode == "twopart" and not hf and h[k] >= T1:
                    take_t1(k)
            elif ((hf or ent["gapfill"]) and l[k] <= cur) or c[k] <= cur:
                exits.append((cur, pos, "stop"))
                done = True
            elif mode == "twopart" and h[k] >= T1:  # filled on the way up and kept going to T1
                take_t1(k)
        else:
            if o[k] <= cur:
                take_l2(k, at_open=True)
                exits.append((o[k], pos, "stop"))
                done = True
            else:
                hit_t1 = mode == "twopart" and not t1_done and h[k] >= T1
                if hf and hit_t1:  # high first: T1, then the raised stop on the way down
                    take_t1(k)
                    hit_t1 = False
                take_l2(k)
                if l[k] <= cur:
                    exits.append((cur, pos, "be/trail" if t1_done else "stop"))
                    done = True
                elif hit_t1:
                    take_t1(k)
        if done:
            k_exit = k
            break
        best = max(best, h[k])
        if mode == "trail" or t1_done:
            ts = a["trail_sl"][k]
            if np.isfinite(ts):
                new = ts - p.stop_buf * a["atr"][k]
                if cur < new < c[k]:
                    cur = new
        if p.scratch == "time" and k == e + p.scratch_k - 1 and not t1_done and (best - avg_in()) < 0.5 * r1:
            exits.append((c[k], pos, "scratch-time"))
            k_exit = k
            break
        if p.scratch == "follow" and k <= e + 1 and c[k] < ent["ref"]:
            exits.append((c[k], pos, "scratch-follow"))
            k_exit = k
            break
        if k == last:
            exits.append((c[k], pos, "time" if last == e + p.max_bars - 1 else "end-of-data"))
    px_in = sum(x * s for x, s in fills)
    px_out = sum(x * s for x, s, _ in exits)
    tr = dict(t=t, e=e, x=k_exit, entry_kind=ent["kind"], p1=P1, stop=stop, risk_frac=r1 / P1,
              room_r=(T1 - P1) / r1 if np.isfinite(T1) else np.nan, mode=mode, p2_filled=len(fills) > 1,
              planned_risk_used=sum((x - stop) * s for x, s in fills), bars=k_exit - e + 1,
              reason="+".join(dict.fromkeys(r for _, _, r in exits)))
    for m, cs in COST_SIDE.items():
        net = (px_out - px_in) - (px_in + px_out) * cs
        tr[f"r_{m}"] = net  # planned risk is 1R by construction (q)
        tr[f"pnl_pct_{m}"] = net / px_in * 100
    return tr, None


# --- runs -------------------------------------------------------------------------------------------------

_FE: dict = {}
_AR: dict = {}


def load(stack: str) -> dict:
    if stack not in _FE:
        _FE[stack] = features.build(stack)
    return _FE[stack]


def get_arrays(stack: str, chan: int = 20) -> dict:
    key = (stack, chan)
    if key not in _AR:
        _AR[key] = {s: arrays(f, chan) for s, f in load(stack).items()}
    return _AR[key]


def run(stack: str, p: Params, start: str, end: str, collect_skips: bool = False) -> pd.DataFrame:
    rows, skips = [], {}
    lo_ts, hi_ts = pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)
    for sym, a in get_arrays(stack, p.chan).items():
        m = setup_mask(a, p)
        idx = np.flatnonzero(m & (a["ts"] >= lo_ts) & (a["ts"] < hi_ts))
        free = 0
        for t in idx:
            if t < free:
                continue
            tr, why = run_trade(a, t, p)
            if tr is None:
                skips[why] = skips.get(why, 0) + 1
                continue
            free = tr["x"] + 1
            if a["flagged"][tr["t"]:tr["x"] + 1].any():
                skips["data flag"] = skips.get("data flag", 0) + 1
                continue
            tr.update(symbol=sym, signal_ts=a["ts"][t], entry_ts=a["ts"][tr["e"]], exit_ts=a["ts"][tr["x"]])
            rows.append(tr)
    df = pd.DataFrame(rows)
    df.attrs["skips"] = skips
    return df


def stats(tr: pd.DataFrame, m: str) -> dict:
    if tr.empty:
        return {"n": 0}
    r = tr[f"r_{m}"]
    mon = r.groupby(pd.to_datetime(tr["entry_ts"]).dt.to_period("M")).mean()
    pos, neg = tr.loc[tr[f"pnl_pct_{m}"] > 0, f"pnl_pct_{m}"].sum(), -tr.loc[tr[f"pnl_pct_{m}"] <= 0, f"pnl_pct_{m}"].sum()
    return {"n": len(tr), "avgR": r.mean(), "medR": r.median(), "win%": (r > 0).mean() * 100,
            "avg%": tr[f"pnl_pct_{m}"].mean(), "PF": pos / neg if neg > 0 else np.nan,
            "t": r.mean() / (r.std() / np.sqrt(len(r))) if len(r) > 1 and r.std() > 0 else np.nan,
            "t_month": mon.mean() / (mon.std() / np.sqrt(len(mon))) if len(mon) > 1 and mon.std() > 0 else np.nan,
            "avg_bars": tr["bars"].mean()}


GRID = {"setup": ["trap", "plain"], "entry": ["stop", "limit", "hybrid"], "exit": ["trail", "twopart"],
        "scratch": ["none", "time", "follow"]}


def grid(stack: str) -> pd.DataFrame:
    c = STACK[stack]
    rows = []
    cells = list(itertools.product(*GRID.values()))
    for i, (su, en, ex, scr) in enumerate(cells):
        p = params_for(stack, setup=su, entry=en, exit=ex, scratch=scr)
        tr = run(stack, p, c["start"], c["is_end"])
        row = {"setup": su, "entry": en, "exit": ex, "scratch": scr}
        for m in COST_SIDE:
            row.update({f"{m}_{k}": v for k, v in stats(tr, m).items()})
        row["p2_fill%"] = tr["p2_filled"].mean() * 100 if len(tr) else np.nan
        rows.append(row)
        jm = c["judged"]
        print(f"[{i + 1}/{len(cells)}] {stack} {su:5s} {en:6s} {ex:7s} {scr:6s} n={row.get(jm + '_n', 0):5d} "
              f"avgR {jm}={row.get(jm + '_avgR', np.nan):+.3f} t_month={row.get(jm + '_t_month', np.nan):+.2f} | "
              f"cash {row.get('cash_avgR', np.nan):+.3f} fut {row.get('fut_avgR', np.nan):+.3f}", flush=True)
    g = pd.DataFrame(rows)
    g.to_csv(OUT / f"grid_{stack}.csv", index=False)
    return g


def select(stack: str) -> Params:
    """Selection rule fixed in spec.md (protocol step 3)."""
    c = STACK[stack]
    m = c["judged"]
    g = pd.read_csv(OUT / f"grid_{stack}.csv")
    ok = g[(g[f"{m}_t_month"] > 0) & (g[f"{m}_n"] >= c["min_n"])]
    if ok.empty:
        print(f"{stack}: no cell with t_month > 0 and n >= {c['min_n']} in-sample: NO IN-SAMPLE REGION (rule 5)")
        p = params_for(stack, setup="trap", entry="stop", exit="trail", scratch="none")
        note = "no in-sample region; default cell for the record"
    else:
        pair = ok.groupby(["entry", "exit"])[f"{m}_t_month"].mean().sort_values(ascending=False)
        print("mean t_month by (entry, exit) among qualifying cells:\n", pair.round(3).to_string())
        en, ex = pair.index[0]
        sub = ok[(ok.entry == en) & (ok.exit == ex)].copy()
        simp = {"plain": 0, "trap": 1, "none": 0, "time": 1, "follow": 2}
        sub["simplicity"] = sub.setup.map(simp) * 3 + sub.scratch.map(simp)
        best = sub.sort_values([f"{m}_t_month", "simplicity"], ascending=[False, True]).iloc[0]
        p = params_for(stack, setup=best.setup, entry=en, exit=ex, scratch=best.scratch)
        note = f"chosen from {len(ok)} qualifying cells"
    (OUT / f"chosen_{stack}.json").write_text(json.dumps({**asdict(p), "note": note}, indent=2))
    print(stack, "chosen:", asdict(p), "|", note)
    return p


def load_chosen(stack: str) -> Params:
    d = json.loads((OUT / f"chosen_{stack}.json").read_text())
    d.pop("note", None)
    return Params(**d)


# --- random baselines -------------------------------------------------------------------------------------

def random_baseline(stack: str, p: Params, tr: pd.DataFrame, start: str, end: str, seed: int, matched: bool) -> pd.DataFrame:
    """Same number of trades per year, random tradeable bars (momentum-filtered if
    matched), the same entry method and exits, stop distance and T1 distance drawn
    from the strategy's own trades."""
    rng = np.random.default_rng(seed)
    if tr.empty:
        return tr
    per_year = tr.groupby(pd.to_datetime(tr["entry_ts"]).dt.year).size()
    risks, t1r = tr["risk_frac"].to_numpy(), tr["room_r"].fillna(1.0).clip(lower=0.2).to_numpy()
    arrs = get_arrays(stack, p.chan)
    lo_ts, hi_ts = pd.Timestamp(start), pd.Timestamp(end) + pd.Timedelta(days=1)
    pool = []
    for sym, a in arrs.items():
        with np.errstate(invalid="ignore"):
            ok = a["tradeable"] & np.isfinite(a["atr"]) & np.isfinite(a["mid"]) & (a["ts"] >= lo_ts) & (a["ts"] < hi_ts)
            if matched:
                ok &= a["mom_pct"] >= p.mom_min
        i = np.flatnonzero(ok)
        pool.append(pd.DataFrame({"sym": sym, "i": i, "year": a["ts"][i].year}))
    pool = pd.concat(pool, ignore_index=True)
    rows = []
    for y, k in per_year.items():
        cand = pool[pool.year == y]
        if cand.empty:
            continue
        pick = cand.sample(n=min(len(cand), k * 4), random_state=int(rng.integers(1e9)))
        got = 0
        for sym, i in zip(pick.sym, pick.i):
            a = arrs[sym]
            r, _ = run_trade(a, int(i), p, ov={"risk": float(rng.choice(risks)), "t1r": float(rng.choice(t1r))})
            if r is None or a["flagged"][r["t"]:r["x"] + 1].any():
                continue
            r.update(symbol=sym, entry_ts=a["ts"][r["e"]])
            rows.append(r)
            got += 1
            if got >= k:
                break
    return pd.DataFrame(rows)


# --- portfolio (R-based) ----------------------------------------------------------------------------------

def portfolio_sim(tr: pd.DataFrame, m: str, risk_pct: float = 0.5, max_pos: int = 10, max_open_risk: float = 3.0,
                  max_weight: float = 0.2) -> dict:
    """Each trade risks risk_pct of equity at entry (cut to keep its weight <= max_weight
    and total weight <= 100%); total open risk <= max_open_risk (entry risk counted until
    exit: stricter than PAT's 'breakeven counts as zero'). Equity changes at exits by
    R x risk taken. Marked at exits only, so drawdown is slightly understated."""
    if tr.empty:
        return {"trades_taken": 0}
    t = tr.sort_values(["entry_ts", "risk_frac"]).reset_index(drop=True)
    eq = 1.0
    open_pos = []  # dicts: exit_ts, risk_money, weight
    curve = [(t["entry_ts"].iloc[0], eq)]
    taken, used = 0, []
    for row in t.itertuples():
        for pdx in sorted([q for q in open_pos if q["exit_ts"] <= row.entry_ts], key=lambda q: q["exit_ts"]):
            eq += pdx["pnl"]
            curve.append((pdx["exit_ts"], eq))
            open_pos.remove(pdx)
        if len(open_pos) >= max_pos:
            continue
        open_risk = sum(q["risk_money"] for q in open_pos) / eq * 100
        if open_risk + risk_pct > max_open_risk + 1e-9:
            continue
        risk_money = eq * risk_pct / 100
        weight = risk_money / row.risk_frac / eq
        free_w = 1.0 - sum(q["weight"] for q in open_pos)
        scale = min(1.0, max_weight / weight, max(free_w, 0) / weight)
        if scale <= 0.05:
            continue
        risk_money *= scale
        open_pos.append({"exit_ts": row.exit_ts, "risk_money": risk_money, "weight": weight * scale,
                         "pnl": getattr(row, f"r_{m}") * risk_money})
        used.append(risk_money / eq * 100)
        taken += 1
    for pdx in sorted(open_pos, key=lambda q: q["exit_ts"]):
        eq += pdx["pnl"]
        curve.append((pdx["exit_ts"], eq))
    c = pd.Series(dict(curve)).sort_index()
    c = c.groupby(level=0).last()
    yrs = max((c.index[-1] - c.index[0]).days / 365.25, 1e-9)
    return {"trades_taken": taken, "cagr%": (c.iloc[-1] ** (1 / yrs) - 1) * 100, "maxdd%": (c / c.cummax() - 1).min() * 100,
            "avg_risk_used%": float(np.mean(used)) if used else 0.0, "final_equity": c.iloc[-1]}


def benchmarks(stack: str, start: str, end: str) -> dict:
    import data  # noqa: PLC0415

    fe = load(stack)
    px = pd.DataFrame({s: f["close"].groupby(pd.to_datetime(f["day"])).last() for s, f in fe.items()}).loc[start:end]
    first = px.iloc[0].dropna().index
    ew = (px[first] / px[first].iloc[0]).ffill().mean(axis=1)
    nifty = data.bars("NIFTY50", start, end)["close"]
    out = {}
    for k, s in (("equal_weight_buy_hold", ew), ("nifty50", nifty)):
        yrs = (s.index[-1] - s.index[0]).days / 365.25
        out[f"{k}_cagr%"] = ((s.iloc[-1] / s.iloc[0]) ** (1 / yrs) - 1) * 100
        out[f"{k}_maxdd%"] = (s / s.cummax() - 1).min() * 100
    return out


def final(stack: str):
    c = STACK[stack]
    p = load_chosen(stack)
    res = {"params": asdict(p)}
    for per, (a, b) in {"in_sample": (c["start"], c["is_end"]), "out_of_sample": (c["oos_start"], c["end"])}.items():
        tr = run(stack, p, a, b)
        tr.to_csv(OUT / f"trades_{stack}_{per}.csv", index=False)
        r = {"skips": tr.attrs["skips"], "benchmarks": benchmarks(stack, a, b)}
        for m in COST_SIDE:
            r[m] = {"trades": stats(tr, m), "portfolio": portfolio_sim(tr, m)}
        for kind, matched in (("random_matched", True), ("random_any", False)):
            dist = {m: [] for m in COST_SIDE}
            for seed in range(N_SEEDS):
                rb = random_baseline(stack, p, tr, a, b, seed, matched)
                for m in COST_SIDE:
                    dist[m].append(rb[f"r_{m}"].mean() if len(rb) else np.nan)
            for m in COST_SIDE:
                d = np.array(dist[m])
                r[m][kind] = {"avgR_mean": np.nanmean(d), "p05": np.nanpercentile(d, 5), "p95": np.nanpercentile(d, 95),
                              "p_value": float(np.mean(d >= tr[f"r_{m}"].mean()))}
        r["by_year"] = {m: tr.groupby(pd.to_datetime(tr["entry_ts"]).dt.year)[f"r_{m}"].agg(["size", "mean"]).round(3)
                        .to_dict("index") for m in COST_SIDE}
        r["exit_reasons"] = tr["reason"].value_counts().to_dict()
        res[per] = r
        print(per, json.dumps({m: {k: r[m]["trades"].get(k) for k in ("n", "avgR", "win%", "t_month")} for m in COST_SIDE},
                              default=lambda x: round(float(x), 3)), flush=True)
    (OUT / f"eval_{stack}.json").write_text(json.dumps(res, indent=2, default=lambda x: float(x) if np.isscalar(x) else str(x)))
    print(json.dumps(res, indent=1, default=lambda x: round(float(x), 3) if np.isscalar(x) else str(x)))


def sens(stack: str):
    c = STACK[stack]
    p = load_chosen(stack)
    v = {"chosen": p, "mom_min -0.1": replace(p, mom_min=round(p.mom_min - 0.1, 2)),
         "mom_min +0.1": replace(p, mom_min=round(p.mom_min + 0.1, 2)),
         "max_pb_bars x0.67": replace(p, max_pb_bars=max(2, round(p.max_pb_bars * 2 / 3))),
         "max_pb_bars x1.5": replace(p, max_pb_bars=round(p.max_pb_bars * 1.5)),
         "entry_window -": replace(p, entry_window=max(1, p.entry_window // 2)),
         "entry_window +": replace(p, entry_window=p.entry_window * 2),
         "stop_buf 0.05": replace(p, stop_buf=0.05), "stop_buf 0.2": replace(p, stop_buf=0.2),
         "max_bars x0.5": replace(p, max_bars=p.max_bars // 2), "max_bars x2": replace(p, max_bars=p.max_bars * 2),
         "t1_gate 0.75": replace(p, t1_gate=0.75), "t1_gate 1.5": replace(p, t1_gate=1.5),
         "nochase 0.25": replace(p, nochase=0.25), "nochase 1.0": replace(p, nochase=1.0),
         "chan 14": replace(p, chan=14), "chan 30": replace(p, chan=30),
         "min_risk_atr 0.25": replace(p, min_risk_atr=0.25), "min_risk_atr 1.0": replace(p, min_risk_atr=1.0)}
    if stack == "H":
        v["gap_rule off"] = replace(p, gap_rule=False)
    rows = []
    for name, q in v.items():
        row = {"variant": name}
        for per, (a, b) in {"is": (c["start"], c["is_end"]), "oos": (c["oos_start"], c["end"])}.items():
            tr = run(stack, q, a, b)
            for m in COST_SIDE:
                s = stats(tr, m)
                row.update({f"{per}_{m}_{k}": s.get(k) for k in ("n", "avgR", "t_month")})
        rows.append(row)
        print({k: (round(x, 3) if isinstance(x, float) else x) for k, x in row.items()}, flush=True)
    pd.DataFrame(rows).to_csv(OUT / f"sensitivity_{stack}.csv", index=False)


if __name__ == "__main__":
    cmd, stack = sys.argv[1], sys.argv[2]
    {"grid": grid, "select": select, "final": final, "sens": sens}[cmd](stack)
