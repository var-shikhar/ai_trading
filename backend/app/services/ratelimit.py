import asyncio
import time
from collections import deque


class RateLimiter:
    """Sliding-window limiter enforcing several (max_calls, per_seconds) rules."""

    def __init__(self, *rules: tuple[int, float]):
        self._rules = [(n, window, deque()) for n, window in rules]
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            while True:
                now = time.monotonic()
                wait = 0.0
                for n, window, calls in self._rules:
                    while calls and now - calls[0] >= window:
                        calls.popleft()
                    if len(calls) >= n:
                        wait = max(wait, window - (now - calls[0]))
                if wait <= 0:
                    for _, _, calls in self._rules:
                        calls.append(now)
                    return
                await asyncio.sleep(wait)
