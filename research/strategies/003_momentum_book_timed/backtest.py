"""Strategy 003: monthly momentum book; entries untimed (B0), timed by 002's
daily trap + limit entry (B1), or at a random day in the same window (B2).
Rules: spec.md. Data and 002 entry logic are reused unchanged.

    <app>/backend/.venv/Scripts/python.exe backtest.py grid      # in-sample B0 grid, select, B1 grid (+B2), select
    <app>/backend/.venv/Scripts/python.exe backtest.py seen      # 2019-2026 once with the chosen cells
    <app>/backend/.venv/Scripts/python.exe backtest.py sens      # one-at-a-time sensitivity, both periods
"""

import importlib.util
import json
import sys
from dataclasses import asdict, dataclass, replace
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
S002 = HERE.parent / "002_trap_pullback_wholesale"
sys.path.insert(1, str(S002))  # for 002's own imports (features)
sys.path.insert(1, str(HERE.parents[1] / "common"))
# 002's module is also called backtest.py: load it by path so this file doesn't import itself
_spec = importlib.util.spec_from_file_location("bt002", S002 / "backtest.py")
bt002 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bt002)

OUT = HERE / "out"
OUT.mkdir(exist_ok=True)
COST_SIDE = {"cash": 0.0015, "fut": 0.00065}
# Measurement starts at the first rebalance with valid 12-1 scores (spec amendment 1): IS from the
# Jan 2006 month end (12 months of history needed), seen period from the Dec 2018 month end.
PERIODS = {"in_sample": ("2006-01-31", "2018-12-31"), "seen": ("2018-12-31", "2026-12-31")}
N_SEEDS = 50


@dataclass(frozen=True)
class Book:
    n: int = 15
    lookback: str = "12-1"  # 12-1 | 6-1
    entry: str = "B0"  # B0 | B1 | B2
    window: int = 15  # B1/B2 waiting window (trading days)
    fallback: str = "market"  # market | skip
    buffer: float = 2.0  # hold while rank <= buffer x n
    rebalance: str = "last"  # last | first trading day of the month
    cost: str = "cash"


# --- panel ------------------------------------------------------------------------------------------------

class Panel:
    """Dates x symbols matrices from 002's daily feature cache (adjusted bhavcopy,
    stocks that ever had futures, delisted included), plus 002's B1 entries."""

    def __init__(self):
        fe = bt002.features.build("D")
        self.syms = sorted(fe)
        cal = sorted(set().union(*[set(f.index) for f in fe.values()]))
        self.dates = pd.DatetimeIndex(cal)
        D, S = len(self.dates), len(self.syms)
        self.open = np.full((D, S), np.nan)
        self.close = np.full((D, S), np.nan)
        self.trade = np.zeros((D, S), bool)
        self.flag = np.zeros((D, S), bool)
        self.score = {"12-1": np.full((D, S), np.nan), "6-1": np.full((D, S), np.nan)}
        self.entries = {}  # sym -> (fill date index array, fill price array) from 002's rules
        p002 = bt002.load_chosen("D")  # trap / limit / trail / none, as chosen in 002
        p002 = replace(p002, mom_min=-np.inf)  # momentum filter replaced by book membership
        for j, s in enumerate(self.syms):
            f = fe[s]
            ix = self.dates.get_indexer(f.index)
            self.open[ix, j] = f["open"].to_numpy()
            self.close[ix, j] = f["close"].to_numpy()
            self.trade[ix, j] = f["tradeable"].to_numpy(dtype=bool)
            self.flag[ix, j] = f["flagged"].to_numpy(dtype=bool)
            c = f["close"]
            # scores known at the close of each day: 12-1 = close[t-21]/close[t-252]-1; 6-1 = close[t-21]/close[t-126]-1
            self.score["12-1"][ix, j] = (c.shift(21) / c.shift(252) - 1).to_numpy()
            self.score["6-1"][ix, j] = (c.shift(21) / c.shift(126) - 1).to_numpy()
            a = bt002.arrays(f)
            a["mom_pct"] = np.nan_to_num(a["mom_pct"], nan=0.0)
            fills_i, fills_px = [], []
            for t in np.flatnonzero(bt002.setup_mask(a, p002)):
                ent, _ = bt002.try_entry(a, t, p002, None)
                if ent is not None:
                    r1 = ent["fill"] - ent["stop"]
                    if 0 < r1 and r1 / ent["fill"] <= p002.max_risk and r1 >= p002.min_risk_atr * a["atr"][t]:
                        fills_i.append(ix[ent["e"]])
                        fills_px.append(ent["fill"])
            self.entries[s] = (np.array(fills_i, dtype=int), np.array(fills_px))
        self.close_ff = pd.DataFrame(self.close).ffill().to_numpy()  # for marking (last known price)
        # last bar index per symbol (delisting / end of data)
        has = ~np.isnan(self.close)
        self.last_ix = np.where(has.any(0), D - 1 - np.argmax(has[::-1], axis=0), -1)
        m = pd.Series(self.dates)
        ym = m.dt.year * 12 + m.dt.month
        self.month_last = (ym != ym.shift(-1)).to_numpy()
        self.month_first = (ym != ym.shift(1)).to_numpy()


