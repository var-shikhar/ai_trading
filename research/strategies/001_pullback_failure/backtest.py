"""Strategy 001: YTC pullback failure (PB / CPB) in strong stocks, long only.

See spec.md for the rules. Run:
    backend/.venv/Scripts/python.exe research/strategies/001_pullback_failure/backtest.py grid
    backend/.venv/Scripts/python.exe research/strategies/001_pullback_failure/backtest.py final

No lookahead: every feature at bar t uses data up to t's close (swings only
once confirmed); orders are placed for bar t+1.
"""

import itertools
import json
import pickle
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "common"))
import data  # noqa: E402
import portfolio  # noqa: E402
import structure  # noqa: E402

CACHE = HERE.parents[1] / "data" / "s001_features.pkl"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
IS_END = "2018-12-31"
OOS_START = "2019-01-01"
COST = 0.001  # per side: brokerage + STT + exchange charges (delivery)
SLIP = 0.0005  # per side
STOP_BUFFER = 0.002  # stop this far below the pullback low ("a couple of ticks")
MIN_TRADED_VALUE = 5e7  # Rs 5 crore/day (20-day average), so early-year thin names are skipped


@dataclass(frozen=True)
class Params:
    context: str = "mom"  # none | structure | mom | both
    mom_min: float = 0.7  # 126-day return percentile across the universe (if context uses mom)
    max_pb_bars: int = 5  # bars since the swing high (pullback duration)
    depth_min: float = 0.2  # pullback depth as fraction of the prior up leg
    depth_max: float = 1.0
    allow_break: bool = False  # allow pullbacks that broke the swing low before the high (trapped-shorts CPB)
    exit: str = "trail"  # swing (all at prior swing high) | trail (swing-low trail) | half (half at T1, half trail)
    max_bars: int = 30
    max_risk: float = 0.08  # skip if the stop is more than 8% away
    index_filter: bool = False  # only when NIFTY 50 > its 200-day SMA
    min_room: float = 0.0  # YTC "acceptable R:R": (prior swing high - entry) / risk must be at least this
    entry: str = "stop"  # stop: buy-stop above the signal bar's high (pullback failure) | open: buy next open


# --- features (computed once, cached) -------------------------------------------------------------


def symbol_features(df: pd.DataFrame) -> pd.DataFrame:
    h, l, c = df["high"].to_numpy(), df["low"].to_numpy(), df["close"].to_numpy()
    n = len(df)
    swings = structure.find_swings(h, l, 2)
    sh = [s for s in swings if s.kind == "H"]
    sl = [s for s in swings if s.kind == "L"]
    out = {k: np.full(n, np.nan) for k in ("sh", "sh_i", "l0", "prev_sh", "prev_l0", "pl", "legs")}
    sl_i = np.array([x.i for x in sl])
    sl_known = np.array([x.known_at for x in sl])
    sl_price = np.array([x.price for x in sl])

    def low_before(i):  # price of the last swing low whose bar is before bar i
        k = np.searchsorted(sl_i, i) - 1
        return sl_price[k] if k >= 0 else np.nan

    sh_l0 = [low_before(s.i) for s in sh]
    sh_k = -1
    for t in range(n):
        while sh_k + 1 < len(sh) and sh[sh_k + 1].known_at <= t:
            sh_k += 1
        if sh_k < 0 or np.isnan(sh_l0[sh_k]):
            continue
        s = sh[sh_k]
        out["sh"][t], out["sh_i"][t], out["l0"][t] = s.price, s.i, sh_l0[sh_k]
        if sh_k >= 1:
            out["prev_sh"][t] = sh[sh_k - 1].price
            out["prev_l0"][t] = sh_l0[sh_k - 1]
        if t > s.i:
            out["pl"][t] = l[s.i + 1:t + 1].min()
        out["legs"][t] = int(((sl_i > s.i) & (sl_known <= t)).sum()) if len(sl_i) else 0
    f = pd.DataFrame(out, index=df.index)
    f["bars_since"] = np.arange(n) - f["sh_i"]
    f["depth"] = (f["sh"] - f["pl"]) / (f["sh"] - f["l0"])
    f["broke"] = f["pl"] < f["l0"]
    f["struct_up"] = (f["sh"] > f["prev_sh"]) & (f["l0"] > f["prev_l0"])
    f["tv20"] = (df["close"] * df["volume"]).rolling(20).mean()
    f["ret126"] = df["close"] / df["close"].shift(126) - 1
    for k in ("open", "high", "low", "close"):
        f[k] = df[k]
    # last confirmed swing low known at t (for trailing)
    sl_px = np.full(n, np.nan)
    k = -1
    by_known = sorted(sl, key=lambda x: x.known_at)
    for t in range(n):
        while k + 1 < len(by_known) and by_known[k + 1].known_at <= t:
            k += 1
        if k >= 0:
            sl_px[t] = by_known[k].price
    f["trail_sl"] = sl_px
    return f


