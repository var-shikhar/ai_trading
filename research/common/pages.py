"""Print extracted book text for a page range: pages.py 86 100"""

import re
import sys
from pathlib import Path

text = (Path(__file__).resolve().parents[1] / "data" / "ytc.txt").read_text(encoding="utf-8")
a, b = int(sys.argv[1]), int(sys.argv[2])
for m in re.finditer(r"===== PAGE (\d+) =====\n(.*?)(?======|\Z)", text, re.S):
    n = int(m.group(1))
    if a <= n <= b:
        body = "\n".join(
            ln for ln in m.group(2).splitlines()
            if "ForexWinners" not in ln and "Copyright" not in ln and "YourTradingCoach.com" not in ln
        )
        body = re.sub(r"[ \t]+", " ", body)
        sys.stdout.buffer.write(f"--- p{n} ---\n{body}\n".encode("utf-8"))
