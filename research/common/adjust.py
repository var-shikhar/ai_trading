"""Split / bonus / demerger adjustment for raw NSE bhavcopy prices.

    <app>/backend/.venv/Scripts/python.exe research/common/adjust.py      # build + report

build() writes nse_ref.duckdb:adj_factors with one row per (symbol, ex_date):
  factor  multiply every price *before* ex_date by this (volume by 1/factor)
  kind    split | bonus | split+bonus | demerger | yahoo_confirmed | inferred_split
  source  listed (NSE corporate actions) | yahoo | inferred (clean ratio only)
  check   close(ex_date) / close(previous day) / factor: ~1 when the factor is
          consistent with the actual price move
and nse_ref.duckdb:data_flags (symbol, date, reason): every inferred or
unexplained jump. Backtests should skip trades whose holding period spans a
flagged date (flagged_dates()), rather than trust a guess either way.

Rules:
- Split "From Rs A To Rs B": factor B/A. Bonus "a:b" (a new per b held):
  factor b/(a+b). Several on one ex-date multiply.
- A listed factor is kept only if the price confirms it: |ln(check)| < 0.2
  (a normal day's move is far smaller than a split's). Otherwise it's
  reported as rejected and not applied. NSE's list is incomplete before ~2010.
- Unlisted big moves (> 30% overnight gap or day):
  - research-universe stocks: Yahoo's adjusted history decides. Raw and Yahoo
    moves over the same span differing by > 30% means a corporate action (factor = raw /
    Yahoo ratio, which also handles a split on a crash day); otherwise a real move;
  - other stocks: a genuine split x bonus ratio of 2x or more (gap or day within
    4%) gives an
    inferred factor, and the date is flagged; anything else is flagged as
    unexplained and left unadjusted. (A volume/value test was tried and
    dropped: real 2005-09 splits failed it, e.g. HAVELLS, TORNTPHARM.)
- Demergers ("demerger" / "scheme of arrangement" in the subject): factor =
  open(ex_date) / close(previous day), applied only if the gap is more than 3%.
  This is approximate: it includes that morning's market move.
- Dividends are NOT adjusted: these are price returns (about 1-1.5%/yr below
  total return).

Symbols: bhavcopy and corporate actions use the symbol in force at the time.
canonical() maps old symbols to the latest one using NSE's symbol-change
list (only for dates before the change, since symbols are occasionally reused).
"""

import re
from fractions import Fraction
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / "data"
REF = DATA / "nse_ref.duckdb"
BHAV = DATA / "nse_bhav.duckdb"
NICE = sorted({float(Fraction(a, b)) for a in range(1, 11) for b in range(a + 1, 21) if b <= 4 * a or a == 1})
# split (face value) x bonus combinations, and their inverses (consolidations)
_SPLIT = [1, 1 / 2, 1 / 4, 1 / 5, 1 / 10, 2 / 5]
_BONUS = [1, 1 / 2, 2 / 3, 1 / 3, 3 / 4, 4 / 5, 3 / 5, 1 / 4, 1 / 5]
# Only genuine split x bonus products are candidates (a dense set of fractions matches any
# 30% move). Inverses (consolidations) only for >= 2x jumps.
NICE_ALL = sorted({round(s * b, 6) for s in _SPLIT for b in _BONUS if s * b < 0.75})
NICE_ALL = NICE_ALL + [1 / x for x in NICE_ALL if x <= 0.5]

SPLIT_RE = re.compile(r"(?:Rs|Re)\.?\s*([\d.]+)\s*/?-?.*?To\s*(?:Rs|Re)\.?\s*([\d.]+)", re.I)
BONUS_RE = re.compile(r"Bonus\s*(\d+)\s*:\s*(\d+)", re.I)


def parse_subject(subject: str) -> tuple[float, str] | None:
    s = subject or ""
    f, kinds = 1.0, []
    if re.search(r"split|sub-?division", s, re.I):
        m = SPLIT_RE.search(s)
        if m and float(m.group(1)) > 0 and float(m.group(2)) > 0:
            f *= float(m.group(2)) / float(m.group(1))
            kinds.append("split")
    for a, b in BONUS_RE.findall(s):
        a, b = int(a), int(b)
        if a > 0 and b > 0:
            f *= b / (a + b)
            kinds.append("bonus")
    if re.search(r"demerger|scheme of arrangement", s, re.I) and not kinds:
        return np.nan, "demerger"
    return (f, "+".join(kinds)) if kinds and abs(f - 1) > 1e-9 else None