def build_features() -> dict[str, pd.DataFrame]:
    if CACHE.exists():
        return pickle.loads(CACHE.read_bytes())
    pan = data.panel(start="2005-01-01")
    feats = {s: symbol_features(df) for s, df in pan.items()}
    # cross-sectional momentum percentile per date
    r = pd.DataFrame({s: f["ret126"] for s, f in feats.items()})
    pct = r.rank(axis=1, pct=True)
    idx = data.bars("NIFTY50")
    idx_up = (idx["close"] > idx["close"].rolling(200).mean())
    for s, f in feats.items():
        f["mom_pct"] = pct[s].reindex(f.index)
        f["idx_up"] = idx_up.reindex(f.index, method="ffill").fillna(False).astype(bool)
    CACHE.write_bytes(pickle.dumps(feats))
    return feats


# --- signals & trade simulation ------------------------------------------------------------------


def setup_mask(f: pd.DataFrame, p: Params) -> np.ndarray:
    m = (
        f["sh"].notna() & f["pl"].notna()
        & (f["bars_since"] <= p.max_pb_bars)
        & (f["depth"] >= p.depth_min) & (f["depth"] <= p.depth_max)
        & (f["high"] < f["sh"])  # still inside the pullback
        & (f["tv20"] >= MIN_TRADED_VALUE)
    )
    if not p.allow_break:
        m &= ~f["broke"]
    if p.context in ("structure", "both"):
        m &= f["struct_up"]
    if p.context in ("mom", "both"):
        m &= f["mom_pct"] >= p.mom_min
    if p.index_filter:
        m &= f["idx_up"]
    return m.fillna(False).to_numpy()