_P: Panel | None = None


def panel() -> Panel:
    global _P
    if _P is None:
        _P = Panel()
    return _P


# --- simulation -------------------------------------------------------------------------------------------

def b1_fill(P: Panel, j: int, s: int, w: int):
    """First 002 entry for symbol j filling on a day in [s, s+w-1]. Returns (day, price) or None."""
    fi, fp = P.entries[P.syms[j]]
    k = np.searchsorted(fi, s)
    if k < len(fi) and fi[k] <= s + w - 1:
        return int(fi[k]), float(fp[k])
    return None


def simulate(b: Book, start: str, end: str, waits: np.ndarray | None = None, seed: int = 0) -> dict:
    """waits (B2 only): empirical B1 waits in days (window = fallback day; -1 = skipped)."""
    P = panel()
    rng = np.random.default_rng(seed)
    cs = COST_SIDE[b.cost]
    lo, hi = P.dates.searchsorted(pd.Timestamp(start)), P.dates.searchsorted(pd.Timestamp(end), side="right")
    reb = P.month_last if b.rebalance == "last" else P.month_first
    score = P.score[b.lookback]
    cash = 1.0
    hold: dict[int, dict] = {}  # j -> {"sh": shares, "px": entry price, "d": entry day, "b0": B0 reference price}
    pend: dict[int, dict] = {}  # j -> {"s": first day, "deadline": last day, "buy_day": B2 day or None}
    sells: list[int] = []
    eq_curve, positions, wait_log = [], [], []

    def equity(d):
        return cash + sum(h["sh"] * P.close_ff[d, j] for j, h in hold.items())

    def buy(j, d, px, target_val):
        nonlocal cash
        val = min(target_val, cash / (1 + cs))
        if val <= 0 or not np.isfinite(px) or px <= 0:
            return False
        sh = val / px
        cash -= val * (1 + cs)
        hold[j] = {"sh": sh, "px": px, "d": d, "b0": pend[j]["b0"] if j in pend else px}
        return True

    def sell(j, d, px, why):
        nonlocal cash
        h = hold.pop(j)
        cash += h["sh"] * px * (1 - cs)
        positions.append({"sym": P.syms[j], "entry_d": P.dates[h["d"]], "exit_d": P.dates[d], "entry_px": h["px"],
                          "b0_px": h["b0"], "exit_px": px, "why": why})

    for d in range(lo, hi):
        prev_eq = equity(d - 1) if d > lo else cash
        # 1) morning: sells decided at the previous rebalance, at today's open
        for j in sells:
            if j in hold:
                px = P.open[d, j]
                sell(j, d, px if np.isfinite(px) else P.close_ff[d - 1, j], "rank")
        sells = []
        # forced exits: data ended (delisted / merged) or a flagged day (close at the last clean close)
        for j in list(hold):
            if P.last_ix[j] < d or P.flag[d, j]:
                sell(j, d, P.close_ff[d - 1, j], "data end" if P.last_ix[j] < d else "flag")
        # 2) entries for pending names
        target_val = prev_eq / b.n
        for j in list(pend):
            pn = pend[j]
            if j in hold or d < pn["s"]:
                continue
            if P.flag[d, j] or P.last_ix[j] < d:
                pend.pop(j)
                continue
            if b.entry == "B0":
                if buy(j, d, P.open[d, j], target_val):
                    wait_log.append(0)
                pend.pop(j)
            elif b.entry == "B1":
                if pn["fill"] is not None and pn["fill"][0] == d:
                    if buy(j, d, pn["fill"][1], target_val):
                        wait_log.append(d - pn["s"])
                    pend.pop(j)
                elif pn["fill"] is None and d == pn["deadline"] + 1:
                    if b.fallback == "market" and buy(j, d, P.open[d, j], target_val):
                        wait_log.append(b.window)
                    elif b.fallback == "skip":
                        wait_log.append(-1)
                    pend.pop(j)
            else:  # B2
                if pn["buy_day"] is None:
                    pend.pop(j)
                elif d == pn["buy_day"]:
                    buy(j, d, P.open[d, j], target_val)
                    pend.pop(j)
        # 3) close: mark, then rebalance decisions on rebalance days
        eq_curve.append((P.dates[d], equity(d)))
        if reb[d]:
            sc = np.where(P.trade[d] & np.isfinite(score[d]), score[d], -np.inf)
            order = np.argsort(-sc)
            ranks = np.empty_like(order)
            ranks[order] = np.arange(1, len(order) + 1)
            valid = np.isfinite(sc) & (sc > -np.inf)
            target = [j for j in order[:b.n] if valid[j]]
            for j in list(hold):
                if not (valid[j] and ranks[j] <= b.buffer * b.n):
                    sells.append(j)
            for j in list(pend):
                if j not in target:
                    pend.pop(j)  # no longer selected: cancel an unfilled wait
            for j in target:
                if j in hold or j in pend:
                    continue
                s = d + 1
                if s >= len(P.dates):
                    continue
                pn = {"s": s, "deadline": s + b.window - 1, "b0": P.open[s, j], "fill": None, "buy_day": None}
                if b.entry == "B1":
                    pn["fill"] = b1_fill(P, j, s, b.window)
                elif b.entry == "B2":
                    w = int(rng.choice(waits))
                    pn["buy_day"] = None if w < 0 else s + min(w, b.window)
                pend[j] = pn
    eq = pd.Series(dict(eq_curve))
    return {"equity": eq, "positions": pd.DataFrame(positions), "waits": np.array(wait_log), "window": b.window}


