"""Download NSE's official daily bhavcopies (open, no login) into
research/data/nse_bhav.duckdb.

    research/.venv/Scripts/python.exe research/common/fetch_nse_bhav.py [start] [end] [--cm-only|--fo-only] [--workers=N]

- cm_bhav: every security traded in the cash market that day (all series),
  *including companies that were later delisted*. This is the
  survivorship-free universe that Yahoo lacks. Prices are raw (unadjusted).
- fo_fut: stock and index futures rows from the F&O bhavcopy (options are
  skipped to keep the file small). Which stocks have futures on a date is
  the F&O-eligible list for that date. lot_size is only present in the new
  (UDiFF) format, from Jul 2024.
- fetched(date, kind, status): resume log. 404s are holidays/weekends with
  no file; they are recorded and not retried. Anything else (403/429/5xx,
  timeouts, non-zip responses) is never recorded, so a re-run retries it.
- 5 download workers in parallel by default (--workers=N); one thread does all DuckDB writes.
  10 workers got the IP temporarily blocked by NSE (403 on every file, 17 Oct
  2026): stay at 3-5.

Two archive formats: the old CSV (to 2024-07-05) and UDiFF (from
2024-07-08). Requests are throttled; be polite to NSE's servers.
"""

import io
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import requests

DB = Path(__file__).resolve().parents[1] / "data" / "nse_bhav.duckdb"
BASE = "https://nsearchives.nseindia.com"
UDIFF_FROM = date(2024, 7, 8)
SLEEP = 0.35  # per worker, before every request
WORKERS = 5  # parallel downloads; writes stay single-threaded
H = {"User-Agent": "Mozilla/5.0 (research script; daily bhavcopy archive)", "Accept": "*/*"}
MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def url(kind: str, d: date) -> str:
    if d >= UDIFF_FROM:
        seg = "cm" if kind == "cm" else "fo"
        return f"{BASE}/content/{seg}/BhavCopy_NSE_{seg.upper()}_0_0_0_{d:%Y%m%d}_F_0000.csv.zip"
    folder = "EQUITIES" if kind == "cm" else "DERIVATIVES"
    pre = "cm" if kind == "cm" else "fo"
    return f"{BASE}/content/historical/{folder}/{d.year}/{MON[d.month - 1]}/{pre}{d:%d}{MON[d.month - 1]}{d.year}bhav.csv.zip"


