/* Heuristic planner: naive re-plan, then local search. Not a proven CP-SAT optimum. */
import { BERTHS, berthForSection } from "./port.js";
import { evaluatePlan, handlingFor, hasCranes, departureAfter, noMoveWindows } from "./model.js";

function allowedBerths(task, ship) {
  const ids = new Set(ship.allowed_berths || []);
  const all = BERTHS.filter((b) => {
    if (task.berth_ids && !task.berth_ids.includes(b.id)) return false;
    if (ids.size && !ids.has(b.id)) return false;
    if (!b.sectional && ship.length_m > b.length + (b.overhang_m ?? 20) + 0.05) return false;
    if (b.sectional && ship.sections > b.n_sections) return false;
    return true;
  });
  return all;
}

function firstFreeHour(task, ship, berth, startHour, cranes, plan) {
  const work = handlingFor(ship, cranes);
  const windows = noMoveWindows(task, ship, berth);
  const inWin = (h) => windows.some(([a, b]) => a <= h && h < b);
  const maxH = (task.horizon || 24 * 10) - work;
  const first = berth.first_section;
  const lastPossible = berth.last_section - ship.sections + 1;
  for (let h = Math.max(startHour, ship.arrival); h <= maxH; h++) {
    if (inWin(h)) continue;
    const finish = h + work;
    const dep = departureAfter(task, ship, finish, berth);
    if (inWin(h)) continue;
    for (let sec = first; sec <= lastPossible; sec++) {
      const trial = plan.concat([{ ship: ship.id, berth_hour: h, section: sec, cranes }]);
      const ev = evaluatePlan(task, trial);
      const row = ev.byId.get(ship.id);
      if (row && row.placed && row.conflicts.length === 0) return { hour: h, section: sec, dep };
    }
  }
  return null;
}

export function naiveReplan(task) {
  const cr = hasCranes(task);
  const ships = [...task.ships].sort((a, b) => {
    const pa = a.planned_hour ?? a.arrival;
    const pb = b.planned_hour ?? b.arrival;
    return pa - pb || a.id - b.id;
  });
  const plan = [];
  const kept = new Set();
  // Keep published slots that still work in isolation, then together
  for (const s of ships) {
    if (s.planned_hour == null || s.planned_section == null) continue;
    const entry = { ship: s.id, berth_hour: s.planned_hour, section: s.planned_section, ...(cr ? { cranes: s.std_cranes } : {}) };
    const ev = evaluatePlan(task, [entry]);
    const row = ev.byId.get(s.id);
    if (row && row.placed && row.conflicts.length === 0) {
      const ev2 = evaluatePlan(task, plan.concat([entry]));
      const r2 = ev2.byId.get(s.id);
      if (r2 && r2.conflicts.length === 0) {
        plan.push(entry);
        kept.add(s.id);
      }
    }
  }
  for (const s of ships) {
    if (kept.has(s.id)) continue;
    const cranes = (cr && s.min_cranes != null) ? s.std_cranes : null;
    const berths = allowedBerths(task, s);
    // Prefer planned berth if any
    const preferred = s.planned_section != null ? berthForSection(s.planned_section) : null;
    const ordered = preferred ? [preferred, ...berths.filter((b) => b.id !== preferred.id)] : berths;
    let best = null;
    for (const berth of ordered) {
      const slot = firstFreeHour(task, s, berth, s.arrival, cranes, plan);
      if (!slot) continue;
      const moved = s.planned_section != null && slot.section !== s.planned_section;
      const delay = Math.max(0, slot.dep - s.due);
      const score = delay * s.sections * (s.weight || 1) + (moved ? 5 : 0) + (best && berth.id !== (preferred && preferred.id) ? 0.1 : 0);
      if (!best || score < best.score) best = { ...slot, berth, score, cranes };
      if (preferred && berth.id === preferred.id && score <= 2) break;
    }
    if (best) plan.push({ ship: s.id, berth_hour: best.hour, section: best.section, ...(cr ? { cranes: best.cranes } : {}) });
  }
  return plan;
}

function randomInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function improvePlan(task, plan, rng, rounds = 80) {
  let current = plan.map((p) => ({ ...p }));
  let ev = evaluatePlan(task, current);
  if (!ev.feasible) return current;
  let best = current;
  let bestCost = ev.cost;
  const cr = hasCranes(task);
  for (let r = 0; r < rounds; r++) {
    const trial = current.map((p) => ({ ...p }));
    const i = Math.floor(rng() * trial.length);
    const entry = trial[i];
    const ship = task.ships.find((s) => s.id === entry.ship);
    if (!ship) continue;
    const kind = rng();
    if (kind < 0.45) {
      entry.berth_hour = Math.max(ship.arrival, entry.berth_hour + randomInt(rng, -8, 8));
    } else if (kind < 0.8) {
      const berths = allowedBerths(task, ship);
      const berth = berths[Math.floor(rng() * berths.length)];
      if (!berth) continue;
      const last = berth.last_section - ship.sections + 1;
      if (last < berth.first_section) continue;
      entry.section = randomInt(rng, berth.first_section, last);
    } else if (cr) {
      entry.cranes = randomInt(rng, ship.min_cranes, ship.max_cranes);
    } else {
      entry.berth_hour = Math.max(ship.arrival, entry.berth_hour + randomInt(rng, -2, 12));
    }
    const evT = evaluatePlan(task, trial);
    if (evT.feasible && evT.cost <= bestCost) {
      current = trial;
      ev = evT;
      if (evT.cost < bestCost) {
        best = trial.map((p) => ({ ...p }));
        bestCost = evT.cost;
      }
    }
  }
  return best;
}

export function solveTask(task, rng) {
  const naive = naiveReplan(task);
  const evN = evaluatePlan(task, naive);
  let best = naive;
  let evB = evN;
  if (evN.feasible) {
    const improved = improvePlan(task, naive, rng, 120);
    const evI = evaluatePlan(task, improved);
    if (evI.feasible && evI.cost < evN.cost) {
      best = improved;
      evB = evI;
    }
  }
  return {
    naive_plan: naive,
    naive_cost: evN.feasible ? evN.cost : null,
    naive_feasible: evN.feasible,
    best_plan: best,
    best_known_cost: evB.feasible ? evB.cost : evN.cost,
    best_feasible: evB.feasible,
  };
}
