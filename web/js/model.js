/* Plan evaluation and reward, adapted from FineEnvs/PortSimEnv (CC BY-SA 4.0).
   Tidal windows are Dublin-specific and use official depths and UKC. */
import {
  TIDE, UKC, MOVE_PENALTY, CRANE_RATE, BERTHS, BERTH_BY_ID, berthForSection, DAYS, MONTHS,
} from "./port.js";

export { MOVE_PENALTY, DAYS, MONTHS, CRANE_RATE };

export const hasCranes = (task) => !!(task && task.rules && task.rules.crane_pool);

export function tideHeight(hour, rules = {}) {
  const phase = rules.tide_phase ?? TIDE.m2Phase;
  const snPhase = rules.tide_sn_phase ?? TIDE.snPhase;
  const springAmp = (TIDE.mhws - TIDE.mlws) / 2;
  const neapAmp = (TIDE.mhwn - TIDE.mlwn) / 2;
  const sn = 0.5 + 0.5 * Math.cos((2 * Math.PI * hour) / (TIDE.springNeapDays * 24) + snPhase);
  const amp = neapAmp + (springAmp - neapAmp) * sn;
  return TIDE.msl + amp * Math.cos((2 * Math.PI * hour) / TIDE.periodH + phase);
}

export function transitOk(draught, depth, tide) {
  return depth + tide - UKC.manoeuvre >= draught - 1e-9;
}

export function alongsideOk(draught, survey, tide) {
  return survey + tide - UKC.alongside >= draught - 1e-9;
}

/** Hours [start, end) in which this ship may not berth or leave at this berth. */
export function noMoveWindows(task, ship, berth) {
  const out = [];
  const minLen = (w) => ship.length_m >= (w.min_length || 0);
  for (const w of (task.rules && task.rules.no_moves) || []) {
    if (minLen(w)) out.push([w.start, w.end]);
  }
  if (ship.draught_m != null && berth) {
    const horizon = Math.max(task.horizon || 24 * 7 + 48, 24 * 10);
    let blockedStart = null;
    for (let h = 0; h <= horizon; h++) {
      const t = tideHeight(h, task.rules);
      const ok = transitOk(ship.draught_m, berth.channel ?? berth.approach, t)
        && alongsideOk(ship.draught_m, berth.survey, t)
        && transitOk(ship.draught_m, berth.approach, t);
      if (!ok && blockedStart == null) blockedStart = h;
      if (ok && blockedStart != null) {
        out.push([blockedStart, h]);
        blockedStart = null;
      }
    }
    if (blockedStart != null) out.push([blockedStart, horizon + 1]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [a, b] of out) {
    if (merged.length && a <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
    } else merged.push([a, b]);
  }
  return merged;
}

export function departureAfter(task, ship, finish, berth) {
  for (const [a, b] of noMoveWindows(task, ship, berth)) {
    if (a <= finish && finish < b) return b;
  }
  return finish;
}

export function handlingFor(ship, cranes) {
  if (ship.workload == null || cranes == null) return ship.handling;
  return Math.max(1, Math.ceil(ship.workload / cranes));
}

export function cranePoolAt(task, hour) {
  let pool = Number(task.rules.crane_pool);
  for (const o of task.rules.crane_outages || []) {
    if (o.start <= hour && hour < o.end) pool -= Number(o.cranes);
  }
  return pool;
}

export function shipDelayCost(ship, berthHour, delayH) {
  let cost = ship.sections * delayH * (ship.weight || 1);
  if (ship.berth_deadline != null && berthHour > ship.berth_deadline) {
    cost += (ship.deadline_penalty || 0) * (berthHour - ship.berth_deadline);
  }
  return cost;
}

export function publishedPlan(task) {
  const cr = hasCranes(task);
  return task.ships
    .filter((s) => s.planned_hour != null && s.planned_section != null)
    .map((s) => ({
      ship: s.id,
      berth_hour: s.planned_hour,
      section: s.planned_section,
      ...(cr ? { cranes: s.std_cranes } : {}),
    }));
}

const overlap = (a0, a1, b0, b1) => Math.max(a0, b0) < Math.min(a1, b1);
const span = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
const spanTxt = (a, b) => (a === b ? `${a}` : `${a}–${b}`);

function hoursTxt(hs) {
  if (!hs.length) return "";
  const parts = [];
  let a = hs[0], b = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (i < hs.length && hs[i] === b + 1) { b = hs[i]; continue; }
    parts.push(a === b ? `${a}` : `${a}–${b}`);
    if (i < hs.length) { a = b = hs[i]; }
  }
  return parts.join(", ");
}

