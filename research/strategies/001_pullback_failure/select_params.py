"""Apply the pre-registered selection rule (results.md) to the in-sample grid
and write chosen_params.json. In-sample data only."""

import json
from dataclasses import asdict
from pathlib import Path

import pandas as pd

from backtest import Params

HERE = Path(__file__).resolve().parent
g = pd.read_csv(HERE / "out" / "grid_in_sample.csv")
g = g[g.entry == "stop"]  # 1. the hypothesis' entry

med = g.groupby("exit").is_avgR.median()
print("median avgR by exit (stop entry):", med.round(3).to_dict())
ex = med.idxmax()  # 2.
e = g[g.exit == ex]

key = ["context", "depth_min", "depth_max", "allow_break"]
rows = e.groupby(key).agg(min_avgR=("is_avgR", "min"), mean_tm=("is_t_month", "mean"), n5=("is_n", "median"),
                          cells=("is_avgR", "size")).reset_index()
print(rows.sort_values("mean_tm", ascending=False).round(3).to_string(index=False))
ok = rows[(rows.cells == 3) & (rows.min_avgR > 0)]  # 3. positive at all three max_pb_bars
if ok.empty:
    print("NO ROBUST REGION: falling back to the v1 hand-off choice (rule 5)")
    p = Params(context="mom", max_pb_bars=8, depth_min=0.2, depth_max=3.0, allow_break=True, exit="trail", entry="stop")
else:
    best = ok.sort_values("mean_tm", ascending=False).iloc[0]
    cells = e[(e[key] == best[key].to_numpy()).all(axis=1)]
    five = cells[cells.max_pb_bars == 5]
    pick = five.iloc[0] if len(five) and five.is_avgR.iloc[0] > 0 else cells.sort_values("is_t_month").iloc[-1]  # 4.
    p = Params(context=pick.context, max_pb_bars=int(pick.max_pb_bars), depth_min=float(pick.depth_min),
               depth_max=float(pick.depth_max), allow_break=bool(pick.allow_break), exit=ex, entry="stop")
    print("chosen cell:", pick[["is_n", "is_avgR", "is_win%", "is_t_stat", "is_t_month"]].to_dict())
(HERE / "chosen_params.json").write_text(json.dumps(asdict(p), indent=2) + "\n")
print(json.dumps(asdict(p)))
