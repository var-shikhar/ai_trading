# Strategy 001: results (IN PROGRESS, 15 Oct 2026)

Status: the backtester had a lookahead bug (below). It is fixed and the in-sample grid is being re-run. **The out-of-sample run has not been looked at.**

## Lookahead found and fixed (15 Oct 2026)
- `structure.find_swings` keeps the swing list alternating H/L. When two same-kind swings come in a row, it keeps only the more extreme one. That is an ex-post clean-up. **19% of swing highs and 19% of swing lows** on this data are dropped by it, and 94% of the dropped lows were traded through later.
- The v1 features read that cleaned list bar by bar. The trailing stop therefore never "saw" a confirmed swing low that was later undercut, so it held through declines that a real-time trailing stop would have exited. The setup's swing high and L0 were affected the same way.
- **Fix:** `structure.raw_swings` plus rebuilding the alternating sequence as it was known on each bar. The trail moves under every newly confirmed swing low. `test_no_lookahead.py` recomputes the features on data truncated at random bars and requires identical values: 150 of 150 bars matched. `structure.trend_state` (used by the market analysis) got the same fix, with `common/test_structure.py`: 200 of 200 bars matched.
- Also fixed: on the entry bar, a close below the stop after the fill now counts as stopped out.
- **Added:** `t_month`, a t-stat of the mean R per entry month. Trades open at the same time share market moves, so the per-trade t overstates significance.
- **Added:** two random baselines with 50 seeds each. `random_any` takes random liquid stock-days. `random_matched` takes random stock-days that pass the same context filter (momentum ≥ 70th percentile), so it isolates the value of the pullback timing itself.
- The v1 grid is kept as `out/grid_*_v1_lookahead.*` for reference only.

## Parameter selection rule (written before seeing the v2 grid)
1. Entry `stop`: the pullback-failure entry, which is the hypothesis.
2. Exit: the one with the highest median avgR across all stop-entry cells.
3. Within that exit, take the (context, depth set) rows that are positive at **all three** `max_pb_bars` values (3, 5, 8). Choose the row with the highest mean `t_month` across those three.
4. `max_pb_bars` = 5, the middle of the range, unless it is negative there. In that case take the cell with the highest `t_month`.
5. If no row qualifies in step 3, H1 has no robust in-sample region. Record that, and still run the out-of-sample test on the v1 hand-off choice (mom, ≤ 8 bars, depth 0.2–3.0 with break, trail, stop) for completeness.
6. Everything else stays at the defaults (`mom_min` 0.7, `max_bars` 30, `max_risk` 8%, no index filter, `min_room` 0).
