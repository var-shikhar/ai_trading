"""Download NSE's official daily bhavcopies (open, no login) into
research/data/nse_bhav.duckdb.

    research/.venv/Scripts/python.exe research/common/fetch_nse_bhav.py [start] [end] [--cm-only|--fo-only]

- cm_bhav: every security traded in the cash market that day (all series),
  *including companies that were later delisted*. This is the
  survivorship-free universe that Yahoo lacks. Prices are raw (unadjusted).
- fo_fut: stock and index futures rows from the F&O bhavcopy (options are
  skipped to keep the file small). Which stocks have futures on a date is
  the F&O-eligible list for that date. lot_size is only present in the new
  (UDiFF) format, from Jul 2024.
- fetched(date, kind, status): resume log. 404s are holidays/weekends with
  no file; they are recorded and not retried.

Two archive formats: the old CSV (to 2024-07-05) and UDiFF (from
2024-07-08). Requests are throttled; be polite to NSE's servers.
"""

import io
import sys
import time
import zipfile
from datetime import date, timedelta
from pathlib import Path

import duckdb
import pandas as pd
import requests

DB = Path(__file__).resolve().parents[1] / "data" / "nse_bhav.duckdb"
BASE = "https://nsearchives.nseindia.com"
UDIFF_FROM = date(2024, 7, 8)
SLEEP = 0.35
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
    con = duckdb.connect(str(DB))
    con.execute("CREATE TABLE IF NOT EXISTS fetched (date DATE, kind VARCHAR, status INTEGER, rows INTEGER, PRIMARY KEY (date, kind))")
    con.execute("""CREATE TABLE IF NOT EXISTS cm_bhav (date DATE, symbol VARCHAR, series VARCHAR, open DOUBLE, high DOUBLE,
        low DOUBLE, close DOUBLE, last DOUBLE, prevclose DOUBLE, volume DOUBLE, value DOUBLE, isin VARCHAR)""")
    con.execute("""CREATE TABLE IF NOT EXISTS fo_fut (date DATE, instrument VARCHAR, symbol VARCHAR, expiry DATE, open DOUBLE,
        high DOUBLE, low DOUBLE, close DOUBLE, settle DOUBLE, contracts DOUBLE, volume DOUBLE, value DOUBLE, oi DOUBLE,
        lot_size DOUBLE)""")
    done = {(r[0], r[1]) for r in con.execute("SELECT date, kind FROM fetched").fetchall()}
    sess = requests.Session()
    sess.headers.update(H)
    d = start
    n_ok = n_miss = 0
    while d <= end:
        if d.weekday() < 6:  # Mon-Sat (NSE has had rare Saturday sessions)
            for kind in kinds:
                if (d, kind) in done:
                    continue
                status, rows = None, 0
                for attempt in range(4):
                    try:
                        r = sess.get(url(kind, d), timeout=60)
                        status = r.status_code
                        break
                    except requests.RequestException:
                        time.sleep(5 * (attempt + 1))
                if status == 200 and r.content[:2] == b"PK":
                    df = parse(kind, d, r.content)
                    rows = len(df)
                    con.register("df", df)
                    con.execute(f"DELETE FROM {'cm_bhav' if kind == 'cm' else 'fo_fut'} WHERE date = ?", [d])
                    con.execute(f"INSERT INTO {'cm_bhav' if kind == 'cm' else 'fo_fut'} SELECT * FROM df")
                    con.unregister("df")
                    n_ok += 1
                elif status in (404, 403) or (status == 200 and r.content[:2] != b"PK"):
                    n_miss += 1
                else:
                    print(d, kind, "giving up for now, status", status, flush=True)
                    time.sleep(SLEEP)
                    continue  # not recorded: retried next run
                con.execute("INSERT OR REPLACE INTO fetched VALUES (?, ?, ?, ?)", [d, kind, status or 0, rows])
                time.sleep(SLEEP)
        if d.day == 1 or d == end:
            print(f"{d}: files {n_ok}, no-file days {n_miss}", flush=True)
        d += timedelta(days=1)
    print("done", n_ok, "files,", n_miss, "no-file days")
    con.close()


if __name__ == "__main__":
    main()