def simulate_symbol(sym: str, f: pd.DataFrame, p: Params, start: str, end: str, random_entry: dict | None = None) -> list[dict]:
    """random_entry: {"t": bar, "risk": frac, "t1r": R} for the random baseline:
    one attempted entry at bar t with a stop `risk` below entry and (swing
    exits) a target t1r × risk above it."""
    o, h, l, c = (f[k].to_numpy() for k in ("open", "high", "low", "close"))
    sh, pl, trail_sl = f["sh"].to_numpy(), f["pl"].to_numpy(), f["trail_sl"].to_numpy()
    dates = f.index
    n = len(f)
    if random_entry is None:
        mask = setup_mask(f, p)
        lo_i, hi_i = dates.searchsorted(pd.Timestamp(start)), dates.searchsorted(pd.Timestamp(end), side="right")
    else:
        mask = np.zeros(n, bool)
        mask[random_entry["t"]] = True
        lo_i, hi_i = random_entry["t"], random_entry["t"] + 1
        sh = np.full(n, np.inf)  # no "gapped above the swing high" skip for random entries
    trades = []
    t = max(lo_i, 1)
    while t < min(hi_i, n - 1):
        if not mask[t]:
            t += 1
            continue
        e = t + 1
        if p.entry == "open":
            trigger = o[e]  # market order at the open: "gap_fill" below is then always true
        else:
            trigger = h[t] * 1.0005  # buy-stop a hair above the signal bar's high
            if h[e] < trigger:  # pullback didn't fail tomorrow: re-evaluate from tomorrow's close
                t += 1
                continue
        if o[e] >= sh[t]:  # gapped above the prior swing high: no room left, skip
            t += 1
            continue
        if random_entry is None and o[e] <= pl[t] * (1 - STOP_BUFFER):  # opened through the stop
            t += 1
            continue
        raw_entry = max(o[e], trigger)
        entry = raw_entry * (1 + SLIP)
        stop = pl[t] * (1 - STOP_BUFFER) if random_entry is None else entry * (1 - random_entry["risk"])
        risk = entry - stop
        if risk <= 0 or risk / entry > p.max_risk:
            t += 1
            continue
        target = sh[t] if random_entry is None else entry + random_entry["t1r"] * risk
        if random_entry is None and (target - entry) / risk < p.min_room:
            t += 1
            continue
        parts = [0.5, 0.5] if p.exit == "half" else [1.0]
        legs = []
        for part_no, w in enumerate(parts):
            mode = "swing" if (p.exit == "swing" or (p.exit == "half" and part_no == 0)) else "trail"
            cur_stop = stop
            exit_px, exit_i, reason = None, None, None
            for k in range(e, min(e + p.max_bars, n)):
                # Intrabar order is unknown on daily bars. Standard OHLC path
                # assumption: if the open is nearer the high, the high came
                # first (O-H-L-C), otherwise the low came first (O-L-H-C).
                high_first = (h[k] - o[k]) <= (o[k] - l[k])
                if k == e:
                    # Entry fills on the way up through the trigger. On an O-L-H-C bar the low
                    # printed before the fill, so it can't stop us; on O-H-L-C it comes after.
                    gap_fill = o[k] >= trigger
                    if (high_first or gap_fill) and l[k] <= cur_stop:
                        exit_px, exit_i, reason = cur_stop, k, "stop"
                        break
                    if mode == "swing" and h[k] >= target:
                        exit_px, exit_i, reason = target, k, "target"
                        break
                else:
                    if o[k] <= cur_stop:
                        exit_px, exit_i, reason = o[k], k, "stop"
                        break
                    hit_stop = l[k] <= cur_stop
                    hit_target = mode == "swing" and h[k] >= target
                    if hit_stop and hit_target:
                        exit_px, reason = (target, "target") if high_first else (cur_stop, "stop")
                        exit_i = k
                        break
                    if hit_stop:
                        exit_px, exit_i, reason = cur_stop, k, "stop"
                        break
                    if hit_target:
                        exit_px, exit_i, reason = max(o[k], target), k, "target"
                        break
                if mode == "trail" and not np.isnan(trail_sl[k]):
                    new = trail_sl[k] * (1 - STOP_BUFFER)
                    if new > cur_stop and new < c[k]:
                        cur_stop = new  # takes effect from the next bar
            if exit_px is None:
                exit_i = min(e + p.max_bars, n) - 1
                exit_px, reason = c[exit_i], "time"
            legs.append((w, exit_px * (1 - SLIP), exit_i, reason))
        exit_net = sum(w * px for w, px, _, _ in legs)
        exit_i = max(i for _, _, i, _ in legs)
        entry_net = entry * (1 + COST)
        exit_after_cost = exit_net * (1 - COST)
        trades.append({
            "symbol": sym, "side": "long", "signal_date": dates[t], "entry_date": dates[e], "exit_date": dates[exit_i],
            "entry_px": entry, "stop_px": stop, "target_px": target, "exit_px": exit_net,
            "entry_px_net": entry_net, "exit_px_net": exit_after_cost,
            "pnl_pct": (exit_after_cost / entry_net - 1) * 100,
            "r": (exit_after_cost - entry_net) / risk, "risk_frac": risk / entry,
            "room_r": (target - entry) / risk, "bars": exit_i - e + 1,
            "reason": "+".join(r for _, _, _, r in legs), "depth": f["depth"].iloc[t], "legs": f["legs"].iloc[t],
            "mom_pct": f["mom_pct"].iloc[t], "idx_up": bool(f["idx_up"].iloc[t]),
        })
        t = exit_i + 1  # one position per symbol
    return trades


def run(feats, p: Params, start: str, end: str) -> pd.DataFrame:
    rows = []
    for s, f in feats.items():
        rows += simulate_symbol(s, f, p, start, end)
    return pd.DataFrame(rows)


