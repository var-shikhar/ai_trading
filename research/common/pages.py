"""Print extracted book text for a PDF page range.

    pages.py 86 100              # YTC Price Action Trader (data/ytc.txt)
    pages.py 10 25 scalper       # data/scalper.txt (YTC Scalper)
    pages.py 1 40 blogs          # data/blogs.txt (YTC blog collection)

Page numbers are PDF pages (the "===== PAGE n =====" markers written by
extract_pdf.py). Footers, copyright lines and the purchaser stamp embedded
in the PDFs are dropped: never copy personal details into notes.
"""

import re
import sys
from pathlib import Path

DROP = ("ForexWinners", "Copyright", "YourTradingCoach.com", "Purchased by", "@")

a, b = int(sys.argv[1]), int(sys.argv[2])
name = sys.argv[3] if len(sys.argv) > 3 else "ytc"
text = (Path(__file__).resolve().parents[1] / "data" / f"{name}.txt").read_text(encoding="utf-8")
for m in re.finditer(r"===== PAGE (\d+) =====\n(.*?)(?======|\Z)", text, re.S):
    n = int(m.group(1))
    if a <= n <= b:
        body = "\n".join(ln for ln in m.group(2).splitlines() if not any(d in ln for d in DROP))
        body = re.sub(r"[ \t]+", " ", body)
        sys.stdout.buffer.write(f"--- p{n} ---\n{body}\n".encode("utf-8"))