export function evaluatePlan(task, plan) {
  const cr = hasCranes(task);
  const entries = new Map();
  const duplicates = [];
  for (const p of Array.isArray(plan) ? plan : []) {
    if (!p || typeof p !== "object") continue;
    const id = Number(p.ship);
    if (entries.has(id)) duplicates.push(id);
    else {
      entries.set(id, {
        berth_hour: Number(p.berth_hour),
        section: Number(p.section),
        cranes: p.cranes == null ? null : Number(p.cranes),
      });
    }
  }
  const issues = [];
  const rows = task.ships.map((s) => {
    const e = entries.get(s.id);
    if (!e || !Number.isFinite(e.berth_hour) || !Number.isFinite(e.section)) {
      return { ship: s, id: s.id, placed: false, conflicts: [], cost: null, delay: null, moved: false };
    }
    const h = e.berth_hour;
    const usesCranes = cr && s.min_cranes != null;
    const c = usesCranes ? (e.cranes != null && Number.isFinite(e.cranes) ? e.cranes : s.std_cranes) : null;
    const badCranes = usesCranes && !(s.min_cranes <= c && c <= s.max_cranes);
    const work = handlingFor(s, usesCranes ? (badCranes ? s.std_cranes : c) : null);
    const berth = berthForSection(e.section);
    const finish = h + work;
    const dep = departureAfter(task, s, finish, berth);
    const delay = Math.max(0, dep - s.due);
    const moved = s.planned_section != null && e.section !== s.planned_section;
    return {
      ship: s, id: s.id, placed: true, berth: h, section: e.section,
      last: e.section + s.sections - 1, cranes: c, work, finish, dep,
      hold: dep - finish, delay, moved, wait: Math.max(0, h - s.arrival),
      berthObj: berth,
      cost: shipDelayCost(s, h, delay) + (moved ? MOVE_PENALTY : 0),
      late: s.berth_deadline != null && h > s.berth_deadline,
      usesCranes,
      conflicts: [],
    };
  });
  const add = (r, problem) => {
    issues.push({ ships: [r.id], problem });
    r.conflicts.push(problem);
  };
  const placed = rows.filter((r) => r.placed);
  const allowedSet = (s) => new Set(s.allowed_berths || []);

  for (const r of placed) {
    const s = r.ship;
    const berth = r.berthObj;
    if (!berth) {
      add(r, `section ${r.section} is not a Dublin Port berth in this scenario`);
      continue;
    }
    if (task.berth_ids && !task.berth_ids.includes(berth.id)) {
      add(r, `${berth.name} is not part of this scenario`);
    }
    if (r.last > berth.last_section || r.section < berth.first_section) {
      add(r, `needs sections ${spanTxt(r.section, r.last)} but ${berth.name} only has ${berth.first_section}–${berth.last_section}`);
    }
    const allowed = allowedSet(s);
    if (allowed.size && !allowed.has(berth.id)) {
      add(r, `${s.name} is not accepted at ${berth.name} (${berth.area})`);
    }
    const overhang = berth.overhang_m ?? 20; // assumed allowance; listed lengths are Harbour Master figures
    if (!berth.sectional && s.length_m > berth.length + overhang + 0.05) {
      add(r, `${s.name} is ${s.length_m} m but ${berth.name} is only ${berth.length} m (20 m overhang allowance)`);
    }
    for (const [a, b] of noMoveWindows(task, s, berth)) {
      if (a <= r.berth && r.berth < b) add(r, `docks at hour ${r.berth}, inside a no-movement / tidal window ${a}–${b}`);
    }
    if (r.usesCranes && !(s.min_cranes <= r.cranes && r.cranes <= s.max_cranes)) {
      add(r, `gets ${r.cranes} cranes but can be worked by ${s.min_cranes}–${s.max_cranes}`);
    }
    if (r.berth < s.arrival) add(r, `docks at hour ${r.berth} but cannot arrive before hour ${s.arrival}`);
    if (task.first_section != null && task.last_section != null) {
      if (r.section < task.first_section || r.last > task.last_section) {
        add(r, `needs sections ${spanTxt(r.section, r.last)} but this scenario uses ${task.first_section}–${task.last_section}`);
      }
    }
    for (const b of task.blocks || []) {
      if (r.section <= b.last && b.first <= r.last && r.berth < b.end && b.start < r.dep) {
        const what = b.kind === "alongside" ? `${b.label} (alongside)` : "closed sections";
        add(r, `overlaps ${what} ${spanTxt(b.first, b.last)} during hours ${b.start}–${b.end}`);
      }
    }
  }

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      if (overlap(a.berth, a.dep, b.berth, b.dep) && a.section <= b.last && b.section <= a.last) {
        const [s0, s1] = span(a.section, a.last + 1, b.section, b.last + 1);
        const [h0, h1] = span(a.berth, a.dep, b.berth, b.dep);
        const secs = spanTxt(s0, s1 - 1);
        const problem = `${a.ship.name} and ${b.ship.name} overlap in sections ${secs} during hours ${h0}–${h1}`;
        issues.push({ ships: [a.id, b.id], problem });
        a.conflicts.push(`overlaps ship ${b.id} (${b.ship.name}) in sections ${secs} during hours ${h0}–${h1}`);
        b.conflicts.push(`overlaps ship ${a.id} (${a.ship.name}) in sections ${secs} during hours ${h0}–${h1}`);
      }
    }
  }

  let series = null;
  if (cr) series = craneAndMoveLimits(task, placed, add);

  const missing = rows.filter((r) => !r.placed).map((r) => r.id);
  const delayCost = placed.reduce((acc, r) => acc + shipDelayCost(r.ship, r.berth, r.delay), 0);
  const moves = placed.filter((r) => r.moved).length;
  return {
    rows,
    byId: new Map(rows.map((r) => [r.id, r])),
    issues,
    missing,
    duplicates,
    delayCost,
    moves,
    cost: delayCost + MOVE_PENALTY * moves,
    feasible: issues.length === 0 && missing.length === 0,
    series,
  };
}