def metrics(res: dict) -> dict:
    eq = res["equity"]
    if len(eq) < 30:
        return {}
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    r = eq.pct_change().dropna()
    mret = eq.resample("ME").last().pct_change().dropna()
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1
    dd = (eq / eq.cummax() - 1).min()
    pos = res["positions"]
    return {"cagr%": cagr * 100, "maxdd%": dd * 100, "cagr_dd": cagr / -dd if dd < 0 else np.nan,
            "sharpe": r.mean() / r.std() * np.sqrt(252) if r.std() > 0 else np.nan, "mean_month%": mret.mean() * 100,
            "positions": len(pos), "turnover_per_yr": len(pos) / yrs if yrs > 0 else np.nan}


def ew_benchmark(start: str, end: str) -> dict:
    b = bt002.benchmarks("D", start, end)
    eq = b
    return {k: v for k, v in eq.items()}


def b2_distribution(b1: Book, start: str, end: str, waits: np.ndarray) -> dict:
    vals, cagr_dd = [], []
    for seed in range(N_SEEDS):
        res = simulate(replace(b1, entry="B2"), start, end, waits=waits, seed=seed)
        m = metrics(res)
        vals.append(m["mean_month%"])
        cagr_dd.append(m["cagr_dd"])
    return {"mean_month%": np.array(vals), "cagr_dd": np.array(cagr_dd)}


