"""Probe NSE's public corporate-actions API and symbol-change file
(a handful of requests). Prints what they return; stores nothing."""

import io

import pandas as pd
import requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "application/json, text/plain, */*",
     "Accept-Language": "en-US,en;q=0.9", "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-actions"}
s = requests.Session()
s.headers.update(H)
r = s.get("https://www.nseindia.com/", timeout=30)  # sets the cookies the API requires
print("home:", r.status_code, "cookies:", list(s.cookies.keys()))
for frm, to in (("01-01-2005", "31-12-2005"), ("01-01-2014", "31-12-2014"), ("01-01-2025", "31-12-2025")):
    r = s.get("https://www.nseindia.com/api/corporates-corporateActions",
              params={"index": "equities", "from_date": frm, "to_date": to}, timeout=60)
    try:
        js = r.json()
        df = pd.DataFrame(js)
        print(f"{frm}..{to}: HTTP {r.status_code}, {len(df)} rows, cols {list(df.columns)[:12]}")
        if len(df):
            sub = df[df["subject"].str.contains("split|bonus", case=False, na=False)]
            print("   split/bonus rows:", len(sub))
            print(sub[["symbol", "subject", "exDate"]].head(4).to_string(index=False))
    except ValueError:
        print(f"{frm}..{to}: HTTP {r.status_code}, not JSON: {r.text[:120]!r}")
for u in ("https://nsearchives.nseindia.com/content/equities/symbolchange.csv",
          "https://archives.nseindia.com/content/equities/symbolchange.csv"):
    r = s.get(u, timeout=60)
    print(u.split("/")[2], "symbolchange:", r.status_code, len(r.content))
    if r.ok:
        sc = pd.read_csv(io.BytesIO(r.content), encoding="latin-1")
        print(sc.shape, list(sc.columns))
        print(sc.tail(5).to_string(index=False))
        break
