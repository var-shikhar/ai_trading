"""Fetch NSE reference data into research/data/nse_ref.duckdb (open, no login):

- corp_actions: NSE's corporate-actions list (equities), one request per
  year 2005 -> now. Raw rows as published: symbol, subject, exDate, ...
- symbol_changes: NSE's symbolchange.csv (old symbol -> new symbol, date).

    research/.venv/Scripts/python.exe research/common/fetch_nse_ref.py

A separate DB from nse_bhav.duckdb so it can run while the bhavcopy
fetcher is writing. ~25 requests in total, spaced out.
"""

import io
import time
from datetime import date
from pathlib import Path

import duckdb
import pandas as pd
import requests

DB = Path(__file__).resolve().parents[1] / "data" / "nse_ref.duckdb"
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json, text/plain, */*",
     "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-actions"}
COLS = ["symbol", "series", "subject", "exDate", "recDate", "faceVal", "isin", "comp"]


def main() -> None:
    s = requests.Session()
    s.headers.update(H)
    s.get("https://www.nseindia.com/", timeout=30)  # cookies required by the API
    frames = []
    for y in range(2005, date.today().year + 1):
        for attempt in range(4):
            r = s.get("https://www.nseindia.com/api/corporates-corporateActions",
                      params={"index": "equities", "from_date": f"01-01-{y}", "to_date": f"31-12-{y}"}, timeout=90)
            if r.ok and r.text.lstrip().startswith("["):
                df = pd.DataFrame(r.json())
                break
            time.sleep(5 * (attempt + 1))
            s.get("https://www.nseindia.com/", timeout=30)  # refresh cookies
        else:
            raise SystemExit(f"{y}: corporate actions not available (HTTP {r.status_code}); re-run later")
        df = df.reindex(columns=COLS)
        df["year_requested"] = y
        frames.append(df)
        print(y, len(df), "rows", flush=True)
        time.sleep(2)
    ca = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["symbol", "subject", "exDate"])
    ca["ex_date"] = pd.to_datetime(ca["exDate"], format="%d-%b-%Y", errors="coerce").dt.date
    r = s.get("https://nsearchives.nseindia.com/content/equities/symbolchange.csv", timeout=60)
    r.raise_for_status()
    sc = pd.read_csv(io.BytesIO(r.content), encoding="latin-1")
    sc.columns = ["company", "old_symbol", "new_symbol", "effective"]
    sc["effective"] = pd.to_datetime(sc["effective"].str.strip(), format="%d-%b-%Y", errors="coerce").dt.date
    for c in ("old_symbol", "new_symbol"):
        sc[c] = sc[c].astype(str).str.strip()
    con = duckdb.connect(str(DB))
    for name, df in (("corp_actions", ca), ("symbol_changes", sc)):
        con.register("df", df)
        con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM df")
        con.unregister("df")
        print(name, con.execute(f"SELECT count(*) FROM {name}").fetchone()[0], "rows")
    con.close()


if __name__ == "__main__":
    main()