def random_baseline(feats, trades: pd.DataFrame, p: Params, start: str, end: str, seed: int = 7) -> pd.DataFrame:
    """Same number of entries per year, random liquid stock-days, the same
    entry trigger mechanics (buy-stop above the signal bar's high), same
    risk distance (as % of price) and the same exit rules. Isolates the
    value of WHERE we enter."""
    rng = np.random.default_rng(seed)
    if trades.empty:
        return trades
    per_year = trades.groupby(trades.entry_date.dt.year).size()
    risks = trades["risk_frac"].to_numpy()
    t1r = (trades["room_r"]).clip(lower=0.2).to_numpy()
    pool = []
    for s, f in feats.items():
        ok = ((f["tv20"] >= MIN_TRADED_VALUE) & (f.index >= start) & (f.index <= end)).to_numpy()
        for i in np.flatnonzero(ok):
            pool.append((s, i, f.index[i].year))
    pool = pd.DataFrame(pool, columns=["symbol", "i", "year"])
    rows = []
    for y, k in per_year.items():
        cand = pool[pool.year == y]
        pick = cand.sample(n=min(len(cand), k * 3), random_state=int(rng.integers(1e9)))
        got = 0
        for s, i in zip(pick.symbol, pick.i):
            res = simulate_symbol(s, feats[s], p, start, end,
                                  random_entry={"t": int(i), "risk": float(rng.choice(risks)), "t1r": float(rng.choice(t1r))})
            rows += res
            got += len(res)
            if got >= k:
                break
    return pd.DataFrame(rows)


# --- experiments ----------------------------------------------------------------------------------


GRID = {
    "context": ["none", "structure", "mom", "both"],
    "max_pb_bars": [3, 5, 8],
    # (depth_min, depth_max, allow_break): the last one is YTC's "PB that broke the prior swing low" (CPB/trapped shorts)
    "depth": [(0.2, 1.0, False), (0.38, 0.79, False), (0.5, 1.0, False), (0.2, 3.0, True)],
    "exit": ["swing", "trail", "half"],
    "entry": ["stop", "open"],
}


_FEATS = None


def _grid_one(p: Params) -> dict:
    global _FEATS
    if _FEATS is None:
        _FEATS = build_features()
    st = portfolio.trade_stats(run(_FEATS, p, "2005-01-01", IS_END))
    return {**asdict(p), **{f"is_{k}": v for k, v in st.items()}}


def grid(workers: int = 4):
    from concurrent.futures import ProcessPoolExecutor

    build_features()
    params = []
    for ctx, pb, (dmin, dmax, brk), ex, en in itertools.product(*GRID.values()):
        params.append(Params(context=ctx, max_pb_bars=pb, depth_min=dmin, depth_max=dmax, allow_break=brk, exit=ex, entry=en))
    rows = []
    with ProcessPoolExecutor(workers) as ex:
        for i, r in enumerate(ex.map(_grid_one, params)):
            rows.append(r)
            print(f"[{i + 1}/{len(params)}] {r['context']:9s} pb<={r['max_pb_bars']} d={r['depth_min']}-{r['depth_max']} "
                  f"brk={r['allow_break']!s:5s} {r['exit']:5s} {r['entry']:4s} n={r.get('is_n', 0):5d} avgR={r.get('is_avgR', np.nan):+.3f} "
                  f"win={r.get('is_win%', np.nan):.1f} t={r.get('is_t_stat', np.nan):.2f}", flush=True)
    g = pd.DataFrame(rows)
    g.to_csv(OUT / "grid_in_sample.csv", index=False)
    print(g.sort_values("is_avgR", ascending=False).head(25).to_string())


