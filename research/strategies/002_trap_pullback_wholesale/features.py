"""Strategy 002 features for both stacks (spec.md). Everything at bar t uses
data up to t's close; daily context (momentum, F&O eligibility, liquidity)
uses values known at the previous session's close.

Stacks:
  D: trading timeframe daily, adjusted bhavcopy panel, symbols that ever had
     stock futures, 2005 ->.
  H: trading timeframe 1h, hourly.load_1h() (135 stocks, Nov 2023 ->).

    build("D") / build("H") -> dict symbol -> DataFrame of bars + features
    (cached in research/data/s002_features_<stack>.pkl)
"""

import pickle
import sys
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
COMMON = HERE.parents[1] / "common"
sys.path.insert(0, str(COMMON))
import adjust  # noqa: E402
import structure  # noqa: E402

DATA = HERE.parents[1] / "data"
MIN_VALUE = {"D": 10e7, "H": 25e7}  # 20-day median traded value: Rs 10 cr (D), Rs 25 cr (H)


def swing_features(df: pd.DataFrame) -> pd.DataFrame:
    """Causal swing sequence (as in 001, truncation-tested there): sh, sh_i, l0,
    pl (lowest low since SH), trail_sl (latest confirmed swing low)."""
    h, l = df["high"].to_numpy(), df["low"].to_numpy()
    n = len(df)
    raw = structure.raw_swings(h, l, 2)
    out = {k: np.full(n, np.nan) for k in ("sh", "sh_i", "l0", "pl", "trail_sl")}
    seq: list = []
    k = 0
    last_low = np.nan
    for t in range(n):
        while k < len(raw) and raw[k].known_at <= t:
            s = raw[k]
            k += 1
            if s.kind == "L":
                last_low = s.price
            if seq and seq[-1].kind == s.kind:
                if (s.price > seq[-1].price) if s.kind == "H" else (s.price < seq[-1].price):
                    seq[-1] = s
            else:
                seq.append(s)
        out["trail_sl"][t] = last_low
        j = len(seq) - 1 if seq and seq[-1].kind == "H" else len(seq) - 2
        if j < 1:
            continue
        s = seq[j]
        out["sh"][t], out["sh_i"][t], out["l0"][t] = s.price, s.i, seq[j - 1].price
        if t > s.i:
            out["pl"][t] = l[s.i + 1:t + 1].min()
        if len(seq) > 8:
            del seq[:-6]
    return pd.DataFrame(out, index=df.index)


def bar_features(df: pd.DataFrame) -> pd.DataFrame:
    f = swing_features(df)
    for c in ("open", "high", "low", "close"):
        f[c] = df[c].astype("float64")
    f["bars_since"] = np.arange(len(df)) - f["sh_i"]
    prev_close = f["close"].shift()
    tr = np.maximum(f["high"] - f["low"], np.maximum((f["high"] - prev_close).abs(), (f["low"] - prev_close).abs()))
    f["atr"] = tr.rolling(14).mean()
    f["mid"] = f["close"].rolling(20).mean()
    f["u"] = (f["high"] - f["low"]).rolling(20).mean()
    return f


def fo_symbols(sc: pd.DataFrame) -> pd.DataFrame:
    """(canon, date) for every day a stock had futures (F&O-eligible)."""
    con = duckdb.connect(str(DATA / "nse_bhav.duckdb"), read_only=True)
    fo = con.execute("SELECT DISTINCT date, symbol FROM fo_fut WHERE instrument = 'FUTSTK'").df()
    con.close()
    fo["date"] = pd.to_datetime(fo["date"])
    fo["canon"] = adjust.canonical(fo["symbol"], fo["date"], sc)
    return fo[["canon", "date"]].drop_duplicates()