def symbol_map() -> pd.DataFrame:
    con = duckdb.connect(str(REF), read_only=True)
    sc = con.execute("SELECT old_symbol, new_symbol, effective FROM symbol_changes WHERE effective IS NOT NULL").df()
    con.close()
    return sc


def canonical(symbols: pd.Series, dates: pd.Series, sc: pd.DataFrame | None = None) -> pd.Series:
    """Follow old->new symbol changes (only for rows dated before the change)."""
    sc = symbol_map() if sc is None else sc
    nxt = {r.old_symbol: (r.new_symbol, pd.Timestamp(r.effective)) for r in sc.itertuples()}
    d = pd.to_datetime(dates)
    out = symbols.astype(str).to_numpy().copy()
    for i, (s, t) in enumerate(zip(out, d)):
        seen = set()
        while s in nxt and t < nxt[s][1] and s not in seen:
            seen.add(s)
            s = nxt[s][0]
        out[i] = s
    return pd.Series(out, index=symbols.index)


MIN_MED_VALUE = 1e6  # Rs 10 lakh/day median: below this a stock can never pass a research liquidity filter


def load_eq(min_med_value: float = MIN_MED_VALUE) -> pd.DataFrame:
    """EQ/BE/BZ rows of symbols whose median traded value is at least min_med_value."""
    con = duckdb.connect(str(BHAV), read_only=True)
    eq = con.execute("""
        WITH keep AS (SELECT symbol FROM cm_bhav WHERE series IN ('EQ', 'BE', 'BZ') GROUP BY 1 HAVING median(value) >= ?)
        SELECT date, symbol, series, open, high, low, close, volume, value FROM cm_bhav
        WHERE series IN ('EQ', 'BE', 'BZ') AND symbol IN (SELECT symbol FROM keep)
        ORDER BY symbol, date, CASE series WHEN 'EQ' THEN 0 ELSE 1 END""", [min_med_value]).df()
    con.close()
    # EQ preferred when a symbol has several series on a day (moves to BE/BZ when restricted)
    eq = eq.drop_duplicates(["symbol", "date"], keep="first").drop(columns="series")
    eq["date"] = pd.to_datetime(eq["date"])
    for c in ("open", "high", "low", "close", "volume", "value"):
        eq[c] = eq[c].astype("float32")
    return eq


def load_canon(sc: pd.DataFrame | None = None, min_med_value: float = MIN_MED_VALUE) -> pd.DataFrame:
    """load_eq() with canonical symbols, one row per (canon, date), sorted. Load once and
    pass to build() and adjusted_panel() to keep memory down."""
    sc = symbol_map() if sc is None else sc
    eq = load_eq(min_med_value)
    eq["canon"] = canonical(eq["symbol"], eq["date"], sc)
    eq = eq.drop_duplicates(["canon", "date"], keep="last").sort_values(["canon", "date"]).reset_index(drop=True)
    eq["symbol"] = eq["symbol"].astype("category")  # ~6M rows: categories save hundreds of MB vs str
    eq["canon"] = eq["canon"].astype("category")
    return eq


