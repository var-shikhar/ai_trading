"""Is NSE blocking us, or is 403 just its answer for a missing weekend file?"""

from datetime import date

import requests

import fetch_nse_bhav as f

s = requests.Session()
s.headers.update(f.H)
for label, d in (("known trading day", date(2006, 7, 14)), ("known Saturday, no file", date(2006, 7, 15)),
                 ("Sunday, no session", date(2006, 7, 16)), ("Sunday session", date(2006, 6, 25)),
                 ("Budget Sunday 2026", date(2026, 2, 1)), ("recent trading day", date(2026, 10, 16))):
    r = s.get(f.url("cm", d), timeout=60)
    print(f"{label:24s} {d}: HTTP {r.status_code}, zip={r.content[:2] == b'PK'}, {len(r.content)} bytes")