def daily_context(panel: pd.DataFrame, fo: pd.DataFrame, stack: str) -> pd.DataFrame:
    """Per (canon, date), values known at the close of the PREVIOUS session:
    tradeable (F&O on the date itself, which is published in advance; and the
    20-day median value up to d-1 above the stack's floor), mom_pct (126-day
    return percentile among tradeable stocks), daily ATR (for the gap rule)."""
    p = panel[["canon", "date", "close", "high", "low", "value"]].copy()
    p["canon"] = p["canon"].astype(str)
    p = p.sort_values(["canon", "date"])
    g = p.groupby("canon")
    p["med_value20"] = g["value"].transform(lambda s: s.rolling(20, min_periods=15).median())
    p["ret126"] = g["close"].transform(lambda s: s / s.shift(126) - 1)
    pc = g["close"].shift()
    tr = np.maximum(p["high"] - p["low"], np.maximum((p["high"] - pc).abs(), (p["low"] - pc).abs()))
    p["datr"] = tr.groupby(p["canon"]).transform(lambda s: s.rolling(14).mean())
    p = p.merge(fo.assign(fo=True), on=["canon", "date"], how="left")
    p["fo"] = p["fo"].fillna(False).astype(bool)
    # shift to "known before the session": med_value, ret126, datr from the previous row
    for c in ("med_value20", "ret126", "datr", "close"):
        p[c + "_prev"] = p.groupby("canon")[c].shift()
    p["tradeable"] = p["fo"] & (p["med_value20_prev"] >= MIN_VALUE[stack])
    # momentum percentile among stocks tradeable that day (a stack-D style universe for both stacks)
    t = p["fo"] & (p["med_value20_prev"] >= MIN_VALUE["D"])
    p["mom_pct"] = np.nan
    p.loc[t, "mom_pct"] = p[t].groupby("date")["ret126_prev"].rank(pct=True)
    return p[["canon", "date", "tradeable", "mom_pct", "datr_prev", "close_prev"]]


def build(stack: str, refresh: bool = False) -> dict[str, pd.DataFrame]:
    cache = DATA / f"s002_features_{stack}.pkl"
    if cache.exists() and not refresh:
        return pickle.loads(cache.read_bytes())
    sc = adjust.symbol_map()
    eq = adjust.load_canon(sc)
    fo = fo_symbols(sc)
    eq = eq[eq["canon"].astype(str).isin(set(fo["canon"]))]
    panel = adjust.adjusted_panel(eq)
    del eq
    ctx = daily_context(panel, fo, stack)
    flags = adjust.flagged_dates()
    flag_days = {s: set(g["date"]) for s, g in flags.groupby("symbol")}
    out = {}
    if stack == "D":
        panel["canon"] = panel["canon"].astype(str)
        for sym, df in panel.groupby("canon"):
            if len(df) < 300:
                continue
            df = df.set_index("date").sort_index()
            f = bar_features(df)
            c = ctx[ctx.canon == sym].set_index("date").reindex(f.index)
            f["day"] = f.index
            out[sym] = attach(f, c, flag_days.get(sym, set()))
    else:
        import hourly  # noqa: PLC0415

        bars = hourly.load_1h(panel=panel)
        for sym, df in bars.items():
            if len(df) < 500:
                continue
            f = bar_features(df)
            day = f.index.normalize()
            c = ctx[ctx.canon == sym].set_index("date").reindex(day)
            c.index = f.index
            f["day"] = day
            f["first_bar"] = ~pd.Series(day, index=f.index).duplicated().to_numpy()
            out[sym] = attach(f, c, flag_days.get(sym, set()))
    cache.write_bytes(pickle.dumps(out))
    return out


def attach(f: pd.DataFrame, c: pd.DataFrame, flag_days: set) -> pd.DataFrame:
    f["tradeable"] = c["tradeable"].fillna(False).astype(bool).to_numpy()
    f["mom_pct"] = c["mom_pct"].to_numpy()
    f["datr"] = c["datr_prev"].to_numpy()
    f["dclose_prev"] = c["close_prev"].to_numpy()
    f["flagged"] = pd.Series(f["day"]).isin(flag_days).to_numpy()
    return f


if __name__ == "__main__":
    for st in sys.argv[1:] or ["H", "D"]:
        fe = build(st, refresh=True)
        n = sum(len(v) for v in fe.values())
        tradeable = sum(int(v["tradeable"].sum()) for v in fe.values())
        print(f"stack {st}: {len(fe)} symbols, {n:,} bars, tradeable bars {tradeable:,}")