function craneAndMoveLimits(task, placed, add) {
  const use = new Map();
  const moves = new Map();
  const fixed = new Map();
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const b of task.blocks || []) {
    if (b.kind !== "alongside") continue;
    for (let t = b.start; t < b.end; t++) bump(use, t, b.cranes || 0);
    bump(fixed, b.end, 1);
  }
  for (const r of placed) {
    for (let t = r.berth; t < r.finish; t++) bump(use, t, r.cranes || 0);
    if (!moves.has(r.berth)) moves.set(r.berth, []);
    moves.get(r.berth).push(r);
    if (!moves.has(r.dep)) moves.set(r.dep, []);
    moves.get(r.dep).push(r);
  }
  const over = new Set([...use].filter(([t, u]) => u > cranePoolAt(task, t)).map(([t]) => t));
  if (over.size) {
    for (const r of placed) {
      const hs = [];
      for (let t = r.berth; t < r.finish; t++) if (over.has(t)) hs.push(t);
      if (!hs.length) continue;
      const worst = hs.reduce((a, t) => (use.get(t) - cranePoolAt(task, t) > use.get(a) - cranePoolAt(task, a) ? t : a), hs[0]);
      add(r, `cranes over the pool at hours ${hoursTxt(hs)} (e.g. hour ${worst}: ${use.get(worst)} in use, ${cranePoolAt(task, worst)} available)`);
    }
  }
  const cap = task.rules && task.rules.max_moves_per_hour;
  const moveCount = new Map();
  for (const t of new Set([...moves.keys(), ...fixed.keys()])) {
    moveCount.set(t, (moves.get(t) || []).length + (fixed.get(t) || 0));
  }
  if (cap) {
    for (const [t, rs] of [...moves].sort((a, b) => a[0] - b[0])) {
      const n = moveCount.get(t);
      if (n > cap) {
        for (const r of rs) add(r, `${r.berth === t ? "docks" : "leaves"} at hour ${t}, when ${n} ships move (limit ${cap} per hour)`);
      }
    }
  }
  return { use, moves: moveCount, cap: cap || null, over };
}

