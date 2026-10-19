"""Extract a reference PDF to research/data/<name>.txt (git-ignored), one
"===== PAGE n =====" block per PDF page, for pages.py. The books are
copyrighted: the text stays local; notes paraphrase with page refs.

    research/.venv/Scripts/python.exe research/common/extract_pdf.py <pdf> <name>
"""

import sys
from pathlib import Path

from pypdf import PdfReader

pdf, name = Path(sys.argv[1]), sys.argv[2]
out = Path(__file__).resolve().parents[1] / "data" / f"{name}.txt"
reader = PdfReader(str(pdf))
with out.open("w", encoding="utf-8") as f:
    for i, page in enumerate(reader.pages, 1):
        f.write(f"===== PAGE {i} =====\n{page.extract_text() or ''}\n")
print(f"{len(reader.pages)} pages -> {out}")