def build(eq: pd.DataFrame | None = None) -> pd.DataFrame:
    sc = symbol_map()
    con = duckdb.connect(str(REF), read_only=True)
    ca = con.execute("SELECT symbol, subject, ex_date FROM corp_actions WHERE ex_date IS NOT NULL").df()
    con.close()
    ca["ex_date"] = pd.to_datetime(ca["ex_date"])
    ca["canon"] = canonical(ca["symbol"], ca["ex_date"], sc)
    ev = []
    for r in ca.itertuples():
        p = parse_subject(r.subject)
        if p:
            ev.append({"symbol": r.canon, "ex_date": r.ex_date, "factor": p[0], "kind": p[1], "subject": r.subject})
    ev = pd.DataFrame(ev)
    eq = (load_canon(sc) if eq is None else eq)[["canon", "date", "open", "close", "volume", "value"]].copy()
    g = eq.groupby("canon")
    eq["prev_close"] = g["close"].shift()
    eq["gap"] = eq["open"] / eq["prev_close"]
    eq["day"] = eq["close"] / eq["prev_close"]
    idx = eq.set_index(["canon", "date"])
    rows, rejected = [], []
    # listed events: combine same-day rows (split and bonus are often separate rows)
    listed = ev[ev.kind != "demerger"].drop_duplicates(["symbol", "ex_date", "subject"])
    for (sym, d), grp in listed.groupby(["symbol", "ex_date"]):
        f = float(np.prod(grp.factor))
        kind = "+".join(sorted(set("+".join(grp.kind).split("+"))))
        # ex_date may be a non-trading day: use the first trading day on/after it
        try:
            s = idx.loc[sym]
        except KeyError:
            rejected.append({"symbol": sym, "ex_date": d, "factor": f, "why": "symbol not in bhavcopy"})
            continue
        after = s.index[s.index >= d]
        if not len(after):
            continue
        t = after[0]
        chk = s.at[t, "day"] / f if not np.isnan(s.at[t, "day"]) else np.nan
        if np.isfinite(chk) and abs(np.log(chk)) < 0.2:
            rows.append({"symbol": sym, "ex_date": t, "factor": f, "kind": kind, "source": "listed", "check": chk})
        else:
            rejected.append({"symbol": sym, "ex_date": t, "factor": f, "why": f"price move {s.at[t, 'day']:.3f} vs factor"})
    for r in ev[ev.kind == "demerger"].drop_duplicates(["symbol", "ex_date"]).itertuples():
        try:
            s = idx.loc[r.symbol]
        except KeyError:
            continue
        after = s.index[s.index >= r.ex_date]
        if len(after) and np.isfinite(s.at[after[0], "gap"]) and abs(np.log(s.at[after[0], "gap"])) > 0.03:
            t = after[0]
            rows.append({"symbol": r.symbol, "ex_date": t, "factor": s.at[t, "gap"], "kind": "demerger",
                         "source": "listed", "check": 1.0})
    have = {(r["symbol"], r["ex_date"]) for r in rows}
    # Big moves (> 30% overnight gap or day) that no listed event explains.
    #  1. Universe stocks with Yahoo (adjusted) history: Yahoo decides. A normal Yahoo return on
    #     the same span means a corporate action; factor = raw ratio / Yahoo ratio. Otherwise it
    #     was a real move and stays.
    #  2. Other stocks: a clean split/bonus ratio (gap or day within 6%) gives an inferred factor.
    #     Volume/value tests proved unreliable on real 2005-09 events, so instead every inferred or
    #     unexplained jump is also written to data_flags, and backtests skip trades spanning it.
    from universe import STOCKS  # local import: research universe only

    import data as yfdata
    yclose = {}
    eq["prev_date"] = g["date"].shift()
    big = eq[(np.abs(np.log(eq["gap"])) > np.log(1.3)) | (np.abs(np.log(eq["day"])) > np.log(1.3))].dropna(subset=["gap", "day"])
    flags = []
    for r in big.itertuples():
        if any((r.canon, r.date + pd.Timedelta(days=k)) in have for k in range(-5, 6)):
            continue
        if r.canon in STOCKS:
            if r.canon not in yclose:
                yclose[r.canon] = yfdata.bars(r.canon, "2005-01-01")["close"]
            yc = yclose[r.canon]
            a, b = yc.asof(r.prev_date), yc.asof(r.date)
            if np.isfinite(a) and np.isfinite(b) and r.date >= yc.index[0]:
                yr = b / a
                # raw and adjusted moves differ by > 30%: a corporate action (possibly on the same day
                # as a real move, e.g. JINDALSTEL 2008-01-21: 1:5 split and a -27% crash)
                if abs(np.log(r.day / yr)) > np.log(1.3):
                    rows.append({"symbol": r.canon, "ex_date": r.date, "factor": r.day / yr, "kind": "yahoo_confirmed",
                                 "source": "yahoo", "check": 1.0})
                    have.add((r.canon, r.date))
                continue  # otherwise Yahoo shows the same move: a real move, keep it
        cand = min(NICE_ALL, key=lambda x: min(abs(np.log(r.gap / x)), abs(np.log(r.day / x))))
        # only >= 2x moves (1:1 bonus, splits): -33%/-40% matches (2:3, 3:5) are plausible crash sizes
        # (SATYAMCOMP 2009-01-09, COVID March 2020), so those stay unadjusted and flagged
        if (cand <= 0.5 or cand >= 2) and min(abs(np.log(r.gap / cand)), abs(np.log(r.day / cand))) < 0.04:
            rows.append({"symbol": r.canon, "ex_date": r.date, "factor": cand, "kind": "inferred_split",
                         "source": "inferred", "check": r.day / cand})
            have.add((r.canon, r.date))
            flags.append({"symbol": r.canon, "date": r.date, "reason": f"inferred factor {cand:.4f}"})
        else:
            flags.append({"symbol": r.canon, "date": r.date, "reason": f"unexplained move x{r.day:.3f}"})
    out = pd.DataFrame(rows).drop_duplicates(["symbol", "ex_date"]).sort_values(["symbol", "ex_date"])
    con = duckdb.connect(str(REF))
    for name, df in (("adj_factors", out), ("adj_rejected", pd.DataFrame(rejected)), ("data_flags", pd.DataFrame(flags))):
        con.register("df", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM df")
        con.unregister("df")
    con.close()
    return out


def flagged_dates() -> pd.DataFrame:
    """(symbol, date, reason) of inferred/unexplained jumps: skip trades spanning these."""
    con = duckdb.connect(str(REF), read_only=True)
    f = con.execute("SELECT * FROM data_flags").df()
    con.close()
    f["date"] = pd.to_datetime(f["date"])
    return f


def adjusted_panel(eq: pd.DataFrame | None = None, min_value: float = 0.0) -> pd.DataFrame:
    """EQ/BE/BZ rows (symbols above MIN_MED_VALUE) with canonical symbol and
    split/bonus/demerger-adjusted OHLC (volume adjusted inversely). Columns: canon,
    date, open..close, volume, value (raw traded value, unaffected), cum_factor.
    Pass eq from load_canon() to avoid loading the table twice."""
    eq = (load_canon() if eq is None else eq).copy()
    con = duckdb.connect(str(REF), read_only=True)
    fac = con.execute("SELECT symbol AS canon, ex_date, factor FROM adj_factors").df()
    con.close()
    fac["ex_date"] = pd.to_datetime(fac["ex_date"])
    # cum_factor(row) = product of all factors with ex_date > row date. Per symbol, the
    # reverse cumulative product at the first ex_date after the row gives exactly that.
    fac = fac.sort_values(["canon", "ex_date"])
    fac["rev_cum"] = fac.iloc[::-1].groupby("canon")["factor"].cumprod().iloc[::-1]
    if isinstance(eq["canon"].dtype, pd.CategoricalDtype):  # merge_asof needs matching key dtypes
        fac["canon"] = pd.Categorical(fac["canon"], categories=eq["canon"].cat.categories)
        fac = fac.dropna(subset=["canon"])
    eq = eq.sort_values("date")
    eq = pd.merge_asof(eq, fac[["canon", "ex_date", "rev_cum"]].sort_values("ex_date"), left_on="date",
                       right_on="ex_date", by="canon", direction="forward", allow_exact_matches=False)
    eq["cum_factor"] = eq["rev_cum"].fillna(1.0)
    eq = eq.drop(columns=["ex_date", "rev_cum"]).sort_values(["canon", "date"]).reset_index(drop=True)
    for c in ("open", "high", "low", "close"):
        eq[c] = eq[c] * eq["cum_factor"]
    eq["volume"] = eq["volume"] / eq["cum_factor"]
    if min_value:
        eq = eq[eq["value"] >= min_value]
    return eq


if __name__ == "__main__":
    f = build()
    print("adjustment factors:", len(f), "by kind:", f.kind.value_counts().to_dict())
    con = duckdb.connect(str(REF), read_only=True)
    rj = con.execute("SELECT * FROM adj_rejected").df()
    con.close()
    print("listed events rejected (price didn't confirm, or symbol absent):", len(rj),
          rj["why"].str.split(" ").str[0].value_counts().to_dict() if len(rj) else {})
    print(f[f.symbol.isin(["SBIN", "RELIANCE", "BAJFINANCE", "SIEMENS", "TRENT", "INFY", "HDFCBANK"])].to_string(index=False))