export function unavoidableCost(task) {
  let c = 0;
  for (const s of task.ships) {
    const delay = Math.max(0, s.arrival + s.handling - s.due);
    c += shipDelayCost(s, s.arrival, delay);
  }
  return c;
}

export function grade(task, ev) {
  const ref = task.reference || {};
  const optimum = Number(ref.optimal_cost ?? ref.best_known_cost ?? 0);
  const unavoidable = Number(ref.unavoidable_cost ?? unavoidableCost(task));
  const gapK = Number((task.rules && task.rules.gap_k) || 100);
  const clean = ev.rows.filter((r) => r.placed && r.conflicts.length === 0).length / Math.max(1, ev.rows.length + ev.duplicates.length);
  if (!ev.feasible) {
    return { reward: 0.2 * clean, quality: 0, clean, cost: ev.cost, feasible: false, optimum, unavoidable };
  }
  const g = Math.max(0, ev.cost - optimum) / (Math.max(0, optimum - unavoidable) + gapK);
  const quality = Math.exp(-g / 0.5);
  return { reward: 0.2 + 0.8 * quality, quality, clean, cost: ev.cost, feasible: true, optimum, unavoidable };
}

export function clockAt(task, hour) {
  const start = Date.parse(task.week_start_iso || task.week_start_utc);
  if (!Number.isFinite(start)) {
    const day = DAYS[((Math.floor(hour / 24) % 7) + 7) % 7];
    const h = ((hour % 24) + 24) % 24;
    return `${day} ${String(Math.floor(h)).padStart(2, "0")}:00`;
  }
  const d = new Date(start + hour * 3600 * 1000);
  return `${DAYS[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export function fmtHour(task, h) {
  if (h == null || Number.isNaN(h)) return "–";
  return clockAt(task, h);
}

export function horizonOf(task, plans = []) {
  let h = 24 * 7;
  for (const s of task.ships) h = Math.max(h, s.arrival, s.due, (s.arrival || 0) + (s.handling || 0) + 12);
  for (const b of task.blocks || []) h = Math.max(h, b.end);
  for (const w of (task.rules && task.rules.no_moves) || []) h = Math.max(h, w.end);
  for (const o of (task.rules && task.rules.crane_outages) || []) h = Math.max(h, o.end);
  const cr = hasCranes(task);
  for (const plan of plans) {
    if (!Array.isArray(plan)) continue;
    for (const p of plan) {
      const s = task.ships.find((x) => x.id === Number(p.ship));
      if (!s) continue;
      const berth = berthForSection(Number(p.section));
      const finish = Number(p.berth_hour) + handlingFor(s, cr ? (p.cranes != null ? Number(p.cranes) : s.std_cranes) : null);
      h = Math.max(h, departureAfter(task, s, finish, berth));
    }
  }
  return h;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
