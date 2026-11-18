"""Evaluate and grade a plan. Mirrors web/js/model.js (CC BY-SA 4.0, adapted from PortSimEnv)."""
from __future__ import annotations

import math
from typing import Any

MOVE_PENALTY = 5
TIDE = dict(hat=4.50, mhws=4.10, mhwn=3.40, msl=2.41, mlwn=1.50, mlws=0.70, lat=-0.10, period_h=12.42, sn_days=14.77)
UKC = dict(manoeuvre=1.0, alongside=0.5)


def tide_height(hour: float, rules: dict | None = None) -> float:
    rules = rules or {}
    phase = rules.get("tide_phase", 0)
    sn_phase = rules.get("tide_sn_phase", 0)
    spring_amp = (TIDE["mhws"] - TIDE["mlws"]) / 2
    neap_amp = (TIDE["mhwn"] - TIDE["mlwn"]) / 2
    sn = 0.5 + 0.5 * math.cos(2 * math.pi * hour / (TIDE["sn_days"] * 24) + sn_phase)
    amp = neap_amp + (spring_amp - neap_amp) * sn
    return TIDE["msl"] + amp * math.cos(2 * math.pi * hour / TIDE["period_h"] + phase)


def handling_for(ship: dict, cranes: int | None) -> int:
    if ship.get("workload") is None or cranes is None:
        return int(ship["handling"])
    return max(1, math.ceil(ship["workload"] / cranes))


def ship_delay_cost(ship: dict, berth_hour: int, delay_h: int) -> int:
    cost = ship["sections"] * delay_h * ship.get("weight", 1)
    deadline = ship.get("berth_deadline")
    if deadline is not None and berth_hour > deadline:
        cost += ship.get("deadline_penalty", 0) * (berth_hour - deadline)
    return cost


def unavoidable_cost(task: dict) -> int:
    total = 0
    for s in task["ships"]:
        delay = max(0, s["arrival"] + s["handling"] - s["due"])
        total += ship_delay_cost(s, s["arrival"], delay)
    return total


def grade(task: dict, ev: dict) -> dict:
    ref = task.get("reference") or {}
    optimum = ref.get("optimal_cost", ref.get("best_known_cost") or 0) or 0
    unavoidable = ref.get("unavoidable_cost", unavoidable_cost(task))
    gap_k = (task.get("rules") or {}).get("gap_k", 100)
    clean = sum(1 for r in ev["rows"] if r["placed"] and not r["conflicts"]) / max(1, len(ev["rows"]) + len(ev.get("duplicates") or []))
    if not ev["feasible"]:
        return {"reward": 0.2 * clean, "quality": 0.0, "clean": clean, "cost": ev["cost"], "feasible": False, "optimum": optimum, "unavoidable": unavoidable}
    g = max(0, ev["cost"] - optimum) / (max(0, optimum - unavoidable) + gap_k)
    quality = math.exp(-g / 0.5)
    return {"reward": 0.2 + 0.8 * quality, "quality": quality, "clean": clean, "cost": ev["cost"], "feasible": True, "optimum": optimum, "unavoidable": unavoidable}
