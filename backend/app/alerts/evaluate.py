"""Pure alert rules (no I/O), so they can be tested exactly.

Price-type alerts are checked on every tick against the previous tick:
  crosses_above  prev < level <= price
  crosses_below  prev > level >= price
  crosses        either direction
  above / below  price is beyond the level (fires on the first tick that is)
  change_up / change_down  day change % from previous close reaches `value`
Drawing alerts turn a horizontal line into a level, and a trend line into a
level that moves with time (the line extended to the right).
"""

from dataclasses import dataclass

DAY = 86400
TF_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240}


@dataclass
class PriceRule:
    op: str  # crosses_above | crosses_below | crosses | above | below | change_up | change_down
    value: float  # price level, or % for change_*


def line_level(points: list[dict], time: int) -> float | None:
    """Price of a drawing at `time`: horizontal lines are flat; trend lines
    are extended through their two points."""
    if len(points) == 1:
        return float(points[0]["price"])
    a, b = points[0], points[1]
    if a["time"] == b["time"]:
        return None
    slope = (b["price"] - a["price"]) / (b["time"] - a["time"])
    return a["price"] + slope * (time - a["time"])


def check_price(rule: PriceRule, prev: float | None, price: float, level: float | None = None,
                prev_level: float | None = None, chp: float | None = None) -> bool:
    level = rule.value if level is None else level
    prev_level = level if prev_level is None else prev_level
    op = rule.op
    if op == "change_up":
        return chp is not None and chp >= rule.value
    if op == "change_down":
        return chp is not None and chp <= -rule.value
    if op == "above":
        return price > level
    if op == "below":
        return price < level
    if prev is None:
        return False  # crossing needs a previous price
    up = prev < prev_level and price >= level
    down = prev > prev_level and price <= level
    if op == "crosses_above":
        return up
    if op == "crosses_below":
        return down
    return up or down  # crosses


def bar_start(time: int, tf: str, session_start: str) -> int:
    """Start of the bar containing `time` (IST wall time as epoch), matching
    the candle service's bucketing."""
    day = time - time % DAY
    m = TF_MINUTES.get(tf)
    if m:
        h, mi = (int(x) for x in session_start.split(":"))
        origin = day + h * 3600 + mi * 60
        if time < origin:
            return origin - m * 60  # pre-open belongs to no bar today
        return origin + (time - origin) // (m * 60) * m * 60
    return day


def last_closed_bar(now: int, tf: str, session_start: str, session_end: str) -> int:
    """Open time of the newest bar that has fully closed at `now`.

    A daily bar closes at the session end; intraday bars when the next
    bucket starts, or at the session end for the last one of the day."""
    day = now - now % DAY
    eh, em = (int(x) for x in session_end.split(":"))
    end_today = day + eh * 3600 + em * 60
    if tf not in TF_MINUTES:
        return day if now >= end_today else day - DAY
    m = TF_MINUTES[tf] * 60
    if now >= end_today:
        return bar_start(end_today - 1, tf, session_start)
    current = bar_start(now, tf, session_start)
    return current - m


def should_fire(frequency: str, last_fired: int | None, now: int, bar_time: int | None, last_bar: int | None) -> bool:
    """once: never again after firing; once_per_bar: once per bar;
    every: at most once a minute (so a level hovering doesn't spam)."""
    if last_fired is None:
        return True
    if frequency == "once":
        return False
    if frequency == "once_per_bar":
        return bar_time is not None and bar_time != last_bar
    return now - last_fired >= 60
