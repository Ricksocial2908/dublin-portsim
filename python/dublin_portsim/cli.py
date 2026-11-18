"""Command-line listing and reference-plan check for Dublin PortSim tasks."""
from __future__ import annotations

import argparse
import json
import sys

from . import load_task, load_tasks
from .check import grade, unavoidable_cost


def main(argv=None):
    p = argparse.ArgumentParser(description="Dublin PortSim tasks")
    p.add_argument("--task", help="task id to show")
    p.add_argument("--list", action="store_true", help="list all tasks")
    p.add_argument("--plan", help="JSON file of a plan list to grade (requires --task)")
    args = p.parse_args(argv)

    if args.list or not args.task:
        for t in load_tasks():
            ref = t.get("reference") or {}
            print(f"{t['task_id']:28} {t['title']:32} ships={len(t['ships']):2}  best={ref.get('best_known_cost')}  naive={ref.get('naive_cost')}")
        if not args.task:
            return 0

    task = load_task(args.task)
    print(task["title"], "·", task["terminal"])
    print(task["blurb"])
    print("ships", len(task["ships"]), "difficulty", task["difficulty"])
    ref = task.get("reference") or {}
    print("naive", ref.get("naive_cost"), "best-known", ref.get("best_known_cost"), "unavoidable", ref.get("unavoidable_cost", unavoidable_cost(task)))
    print("heuristic:", ref.get("heuristic"))
    if args.plan:
        plan = json.loads(open(args.plan).read())
        # Full geometric evaluation lives in the web app; here we only report stored reference plans.
        if plan == ref.get("best_plan"):
            ev = {"rows": [{"placed": True, "conflicts": []} for _ in task["ships"]], "duplicates": [], "feasible": True, "cost": ref.get("best_known_cost")}
            print(grade(task, ev))
        else:
            print("Pass the plan through the web app or a future full Python evaluator; stored best/naive plans can be compared by equality.")
            print("ships in submitted plan:", len(plan))
    return 0


if __name__ == "__main__":
    sys.exit(main())