def evaluate(p: Params, label: str):
    feats = build_features()
    closes = {s: f["close"] for s, f in feats.items()}
    res = {}
    for name, (a, b) in {"in_sample": ("2005-01-01", IS_END), "out_of_sample": (OOS_START, "2026-12-31")}.items():
        tr = run(feats, p, a, b)
        rb = random_baseline(feats, tr, p, a, b)
        pf = portfolio.simulate(tr, closes, risk_pct=1.0, max_pos=10, max_weight=0.2)
        res[name] = {
            "trades": portfolio.trade_stats(tr),
            "random_baseline": portfolio.trade_stats(rb),
            "portfolio": portfolio.stats(pf["equity"], pf["taken"]),
            "by_year": tr.groupby(tr.entry_date.dt.year).agg(n=("r", "size"), avgR=("r", "mean"), win=("pnl_pct", lambda x: (x > 0).mean() * 100)).round(3).to_dict("index"),
            "exit_reasons": tr["reason"].value_counts().to_dict(),
        }
        tr.to_csv(OUT / f"trades_{label}_{name}.csv", index=False)
        pf["equity"].to_csv(OUT / f"equity_{label}_{name}.csv")
    # benchmarks over the same windows
    for name, (a, b) in {"in_sample": ("2005-01-01", IS_END), "out_of_sample": (OOS_START, "2026-12-31")}.items():
        nifty = data.bars("NIFTY50", a, b)["close"]
        yrs = (nifty.index[-1] - nifty.index[0]).days / 365.25
        ew = pd.DataFrame({s: f["close"] for s, f in feats.items()}).loc[a:b].pct_change().mean(axis=1).fillna(0)
        ew_eq = (1 + ew).cumprod()
        res[name]["benchmarks"] = {
            "nifty50_cagr%": ((nifty.iloc[-1] / nifty.iloc[0]) ** (1 / yrs) - 1) * 100,
            "nifty50_maxdd%": (nifty / nifty.cummax() - 1).min() * 100,
            "equal_weight_universe_cagr%": (ew_eq.iloc[-1] ** (1 / yrs) - 1) * 100,
            "equal_weight_universe_maxdd%": (ew_eq / ew_eq.cummax() - 1).min() * 100,
        }
    (OUT / f"eval_{label}.json").write_text(json.dumps({"params": asdict(p), **res}, indent=2, default=float))
    print(json.dumps({"params": asdict(p), **res}, indent=1, default=lambda x: round(float(x), 3)))
    return res


def sensitivity(p: Params):
    """One-at-a-time perturbations around the chosen parameters, both periods."""
    feats = build_features()
    variants = {
        "chosen": p,
        "mom_min 0.6": replace(p, mom_min=0.6), "mom_min 0.8": replace(p, mom_min=0.8),
        "max_pb_bars 3": replace(p, max_pb_bars=3), "max_pb_bars 8": replace(p, max_pb_bars=8),
        "depth_min 0": replace(p, depth_min=0.0), "depth_min 0.38": replace(p, depth_min=0.38),
        "depth_max 0.79": replace(p, depth_max=0.79),
        "max_bars 15": replace(p, max_bars=15), "max_bars 60": replace(p, max_bars=60),
        "max_risk 0.05": replace(p, max_risk=0.05), "max_risk 0.12": replace(p, max_risk=0.12),
        "index_filter": replace(p, index_filter=True),
        "min_room 0": replace(p, min_room=0.0), "min_room 1": replace(p, min_room=1.0),
        "min_room 2": replace(p, min_room=2.0),
        "exit swing": replace(p, exit="swing"), "exit half": replace(p, exit="half"), "exit trail": replace(p, exit="trail"),
        "context none": replace(p, context="none"), "context structure": replace(p, context="structure"),
    }
    rows = []
    for name, v in variants.items():
        r = {"variant": name}
        for per, (a, b) in {"is": ("2005-01-01", IS_END), "oos": (OOS_START, "2026-12-31")}.items():
            st = portfolio.trade_stats(run(feats, v, a, b))
            r.update({f"{per}_{k}": st.get(k) for k in ("n", "avgR", "win%", "PF", "t_stat")})
        rows.append(r)
        print(r, flush=True)
    s = pd.DataFrame(rows)
    s.to_csv(OUT / "sensitivity.csv", index=False)
    print(s.round(3).to_string())


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "grid"
    if cmd == "features":
        build_features()
    elif cmd == "grid":
        grid()
    elif cmd in ("final", "sens"):
        chosen = Params(**json.loads((HERE / "chosen_params.json").read_text()))
        if cmd == "final":
            evaluate(chosen, "chosen")
        else:
            sensitivity(chosen)