def timing_stats(res_b1: dict, res_b0: dict) -> dict:
    """Per new position: B1 entry vs the B0 reference price (next open after selection)."""
    p = res_b1["positions"]
    if p.empty:
        return {}
    imp = (p["b0_px"] / p["entry_px"] - 1) * 100  # >0: B1 bought cheaper than B0 would have
    m0 = res_b0["equity"].resample("ME").last().pct_change().dropna()
    m1 = res_b1["equity"].resample("ME").last().pct_change().dropna()
    diff = (m1 - m0).dropna()
    t = diff.mean() / (diff.std() / np.sqrt(len(diff))) if diff.std() > 0 else np.nan
    w = res_b1["waits"]
    win = res_b1.get("window", None)
    return {"entry_improvement%_mean": imp.mean(), "entry_improvement%_median": imp.median(),
            "no_signal%": float(np.mean((w == -1) | (w == win))) * 100 if len(w) and win else np.nan,
            "b1_minus_b0_month%": diff.mean() * 100, "t_month_b1_vs_b0": t}


# --- protocol ---------------------------------------------------------------------------------------------

def grid():
    a, z = PERIODS["in_sample"]
    bench = ew_benchmark(a, z)
    print("benchmarks in-sample:", {k: round(v, 2) for k, v in bench.items()}, flush=True)
    rows = []
    for n in (10, 15, 20):
        for lb in ("12-1", "6-1"):
            m = metrics(simulate(Book(n=n, lookback=lb), a, z))
            rows.append({"n": n, "lookback": lb, **m})
            print("B0", n, lb, {k: round(v, 3) for k, v in m.items()}, flush=True)
    g0 = pd.DataFrame(rows)
    g0.to_csv(OUT / "grid_B0.csv", index=False)
    ew_cagr = bench["equal_weight_buy_hold_cagr%"]
    ok = g0[g0["cagr%"] > ew_cagr]
    if ok.empty:
        print(f"no B0 cell beats equal-weight buy & hold CAGR {ew_cagr:.1f}%: H3(1) rejected in-sample; carrying N=15/12-1")
        b0 = Book(n=15, lookback="12-1")
        note0 = "no cell beat EW B&H in-sample"
    else:
        ok = ok.assign(pref=(ok.n != 15).astype(int) * 2 + (ok.lookback != "12-1").astype(int))
        best = ok.sort_values(["cagr_dd", "pref"], ascending=[False, True]).iloc[0]
        b0 = Book(n=int(best.n), lookback=best.lookback)
        note0 = f"{len(ok)} cells beat EW B&H"
    print("chosen B0:", asdict(b0), note0, flush=True)
    res0 = simulate(b0, a, z)
    rows = []
    for w in (10, 15, 20):
        for fb in ("market", "skip"):
            b1 = replace(b0, entry="B1", window=w, fallback=fb)
            r1 = simulate(b1, a, z)
            m1 = metrics(r1)
            dist = b2_distribution(b1, a, z, r1["waits"])
            tv = m1["mean_month%"] - dist["mean_month%"].mean()
            rows.append({"window": w, "fallback": fb, **m1, "b2_mean_month%": dist["mean_month%"].mean(),
                         "timing_value_month%": tv, "p_vs_b2": float(np.mean(dist["mean_month%"] >= m1["mean_month%"])),
                         **timing_stats(r1, res0)})
            print("B1", w, fb, {k: round(v, 4) if isinstance(v, float) else v for k, v in rows[-1].items()}, flush=True)
    g1 = pd.DataFrame(rows)
    g1.to_csv(OUT / "grid_B1.csv", index=False)
    g1 = g1.assign(pref=(g1.window != 15).astype(int) * 2 + (g1.fallback != "market").astype(int))
    best = g1.sort_values(["timing_value_month%", "pref"], ascending=[False, True]).iloc[0]
    b1 = replace(b0, entry="B1", window=int(best.window), fallback=best.fallback)
    print("chosen B1:", asdict(b1), flush=True)
    (OUT / "chosen.json").write_text(json.dumps({"B0": asdict(b0), "B1": asdict(b1), "note_B0": note0}, indent=2))


def load_chosen():
    d = json.loads((OUT / "chosen.json").read_text())
    return Book(**d["B0"]), Book(**d["B1"])


