"""Market analysis: base rates on NSE daily data (2005 onward).

Run:  backend/.venv/Scripts/python.exe research/01_market_analysis/analyze.py
Writes CSV tables to research/01_market_analysis/out/ and prints a summary
that report.md is written from.

Conventions
- Forward return fwdN = close[t+N] / close[t] - 1: what you'd get acting at
  the close of the signal bar (an upper bound on next-open execution).
- "excess" = mean fwd return minus the unconditional mean over the same
  stock-days, so the market's drift doesn't masquerade as an edge.
- Round-trip trading cost assumed ~0.3% (0.1%/side costs + 0.05%/side slip).
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "common"))
import data  # noqa: E402
import structure  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)
H = (5, 10, 20)
SPLIT = "2019-01-01"  # same split later used for in-sample / out-of-sample


def atr(df, n=14):
    pc = df["close"].shift()
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean()


def features(df: pd.DataFrame, idx: pd.DataFrame) -> pd.DataFrame:
    f = pd.DataFrame(index=df.index)
    c = df["close"]
    for n in H:
        f[f"fwd{n}"] = c.shift(-n) / c - 1
    f["ret1"] = c.pct_change()
    f["ret5"] = c / c.shift(5) - 1
    f["sma200"] = c > c.rolling(200).mean()
    f["sma50"] = c > c.rolling(50).mean()
    f["atr_pct"] = atr(df) / c * 100
    f["fwd_vol20"] = f["ret1"].rolling(20).std().shift(-20) * np.sqrt(252) * 100
    f["past_vol20"] = f["ret1"].rolling(20).std() * np.sqrt(252) * 100
    st = structure.trend_state(df, 2)
    f["trend"] = st["trend"]
    wk = df.resample("W-FRI").agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    wst = structure.trend_state(wk, 2)["trend"]
    # weekly state is known at the week's close: apply from the next week on
    f["wtrend"] = wst.shift(1).reindex(df.index, method="ffill")
    # breakouts (Donchian, on closes beyond prior highs/lows)
    for n in (20, 55, 250):
        hi = df["high"].rolling(n).max().shift()
        lo = df["low"].rolling(n).min().shift()
        f[f"bo_up{n}"] = (c > hi) & (c.shift() <= hi.shift())
        f[f"bo_dn{n}"] = (c < lo) & (c.shift() >= lo.shift())
        f[f"hi{n}"] = hi
        f[f"lo{n}"] = lo
    # gaps
    f["gap"] = (df["open"] / c.shift() - 1) * 100
    f["gap_fill_up"] = df["low"] <= c.shift()  # gap up filled intraday
    f["gap_fill_dn"] = df["high"] >= c.shift()
    f["oc"] = df["close"] / df["open"] - 1
    f["dow"] = df.index.dayofweek
    f["idx_up"] = idx["above200"].reindex(df.index, method="ffill")
    f["clv"] = ((c - df["low"]) / (df["high"] - df["low"]).replace(0, np.nan))
    return f


def summarize(groups, col="fwd20"):
    g = groups[col]
    return pd.DataFrame({"n": g.count(), "mean%": g.mean() * 100, "median%": g.median() * 100, "win%": g.apply(lambda x: (x > 0).mean() * 100)})


def main():
    idx_df = data.bars("NIFTY50")
    idx = pd.DataFrame({"above200": idx_df["close"] > idx_df["close"].rolling(200).mean()})
    pan = data.panel(start="2005-01-01")
    print(f"# dataset: {len(pan)} stocks, {sum(len(d) for d in pan.values()):,} stock-days, "
          f"{min(d.index[0] for d in pan.values()).date()} .. {max(d.index[-1] for d in pan.values()).date()}")
    frames, leg_rows = [], []
    for sym, df in pan.items():
        f = features(df, idx)
        f["symbol"] = sym
        frames.append(f)
        lg = structure.legs(df, 2)
        if len(lg):
            lg["symbol"] = sym
            # forward returns from the close of the bar on which the leg's end swing is confirmed
            cc = df["close"].to_numpy()
            ka = lg["known_at"].to_numpy()
            for n in (10, 20):
                ok = ka + n < len(cc)
                v = np.full(len(lg), np.nan)
                v[ok] = cc[ka[ok] + n] / cc[ka[ok]] - 1
                lg[f"fwd{n}_known"] = v
            lg["base20"] = f["fwd20"].mean()
            leg_rows.append(lg)
    F = pd.concat(frames)
    F = F[F["fwd20"].notna()]
    F["period"] = np.where(F.index < SPLIT, "2005-18", "2019-26")
    base = F["fwd20"].mean()

    # --- A. drift / buy & hold --------------------------------------------------------------------
    print("\n## A. Drift")
    cagr = {s: (d["close"].iloc[-1] / d["close"].iloc[0]) ** (252 / len(d)) - 1 for s, d in pan.items()}
    cg = pd.Series(cagr) * 100
    ic = (idx_df["close"].iloc[-1] / idx_df.loc["2005-01-01":, "close"].iloc[0]) ** (252 / len(idx_df.loc["2005-01-01":])) - 1
    print(f"stock buy&hold CAGR: median {cg.median():.1f}%, mean {cg.mean():.1f}%, 10th pct {cg.quantile(.1):.1f}%, "
          f"90th pct {cg.quantile(.9):.1f}%, negative: {(cg < 0).sum()} of {len(cg)}")
    print(f"NIFTY 50 CAGR since 2005: {ic * 100:.1f}%")
    print(f"unconditional stock-day fwd5/10/20 mean: " + ", ".join(f"{F[f'fwd{n}'].mean() * 100:.2f}%" for n in H)
          + f"; fwd20 win% {(F['fwd20'] > 0).mean() * 100:.1f}")
    cg.sort_values().to_csv(OUT / "cagr_by_stock.csv")

    # --- B. regime filters ----------------------------------------------------------------------
    print("\n## B. Regime (fwd20 per stock-day)")
    t = summarize(F.groupby(["idx_up", "sma200"]))
    print(t.round(2).to_string())
    t.to_csv(OUT / "regime_sma200.csv")
    print(summarize(F.groupby(["period", "idx_up"])).round(2).to_string())

    # --- C. YTC structure state -----------------------------------------------------------------
    print("\n## C. YTC structure (daily swings n=2; weekly state lagged one week)")
    share = F["trend"].value_counts(normalize=True) * 100
    print("time share daily:", share.round(1).to_dict())
    print("time share weekly:", (F["wtrend"].value_counts(normalize=True) * 100).round(1).to_dict())
    t = summarize(F.groupby("trend"))
    print(t.round(2).to_string())
    t2 = summarize(F.groupby(["wtrend", "trend"]))
    print(t2.round(2).to_string())
    t2.to_csv(OUT / "structure_state.csv")
    for p in ("2005-18", "2019-26"):
        print(p, summarize(F[F.period == p].groupby("wtrend")).round(2)[["n", "mean%", "win%"]].to_dict("index"))
    # persistence: daily state 20 bars later
    pers = []
    for sym, g in F.groupby("symbol"):
        s = g["trend"]
        pers.append(pd.crosstab(s, s.shift(-20), normalize="index"))
    print("P(state in 20 bars | state now):\n", (sum(pers) / len(pers) * 100).round(1).to_string())

    # --- D. volatility --------------------------------------------------------------------------
    print("\n## D. Volatility (ATR14 % of price, per-date cross-sectional quintile)")
    F["volq"] = F.groupby(level=0)["atr_pct"].transform(lambda x: pd.qcut(x.rank(method="first"), 5, labels=False) + 1 if x.notna().sum() >= 10 else np.nan)
    t = F.groupby("volq").agg(n=("fwd20", "count"), mean=("fwd20", "mean"), win=("fwd20", lambda x: (x > 0).mean()),
                              atr=("atr_pct", "median"), fwd_vol=("fwd_vol20", "median"))
    t["mean"] *= 100
    t["win"] *= 100
    print(t.round(2).to_string())
    c = F[["past_vol20", "fwd_vol20"]].dropna().corr().iloc[0, 1]
    print(f"vol clustering: corr(past 20d vol, next 20d vol) = {c:.2f}")
    t.to_csv(OUT / "volatility.csv")

    # --- E. swings: pullback depth and continuation --------------------------------------------
    print("\n## E. Swing legs (n=2)")
    L = pd.concat(leg_rows, ignore_index=True)
    up, dn = L[L.dir == "up"], L[L.dir == "down"]
    print(f"legs: {len(L):,}; up leg median {up.pct.median():.1f}% over {up.bars.median():.0f} bars; "
          f"down leg median {dn.pct.median():.1f}% over {dn.bars.median():.0f} bars")
    # sequences E1 (up) -> P (down) -> E2 (up)
    # Sequences E1 (up leg) -> P (pullback, down leg) -> E2 (next up leg), built with
    # shifted columns. Leg k-2 is the previous up leg: E1 is "in an uptrend" when
    # it made a higher high AND started from a higher low than that leg.
    seqs = []
    for sym, g in L.groupby("symbol"):
        g = g.reset_index(drop=True)
        s = pd.DataFrame({
            "symbol": sym, "date": g["date"].shift(-1), "dir": g["dir"], "e1_pct": g["pct"], "e1_size": g["size"],
            "e1_start": g["start"], "e1_end": g["end"], "p_size": g["size"].shift(-1), "p_end": g["end"].shift(-1),
            "pb_bars": g["bars"].shift(-1), "e2_end": g["end"].shift(-2), "e2_size": g["size"].shift(-2),
            "prev_high": g["end"].shift(2), "prev_low": g["start"].shift(2),
            "fwd10_known": g["fwd10_known"].shift(-1), "fwd20_known": g["fwd20_known"].shift(-1), "base20": g["base20"],
        })
        seqs.append(s[(s["dir"] == "up") & s["e2_end"].notna()])
    S = pd.concat(seqs, ignore_index=True)
    S = S[S.e1_size > 0]
    S["depth"] = S.p_size / S.e1_size * 100
    S["cont"] = S.e2_end > S.e1_end
    S["e2_vs_e1"] = S.e2_size / S.e1_size
    S["broke_prior_low"] = S.p_end < S.e1_start
    S["trend_up"] = (S.e1_end > S.prev_high) & (S.e1_start > S.prev_low)
    S["x20"] = (S.fwd20_known - S.base20) * 100  # excess fwd20 from the pullback-low confirmation bar
    S["depth_b"] = pd.cut(S.depth, [0, 25, 38.2, 50, 61.8, 78.6, 100, 1000], right=False)
    print(f"pullback depth (% of prior up leg): median {S.depth.median():.0f}%, IQR {S.depth.quantile(.25):.0f}-{S.depth.quantile(.75):.0f}%; "
          f"pullback bars median {S.pb_bars.median():.0f}")
    t = S.groupby("depth_b", observed=True).agg(n=("cont", "size"), cont=("cont", "mean"), e2_vs_e1=("e2_vs_e1", "median"))
    t["cont"] *= 100
    print("P(next up leg makes a new high | pullback depth):\n", t.round(2).to_string())
    t2 = S[S.trend_up].groupby("depth_b", observed=True).agg(n=("cont", "size"), cont=("cont", "mean"), x20=("x20", "mean"))
    t2["cont"] *= 100
    print("same, only when E1 was part of an uptrend (HH+HL):\n", t2.round(2).to_string())
    print(f"share of up legs that are part of an uptrend: {S.trend_up.mean() * 100:.1f}%")
    print(f"deep pullbacks that broke the prior swing low (<E1 start): n={S.broke_prior_low.sum()}, cont {S[S.broke_prior_low].cont.mean() * 100:.1f}%")
    # tradeable view: excess fwd20 measured from the bar the pullback low is confirmed
    print(f"excess fwd20% from pullback-low confirmation: all {S.x20.mean():.2f} (n={S.x20.notna().sum()}), "
          f"uptrend {S[S.trend_up].x20.mean():.2f}, not uptrend {S[~S.trend_up].x20.mean():.2f}")
    xt = S.groupby([S.trend_up, pd.cut(S.pb_bars, [0, 3, 5, 8, 1000])], observed=True)["x20"].agg(["count", "mean"])
    print("excess fwd20% by trend_up x pullback bars:\n", xt.round(2).to_string())
    S.to_csv(OUT / "pullback_sequences.csv", index=False)
    t.to_csv(OUT / "pullback_depth_continuation.csv")
    dd = S.groupby(pd.cut(S.pb_bars, [0, 3, 5, 8, 13, 21, 1000]), observed=True)["cont"].agg(["size", "mean"])
    dd["mean"] *= 100
    print("by pullback duration (bars):\n", dd.round(1).to_string())

    # --- F. breakouts ---------------------------------------------------------------------------
    print("\n## F. Breakouts (close beyond prior N-bar high/low)")
    rows = []
    for n in (20, 55, 250):
        for side in ("up", "dn"):
            m = F[f"bo_{side}{n}"]
            sub = F[m]
            r = {"N": n, "side": side, "n": len(sub)}
            for h in H:
                r[f"fwd{h}%"] = sub[f"fwd{h}"].mean() * 100
            r["excess20%"] = r["fwd20%"] - base * 100
            r["win20%"] = (sub["fwd20"] > 0).mean() * 100
            rows.append(r)
    B = pd.DataFrame(rows)
    print(B.round(2).to_string())
    B.to_csv(OUT / "breakouts.csv", index=False)
    # breakout failure: within 3 bars of an up-breakout the close is back below the breakout level
    print("\nBreakout failure (BOF) / follow-through, N=20:")
    fails = []
    for sym, df in pan.items():
        f = F[F.symbol == sym]
        if f.empty:
            continue
        c = df["close"].reindex(f.index)
        for side in ("up", "dn"):
            ev = np.flatnonzero(f[f"bo_{side}20"].to_numpy())
            level = f[f"hi20" if side == "up" else "lo20"].to_numpy()
            cc = c.to_numpy()
            fw = f["fwd20"].to_numpy()
            for i in ev:
                if i + 3 >= len(cc):
                    continue
                back = (cc[i + 1:i + 4] < level[i]).any() if side == "up" else (cc[i + 1:i + 4] > level[i]).any()
                # after failure, measure from the failure-confirmation bar (first close back inside)
                j = None
                if back:
                    k = np.flatnonzero(cc[i + 1:i + 4] < level[i] if side == "up" else cc[i + 1:i + 4] > level[i])[0]
                    j = i + 1 + k
                fails.append({"symbol": sym, "side": side, "failed": back, "fwd20_bo": fw[i],
                              "fwd10_after_fail": (cc[j + 10] / cc[j] - 1) if j is not None and j + 10 < len(cc) else np.nan,
                              "idx_up": f["idx_up"].iloc[i], "wtrend": f["wtrend"].iloc[i]})
    BF = pd.DataFrame(fails)
    for side in ("up", "dn"):
        s = BF[BF.side == side]
        print(f" {side}: n={len(s)}, failed within 3 bars {s.failed.mean() * 100:.1f}%; fwd20 if held {s[~s.failed].fwd20_bo.mean() * 100:.2f}% "
              f"vs if failed {s[s.failed].fwd20_bo.mean() * 100:.2f}%; fwd10 measured from the failure bar {s.fwd10_after_fail.mean() * 100:.2f}%")
    print(" up-breakouts by weekly trend:", BF[BF.side == "up"].groupby("wtrend").agg(n=("failed", "size"), fail=("failed", "mean"), fwd20=("fwd20_bo", "mean")).round(3).to_dict("index"))
    BF.to_csv(OUT / "breakout_failures.csv", index=False)

    # --- G. short-term mean reversion vs momentum ----------------------------------------------
    print("\n## G. Short-term: 5-day return decile (per date) -> next 5 days")
    F["r5d"] = F.groupby(level=0)["ret5"].transform(lambda x: pd.qcut(x.rank(method="first"), 10, labels=False) + 1 if x.notna().sum() >= 20 else np.nan)
    t = F.groupby("r5d")["fwd5"].agg(["count", "mean"])
    t["mean"] = (t["mean"] - F["fwd5"].mean()) * 100
    print("excess fwd5% by decile (1 = biggest 5d losers):", t["mean"].round(2).to_dict())
    t2 = F[F.sma200 == True].groupby("r5d")["fwd5"].mean()  # noqa: E712
    print("  only above 200 SMA:", ((t2 - F["fwd5"].mean()) * 100).round(2).to_dict())
    for p in ("2005-18", "2019-26"):
        tp = F[F.period == p].groupby("r5d")["fwd5"].mean()
        print(f"  {p}:", ((tp - F[F.period == p]["fwd5"].mean()) * 100).round(2).to_dict())
    t.to_csv(OUT / "reversal_5d.csv")
    # 12-1 momentum, monthly cross-section
    month_ends = []
    for sym, df in pan.items():
        m = df["close"].resample("ME").last()
        month_ends.append(pd.DataFrame({"symbol": sym, "mom": m.shift(1) / m.shift(12) - 1, "next": m.shift(-1) / m - 1}))
    M = pd.concat(month_ends).dropna()
    M["q"] = M.groupby(level=0)["mom"].transform(lambda x: pd.qcut(x.rank(method="first"), 5, labels=False) + 1 if len(x) >= 20 else np.nan)
    mt = M.groupby("q")["next"].mean() * 100
    print("12-1 month momentum quintile -> next-month return %:", mt.round(2).to_dict())
    mp = M.assign(period=np.where(M.index < SPLIT, "2005-18", "2019-26")).groupby(["period", "q"])["next"].mean().unstack() * 100
    print(mp.round(2).to_string())

    # --- H. gaps --------------------------------------------------------------------------------
    print("\n## H. Gaps")
    for lo, hi_ in ((1, 2), (2, 4), (4, 100)):
        gu = F[(F.gap >= lo) & (F.gap < hi_)]
        gd = F[(F.gap <= -lo) & (F.gap > -hi_)]
        print(f" gap {lo}-{hi_}%: up n={len(gu)} filled same day {gu.gap_fill_up.mean() * 100:.0f}%, open->close {gu.oc.mean() * 100:.2f}%, "
              f"fwd5 excess {(gu.fwd5.mean() - F.fwd5.mean()) * 100:.2f}% | down n={len(gd)} filled {gd.gap_fill_dn.mean() * 100:.0f}%, "
              f"open->close {gd.oc.mean() * 100:.2f}%, fwd5 excess {(gd.fwd5.mean() - F.fwd5.mean()) * 100:.2f}%")
    print(f" share of days with |gap| >= 1%: {(F.gap.abs() >= 1).mean() * 100:.1f}%")

    # --- I. day of week (index) ------------------------------------------------------------------
    ir = idx_df["close"].pct_change()
    print("\n## I. NIFTY 50 mean daily return by weekday %:", (ir.groupby(ir.index.dayofweek).mean() * 100).round(3).to_dict())

    # --- J. index vs stocks ----------------------------------------------------------------------
    print("\n## J. Index")
    fi = features(idx_df.loc["2005-01-01":], idx)
    fi = fi[fi.fwd20.notna()]
    print(" NIFTY 50 by weekly trend:", summarize(fi.groupby("wtrend")).round(2)[["n", "mean%", "win%"]].to_dict("index"))
    for n in (20, 55):
        s = fi[fi[f"bo_up{n}"]]
        print(f" NIFTY up-breakout {n}: n={len(s)}, fwd20 {s.fwd20.mean() * 100:.2f}% (base {fi.fwd20.mean() * 100:.2f}%)")
    li = structure.legs(idx_df.loc["2005-01-01":], 2)
    print(f" index legs: up median {li[li.dir == 'up'].pct.median():.1f}% / {li[li.dir == 'up'].bars.median():.0f} bars, "
          f"down {li[li.dir == 'down'].pct.median():.1f}% / {li[li.dir == 'down'].bars.median():.0f} bars")
    r = idx_df["close"].pct_change().loc["2005-01-01":]
    print(f" index lag-1 autocorr of daily returns: {r.autocorr(1):.3f}; stocks median: "
          f"{np.median([d['close'].pct_change().autocorr(1) for d in pan.values()]):.3f}")


if __name__ == "__main__":
    main()