def parse(kind: str, d: date, raw: bytes) -> pd.DataFrame:
    z = zipfile.ZipFile(io.BytesIO(raw))
    df = pd.read_csv(z.open(z.namelist()[0]), low_memory=False)
    df.columns = [c.strip() for c in df.columns]
    if d >= UDIFF_FROM:
        m = {"TckrSymb": "symbol", "OpnPric": "open", "HghPric": "high", "LwPric": "low", "ClsPric": "close",
             "TtlTradgVol": "volume", "TtlTrfVal": "value"}
        if kind == "cm":
            out = df.rename(columns={**m, "SctySrs": "series", "LastPric": "last", "PrvsClsgPric": "prevclose", "ISIN": "isin"})
            out = out[["symbol", "series", "open", "high", "low", "close", "last", "prevclose", "volume", "value", "isin"]]
        else:
            df = df[df["FinInstrmTp"].isin(["STF", "IDF"])]
            out = df.rename(columns={**m, "XpryDt": "expiry", "SttlmPric": "settle", "OpnIntrst": "oi",
                                     "NewBrdLotQty": "lot_size"})
            out["instrument"] = df["FinInstrmTp"].map({"STF": "FUTSTK", "IDF": "FUTIDX"})
            # UDiFF TtlTradgVol for futures is the number of contracts (value / (price x lot) matches it)
            out["contracts"] = out["volume"]
            out["volume"] = pd.NA
            out = out[["instrument", "symbol", "expiry", "open", "high", "low", "close", "settle", "contracts",
                       "volume", "value", "oi", "lot_size"]]
    else:
        if kind == "cm":
            out = df.rename(columns={"SYMBOL": "symbol", "SERIES": "series", "OPEN": "open", "HIGH": "high", "LOW": "low",
                                     "CLOSE": "close", "LAST": "last", "PREVCLOSE": "prevclose", "TOTTRDQTY": "volume",
                                     "TOTTRDVAL": "value", "ISIN": "isin"})
            if "isin" not in out:
                out["isin"] = pd.NA
            out = out[["symbol", "series", "open", "high", "low", "close", "last", "prevclose", "volume", "value", "isin"]]
        else:
            df = df[df["INSTRUMENT"].isin(["FUTSTK", "FUTIDX"])]
            out = df.rename(columns={"INSTRUMENT": "instrument", "SYMBOL": "symbol", "EXPIRY_DT": "expiry", "OPEN": "open",
                                     "HIGH": "high", "LOW": "low", "CLOSE": "close", "SETTLE_PR": "settle",
                                     "CONTRACTS": "contracts", "VAL_INLAKH": "value", "OPEN_INT": "oi"})
            out["volume"] = pd.NA
            out["lot_size"] = pd.NA
            out["value"] = pd.to_numeric(out["value"], errors="coerce") * 1e5  # lakh -> rupees
            out = out[["instrument", "symbol", "expiry", "open", "high", "low", "close", "settle", "contracts",
                       "volume", "value", "oi", "lot_size"]]
        if kind == "fo":
            out["expiry"] = pd.to_datetime(out["expiry"], format="mixed", dayfirst=True).dt.date
    if kind == "fo" and d >= UDIFF_FROM:
        out["expiry"] = pd.to_datetime(out["expiry"]).dt.date
    if kind == "cm":
        out["series"] = out["series"].astype(str).str.strip()
    out["symbol"] = out["symbol"].astype(str).str.strip()
    out.insert(0, "date", d)
    return out


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    start = date.fromisoformat(args[0]) if args else date(2005, 1, 1)
    end = date.fromisoformat(args[1]) if len(args) > 1 else date.today()
    kinds = ["cm"] if "--cm-only" in sys.argv else ["fo"] if "--fo-only" in sys.argv else ["cm", "fo"]
    global WORKERS
    WORKERS = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--workers=")), WORKERS)
    con = duckdb.connect(str(DB))
    con.execute("CREATE TABLE IF NOT EXISTS fetched (date DATE, kind VARCHAR, status INTEGER, rows INTEGER, PRIMARY KEY (date, kind))")
    con.execute("""CREATE TABLE IF NOT EXISTS cm_bhav (date DATE, symbol VARCHAR, series VARCHAR, open DOUBLE, high DOUBLE,
        low DOUBLE, close DOUBLE, last DOUBLE, prevclose DOUBLE, volume DOUBLE, value DOUBLE, isin VARCHAR)""")
    con.execute("""CREATE TABLE IF NOT EXISTS fo_fut (date DATE, instrument VARCHAR, symbol VARCHAR, expiry DATE, open DOUBLE,
        high DOUBLE, low DOUBLE, close DOUBLE, settle DOUBLE, contracts DOUBLE, volume DOUBLE, value DOUBLE, oi DOUBLE,
        lot_size DOUBLE)""")
    done = {(r[0], r[1]) for r in con.execute("SELECT date, kind FROM fetched").fetchall()}
    tasks = []
    d = start
    while d <= end:
        # every day incl. weekends: NSE has held Saturday and Sunday sessions (Budget days, 2006-06-25)
        tasks += [(d, k) for k in kinds if (d, k) not in done]
        d += timedelta(days=1)
    print(f"{len(tasks)} files to try with {WORKERS} workers", flush=True)
    n_ok = n_miss = n_retry = 0
    last_month = None
    # Workers only download and parse; this thread does every DuckDB write.
    with ThreadPoolExecutor(WORKERS) as pool:
        for i, (d, kind, status, df) in enumerate(pool.map(lambda t: fetch_one(*t), tasks)):
            if status == "ok":
                table = "cm_bhav" if kind == "cm" else "fo_fut"
                con.register("df", df)
                con.execute(f"DELETE FROM {table} WHERE date = ?", [d])
                con.execute(f"INSERT INTO {table} SELECT * FROM df")
                con.unregister("df")
                con.execute("INSERT OR REPLACE INTO fetched VALUES (?, ?, 200, ?)", [d, kind, len(df)])
                n_ok += 1
            elif status == "nofile":
                con.execute("INSERT OR REPLACE INTO fetched VALUES (?, ?, 404, 0)", [d, kind])
                n_miss += 1
            else:  # throttled / server error / odd response: not recorded, so the next run retries it
                print(d, kind, "not recorded:", status, flush=True)
                n_retry += 1
            if (d.year, d.month) != last_month:
                last_month = (d.year, d.month)
                print(f"{d}: files {n_ok}, no-file days {n_miss}, to retry {n_retry} ({i + 1}/{len(tasks)})", flush=True)
    print("done", n_ok, "files,", n_miss, "no-file days,", n_retry, "left for a re-run")
    con.close()


_local = threading.local()


def fetch_one(d: date, kind: str):
    """Download + parse one file. Only a 404 counts as "no file that day";
    403/429/5xx, timeouts and non-zip 200s are retried with backoff and, if
    they persist, reported as retry (never recorded as a holiday)."""
    sess = getattr(_local, "sess", None)
    if sess is None:
        sess = _local.sess = requests.Session()
        sess.headers.update(H)
    status = "no response"
    for attempt in range(5):
        time.sleep(SLEEP)  # per-worker politeness delay
        try:
            r = sess.get(url(kind, d), timeout=60)
        except requests.RequestException as e:
            status = type(e).__name__
            time.sleep(3 * (attempt + 1))
            continue
        if r.status_code == 404:
            return d, kind, "nofile", None
        if r.status_code == 200 and r.content[:2] == b"PK":
            return d, kind, "ok", parse(kind, d, r.content)
        status = f"HTTP {r.status_code}" + ("" if r.content[:2] == b"PK" else " (not a zip)")
        time.sleep(5 * (attempt + 1))  # throttled or server trouble: back off
    return d, kind, status, None


if __name__ == "__main__":
    main()