def evaluate(b0: Book, b1: Book, per: str) -> dict:
    a, z = PERIODS[per]
    out = {"benchmarks": ew_benchmark(a, z)}
    for cost in COST_SIDE:
        r0 = simulate(replace(b0, cost=cost), a, z)
        r1 = simulate(replace(b1, cost=cost), a, z)
        m0, m1 = metrics(r0), metrics(r1)
        dist = b2_distribution(replace(b1, cost=cost), a, z, r1["waits"])
        out[cost] = {"B0": m0, "B1": m1, "B2_mean_month%_mean": dist["mean_month%"].mean(),
                     "B2_cagr_dd_mean": np.nanmean(dist["cagr_dd"]),
                     "p_b1_vs_b2_month": float(np.mean(dist["mean_month%"] >= m1["mean_month%"])),
                     "p_b1_vs_b2_cagr_dd": float(np.mean(dist["cagr_dd"] >= m1["cagr_dd"])),
                     "timing": timing_stats(r1, r0)}
        for k, r in (("B0", r0), ("B1", r1)):
            r["equity"].to_csv(OUT / f"equity_{per}_{k}_{cost}.csv")
            r["positions"].to_csv(OUT / f"positions_{per}_{k}_{cost}.csv", index=False)
        yr = lambda e: {int(y): round(float(v) * 100, 1) for y, v in e.resample("YE").last().pct_change().dropna().items()}
        out[cost]["by_year_B0%"], out[cost]["by_year_B1%"] = yr(r0["equity"]), yr(r1["equity"])
    return out


def seen():
    b0, b1 = load_chosen()
    res = {"B0": asdict(b0), "B1": asdict(b1)}
    for per in ("in_sample", "seen"):
        res[per] = evaluate(b0, b1, per)
        print(per, json.dumps(res[per], default=lambda x: round(float(x), 3)), flush=True)
    (OUT / "eval.json").write_text(json.dumps(res, indent=2, default=float))


def sens():
    b0, b1 = load_chosen()
    variants = {"chosen": (b0, b1), "n -5": None, "n +5": None, "lookback switch": None, "window -5": None,
                "window +5": None, "fallback switch": None, "buffer 1.5": None, "buffer 3": None,
                "futures costs": None, "rebalance first day": None}
    mk = {
        "n -5": dict(n=b0.n - 5), "n +5": dict(n=b0.n + 5),
        "lookback switch": dict(lookback="6-1" if b0.lookback == "12-1" else "12-1"),
        "buffer 1.5": dict(buffer=1.5), "buffer 3": dict(buffer=3.0), "futures costs": dict(cost="fut"),
        "rebalance first day": dict(rebalance="first"),
    }
    rows = []
    for name in variants:
        if name == "chosen":
            v0, v1 = b0, b1
        elif name in mk:
            v0, v1 = replace(b0, **mk[name]), replace(b1, **mk[name])
        elif name.startswith("window"):
            w = max(3, b1.window + (5 if "+" in name else -5))
            v0, v1 = b0, replace(b1, window=w)
        else:  # fallback switch
            v0, v1 = b0, replace(b1, fallback="skip" if b1.fallback == "market" else "market")
        row = {"variant": name}
        for per in ("in_sample", "seen"):
            a, z = PERIODS[per]
            r0, r1 = simulate(v0, a, z), simulate(v1, a, z)
            m0, m1 = metrics(r0), metrics(r1)
            dist = b2_distribution(v1, a, z, r1["waits"]) if name in ("chosen", "window -5", "window +5", "fallback switch") else None
            row.update({f"{per}_B0_cagr": m0["cagr%"], f"{per}_B0_dd": m0["maxdd%"], f"{per}_B0_cagr_dd": m0["cagr_dd"],
                        f"{per}_B1_cagr": m1["cagr%"], f"{per}_B1_dd": m1["maxdd%"], f"{per}_B1_cagr_dd": m1["cagr_dd"],
                        f"{per}_b1_minus_b0_month%": m1["mean_month%"] - m0["mean_month%"]})
            if dist is not None:
                row[f"{per}_b1_minus_b2_month%"] = m1["mean_month%"] - dist["mean_month%"].mean()
        rows.append(row)
        print({k: (round(x, 3) if isinstance(x, float) else x) for k, x in row.items()}, flush=True)
    pd.DataFrame(rows).to_csv(OUT / "sensitivity.csv", index=False)


if __name__ == "__main__":
    {"grid": grid, "seen": seen, "sens": sens}[sys.argv[1]]()
