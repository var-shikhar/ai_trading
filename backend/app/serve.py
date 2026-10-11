"""Start the backend with HOST/PORT from backend/.env.

    python -m app.serve          # production: one process, no auto-reload
    python -m app.serve --dev    # development: reload on code changes

Always a single process: the DuckDB file, the live price socket and the
alert engine must not run twice, so there is no --workers option.
"""

import sys

import uvicorn

from app.config import get_settings


def main(argv: list[str]) -> None:
    dev = "--dev" in argv
    s = get_settings()
    uvicorn.run(
        "app.main:app",
        host=s.host,
        port=s.port,
        reload=dev,
        # Behind Caddy/Nginx: trust X-Forwarded-* from the proxy on this machine.
        proxy_headers=s.trust_proxy,
        forwarded_allow_ips="127.0.0.1" if s.trust_proxy else None,
        log_level="info",
    )


if __name__ == "__main__":
    main(sys.argv[1:])
