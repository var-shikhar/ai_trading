"""Probe open data sources for NSE: Yahoo intraday depth, and NSE's own
daily bhavcopy archive. Prints what each returns; stores nothing."""

import io
import zipfile

import requests
import yfinance as yf

for interval, period in (("60m", "730d"), ("15m", "60d"), ("5m", "60d")):
    df = yf.download("RELIANCE.NS", interval=interval, period=period, progress=False, auto_adjust=False)
    if len(df):
        print(f"yahoo {interval}: {len(df)} bars, {df.index[0]} .. {df.index[-1]}")
    else:
        print(f"yahoo {interval}: nothing")

H = {"User-Agent": "Mozilla/5.0", "Accept": "*/*"}
tests = {
    # new-format CM bhavcopy (UDiFF, from Jul 2024) and old format (to Jul 2024)
    "bhav_udiff_2026": "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261015_F_0000.csv.zip",
    "bhav_old_2010": "https://nsearchives.nseindia.com/content/historical/EQUITIES/2010/JAN/cm04JAN2010bhav.csv.zip",
    "bhav_old_2005": "https://nsearchives.nseindia.com/content/historical/EQUITIES/2005/JAN/cm03JAN2005bhav.csv.zip",
    "fo_bhav_old_2015": "https://nsearchives.nseindia.com/content/historical/DERIVATIVES/2015/JAN/fo01JAN2015bhav.csv.zip",
}
for name, url in tests.items():
    try:
        r = requests.get(url, headers=H, timeout=30)
        info = f"HTTP {r.status_code}, {len(r.content)} bytes"
        if r.ok and r.content[:2] == b"PK":
            z = zipfile.ZipFile(io.BytesIO(r.content))
            first = z.read(z.namelist()[0]).decode("utf-8", "replace").splitlines()
            info += f", {len(first) - 1} rows; header: {first[0][:160]}"
        print(name, info)
    except Exception as e:  # noqa: BLE001
        print(name, "error", type(e).__name__, e)
