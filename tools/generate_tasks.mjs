import { writeFileSync, mkdirSync } from "node:fs";
import { BERTH_BY_ID, sectionsNeeded, SECTION_M, CRANE_RATE } from "../web/js/port.js";
import { evaluatePlan, unavoidableCost, mulberry32 } from "../web/js/model.js";
import { solveTask } from "../web/js/solver.js";

function craneClass(length) {
  if (length < 140) return [1, 2, 1];
  if (length < 200) return [1, 3, 2];
  return [2, 3, 2];
}

function shipBase(id, name, kind, length, draught, from, to, extra = {}) {
  return { id, name, kind, length_m: length, draught_m: draught, from_port: from, to_port: to, weight: 1, imo: "", ...extra };
}

function finalizeShip(s, berth, hour, handling, due, { workload, cranes } = {}) {
  const sections = sectionsNeeded(s.length_m, berth);
  const row = {
    ...s,
    sections,
    arrival: hour,
    handling,
    planned_hour: hour,
    planned_section: berth.first_section,
    due: due ?? hour + handling,
    allowed_berths: s.allowed_berths,
  };
  if (workload != null) {
    const [minC, maxC, stdC] = cranes || craneClass(s.length_m);
    row.workload = workload;
    row.min_cranes = minC;
    row.max_cranes = maxC;
    row.std_cranes = stdC;
    row.handling = Math.max(1, Math.ceil(workload / stdC));
    row.due = due ?? hour + row.handling;
  }
  return row;
}

function makeTask(t) {
  t.horizon = 24 * 8;
  t.rules = t.rules || {};
  t.reference = {};
  return t;
}

function dftBusy() {
  const rng = mulberry32(1201);
  const b50a = BERTH_BY_ID.b50a;
  const b50n = BERTH_BY_ID.b50n;
  const allowed = ["b50a", "b50n"];
  const feeders = [
    ["Liffey Feeder", 168, 8.4, "Rotterdam", "Dublin"],
    ["Tolka Trader", 152, 7.9, "Antwerp", "Dublin"],
    ["Poolbeg Express", 189, 8.6, "Liverpool", "Dublin"],
    ["Howth Carrier", 147, 7.5, "Greenock", "Dublin"],
    ["Avoca Box", 172, 8.2, "Zeebrugge", "Dublin"],
    ["Dodder Bridge", 210, 8.9, "Rotterdam", "Dublin"],
    ["Clontarf Sound", 140, 7.2, "Bristol", "Dublin"],
    ["Kippure Wave", 195, 8.5, "Le Havre", "Dublin"],
    ["Dalkey Reach", 160, 8.0, "Southampton", "Dublin"],
    ["Malahide Box", 178, 8.3, "Antwerp", "Dublin"],
    ["Iveagh Trailer", 154, 7.8, "Liverpool", "Dublin"],
    ["Santry Cut", 201, 8.7, "Rotterdam", "Dublin"],
  ];
  const ships = [];
  let tA = 4, tN = 2;
  feeders.forEach((f, i) => {
    const [name, loa, d, from, to] = f;
    let berth = i % 3 === 0 ? b50a : b50n;
    const [minC, maxC, stdC] = craneClass(loa);
    const workload = 6 + Math.floor(rng() * 10) + (loa > 180 ? 6 : 0);
    const handling = Math.max(1, Math.ceil(workload / stdC));
    if (sectionsNeeded(loa, berth) > berth.n_sections) berth = b50n;
    const hour = berth === b50a ? tA : tN;
    const s = finalizeShip(shipBase(i, name, "container", loa, d, from, to, { allowed_berths: allowed }), berth, hour, handling, hour + handling, { workload, cranes: [minC, maxC, stdC] });
    ships.push(s);
    if (berth === b50a) tA = s.due + 2 + Math.floor(rng() * 4);
    else tN = s.due + 2 + Math.floor(rng() * 3);
  });

  const disruptions = [];
  const notices = [];
  const late1 = ships[3];
  late1.arrival = late1.planned_hour + 9;
  disruptions.push({ type: "late", ship: late1.id, hours: 9 });
  notices.push(`Ship ${late1.id} ${late1.name} was delayed leaving ${late1.from_port}: it now arrives at hour ${late1.arrival} (planned berthing hour ${late1.planned_hour}). Its planned departure stays hour ${late1.due}.`);

  const late2 = ships[7];
  late2.arrival = late2.planned_hour + 6;
  disruptions.push({ type: "late", ship: late2.id, hours: 6 });
  notices.push(`Ship ${late2.id} ${late2.name} was delayed leaving ${late2.from_port}: it now arrives at hour ${late2.arrival} (planned berthing hour ${late2.planned_hour}). Its planned departure stays hour ${late2.due}.`);

  const extra = finalizeShip(shipBase(ships.length, "Carmelite Box", "container", 155, 7.6, "Belfast", "Dublin", { allowed_berths: allowed }), b50n, 40, 8, 58, { workload: 14, cranes: craneClass(155) });
  extra.planned_hour = null;
  extra.planned_section = null;
  ships.push(extra);
  disruptions.push({ type: "extra", ship: extra.id });
  notices.push(`Unscheduled call: ship ${extra.id} ${extra.name} (${extra.length_m} m, ${extra.sections} sections) arrives at hour ${extra.arrival}, needs ${extra.handling} hours alongside at standard cranes and asks to sail by hour ${extra.due}. It has no planned berth, so placing it anywhere allowed costs no move penalty.`);

  const outage = { type: "crane_outage", start: 52, end: 68, cranes: 1, reason: "spreader change-out on one DFT gantry" };
  disruptions.push(outage);
  notices.push(`One of DFT's three Liebherr gantry cranes is out from hour ${outage.start} to hour ${outage.end} (${outage.reason}). The crane pool is 2 during that window.`);

  const closure = { type: "closure", first: b50a.first_section, last: b50a.last_section, start: 96, end: 120, reason: "fender repair on berth 50A" };
  disruptions.push(closure);
  notices.push(`Berth 50A (sections ${b50a.first_section}–${b50a.last_section}) is closed from hour ${closure.start} to hour ${closure.end} (${closure.reason}).`);
  const blocks = [{ first: closure.first, last: closure.last, start: closure.start, end: closure.end, kind: "closed", label: "50A fender repair" }];

  return makeTask({
    task_id: "dub-dft-w12-busy-0", split: "play", quay: "50A/50N",
    terminal: "Dublin Ferryport Terminals (DFT)", title: "DFT container week",
    blurb: "Eleven scheduled feeders plus an unscheduled call at DFT. Three Liebherr gantries, one out for a spreader change, and a mid-week closure of berth 50A.",
    week: 12, week_start_iso: "2026-03-16T00:00:00Z", difficulty: "busy",
    berth_ids: ["b50a", "b50n"], first_section: b50a.first_section, last_section: b50n.last_section, section_m: SECTION_M,
    ships, blocks, notices, disruptions,
    rules: { crane_pool: 3, crane_rate: CRANE_RATE, crane_outages: [{ start: 52, end: 68, cranes: 1 }], max_moves_per_hour: 2, reward: 3, gap_k: 100, tide_phase: 0, tide_sn_phase: 0.4 },
  });
}

function addFerry(ships, name, bid, loa, draught, hour, from, to, op, handling) {
  const berth = BERTH_BY_ID[bid];
  const allowed = op === "Irish Ferries" ? ["b49", "b51a"] : op === "Stena Line" ? ["b51"] : op === "freight" ? ["b26", "b27", "b52"] : ["b26", "b27"];
  const s = finalizeShip(shipBase(ships.length, name, "roro", loa, draught, from, to, { allowed_berths: allowed, operator: op }), berth, hour, handling, hour + handling);
  s.display_name = `${name} (h${hour})`;
  ships.push(s);
  return s;
}

function ferriesHard() {
  const ships = [];
  const U = ["Ulysses", "b49", 209, 6.4, "Irish Ferries", 2];
  const W = ["W.B. Yeats", "b51a", 194.8, 6.7, "Irish Ferries", 2];
  const E = ["Stena Estrid", "b51", 215, 6.5, "Stena Line", 2];
  const A = ["Stena Adventurer", "b51", 210.8, 6.3, "Stena Line", 2];
  const M = ["Mersey Trail", "b26", 195, 6.4, "Liverpool RoRo", 6];
  const I = ["Irish Sea Freight", "b27", 195, 6.4, "Liverpool RoRo", 6];
  for (const h of [5, 17, 29, 41, 53, 65, 77, 89, 101, 113, 125, 137]) addFerry(ships, U[0], U[1], U[2], U[3], h, "Holyhead", "Dublin", U[4], U[5]);
  addFerry(ships, W[0], W[1], W[2], W[3], 8, "Holyhead", "Dublin", W[4], W[5]);
  addFerry(ships, W[0], W[1], W[2], W[3], 32, "Cherbourg", "Dublin", W[4], W[5]);
  addFerry(ships, W[0], W[1], W[2], W[3], 80, "Cherbourg", "Dublin", W[4], W[5]);
  addFerry(ships, W[0], W[1], W[2], W[3], 128, "Holyhead", "Dublin", W[4], W[5]);
  for (const h of [6, 18, 30, 42, 54, 66, 78, 90, 102, 114, 126, 138]) addFerry(ships, E[0], E[1], E[2], E[3], h, "Holyhead", "Dublin", E[4], E[5]);
  for (const h of [12, 36, 60, 84, 108, 132]) addFerry(ships, A[0], A[1], A[2], A[3], h, "Holyhead", "Dublin", A[4], A[5]);
  for (const h of [7, 31, 55, 79, 103, 127]) addFerry(ships, M[0], M[1], M[2], M[3], h, "Liverpool", "Dublin", M[4], M[5]);
  for (const h of [19, 67, 115]) addFerry(ships, I[0], I[1], I[2], I[3], h, "Liverpool", "Dublin", I[4], I[5]);

  const disruptions = [];
  const notices = [
    "Ferry slot times in this scenario are illustrative, not an official timetable.",
    "Irish Ferries may use berths 49 and 51A; Stena Line is planned on berth 51; the Alexandra Basin jetty (26 and 27) handles the Dublin–Liverpool RoRo service.",
  ];
  const late = ships.find((s) => s.name === "Ulysses" && s.planned_hour === 41);
  late.arrival = late.planned_hour + 5;
  disruptions.push({ type: "late", ship: late.id, hours: 5 });
  notices.push(`Ship ${late.id} ${late.display_name} was delayed leaving Holyhead: it now arrives at hour ${late.arrival} (planned berthing hour ${late.planned_hour}). Its planned departure stays hour ${late.due}. The next Ulysses call still wants berth 49 at hour 53.`);

  disruptions.push({ type: "gale", start: 70, end: 78, min_length: 180, reason: "southerly gale, no large-ship movements in the Liffey channel" });
  notices.push("Gale notice: ships of 180 m and over may not berth or leave between hour 70 and hour 78 (southerly gale on the Liffey channel). A ship that finishes cargo inside the window waits alongside until it ends.");

  const extra = finalizeShip(shipBase(ships.length, "Cairnryan Freight", "roro", 186, 6.2, "Heysham", "Dublin", { allowed_berths: ["b26", "b27", "b52"], operator: "freight" }), BERTH_BY_ID.b52, 74, 6, 86);
  extra.planned_hour = null;
  extra.planned_section = null;
  extra.display_name = extra.name;
  ships.push(extra);
  disruptions.push({ type: "extra", ship: extra.id });
  notices.push(`Unscheduled freight RoRo: ship ${extra.id} ${extra.name} (186 m) arrives at hour ${extra.arrival}, needs 6 hours alongside and asks to sail by hour ${extra.due}. It may use berths 26, 27 or 52.`);

  const ids = ["b49", "b51", "b51a", "b26", "b27", "b52"];
  const secs = ids.flatMap((id) => [BERTH_BY_ID[id].first_section, BERTH_BY_ID[id].last_section]);
  return makeTask({
    task_id: "dub-ferries-w18-hard-0", split: "play", quay: "49/51/51A/26/27",
    terminal: "Dublin Port RoRo terminals", title: "Irish Sea ferries",
    blurb: "A week of Irish Ferries, Stena Line and Liverpool RoRo calls. A late Ulysses, a channel gale, and an unscheduled freight ship. Slot times are illustrative.",
    week: 18, week_start_iso: "2026-04-27T00:00:00Z", difficulty: "hard",
    berth_ids: ids, first_section: Math.min(...secs), last_section: Math.max(...secs), section_m: SECTION_M,
    ships, blocks: [], notices, disruptions,
    rules: { reward: 3, gap_k: 100, tide_phase: 0.3, tide_sn_phase: 1.0, no_moves: [{ start: 70, end: 78, min_length: 180, reason: "southerly gale" }] },
  });
}

function oceanCruise() {
  const b32 = BERTH_BY_ID.b32, b36 = BERTH_BY_ID.b36, b38 = BERTH_BY_ID.b38;
  const ships = [];
  const calls = [
    ["Silver Liffey", "cruise", 294, 8.2, "b32", 8, 14, "Southampton"],
    ["Portroe Bulk", "bulk", 180, 9.0, "b38", 6, 16, "Newhaven"],
    ["Wicklow Stone", "bulk", 140, 7.8, "b36", 10, 12, "Belfast"],
    ["Celestial East", "cruise", 252, 7.9, "b32", 48, 16, "Greenock"],
    ["Alexandra Grain", "bulk", 200, 9.2, "b38", 40, 18, "Rouen"],
    ["Northern Circlet", "cruise", 270, 8.0, "b32", 90, 18, "Liverpool"],
    ["Kish Aggregates", "bulk", 155, 8.1, "b36", 70, 14, "Glensanda"],
    ["Bay Grain", "bulk", 188, 9.1, "b38", 88, 16, "Rouen"],
  ];
  calls.forEach((c, i) => {
    const [name, kind, loa, d, bid, hour, handling, from] = c;
    const s = finalizeShip(shipBase(i, name, kind, loa, d, from, "Dublin", { allowed_berths: kind === "cruise" ? ["b32", "b38", "b36"] : ["b32", "b36", "b38"] }), BERTH_BY_ID[bid], hour, handling, hour + handling);
    if (kind === "cruise") s.weight = 2;
    ships.push(s);
  });
  const disruptions = [];
  const notices = [];
  const late = ships[3];
  late.arrival = late.planned_hour + 8;
  disruptions.push({ type: "late", ship: late.id, hours: 8 });
  notices.push(`Ship ${late.id} ${late.name} was delayed leaving ${late.from_port}: it now arrives at hour ${late.arrival} (planned berthing hour ${late.planned_hour}). Its planned departure stays hour ${late.due}. Cruise delay is weighted twice.`);
  const closure = { type: "closure", first: b36.first_section, last: b36.last_section, start: 60, end: 84, reason: "quay crane rail repair on berth 36" };
  disruptions.push(closure);
  notices.push(`Berth 36 (sections ${b36.first_section}–${b36.last_section}) is closed from hour ${closure.start} to hour ${closure.end} (${closure.reason}).`);
  notices.push("Deeper bulk ships must respect official approach depths (7.5–7.7 m at Ocean Pier) plus 1.0 m under-keel clearance. Tidal windows are enforced automatically.");
  const blocks = [{ first: closure.first, last: closure.last, start: closure.start, end: closure.end, kind: "closed", label: "berth 36 rail repair" }];
  return makeTask({
    task_id: "dub-ocean-cruise-0", split: "play", quay: "32/36/38", terminal: "Ocean Pier", title: "Ocean Pier cruise and bulk",
    blurb: "Three cruise calls share Ocean Pier with bulk ships. A late cruise arrival, a berth 36 closure, and tidal windows on the official approach depths.",
    week: 22, week_start_iso: "2026-05-25T00:00:00Z", difficulty: "medium",
    berth_ids: ["b32", "b36", "b38"], first_section: b32.first_section, last_section: b38.last_section, section_m: SECTION_M,
    ships, blocks, notices, disruptions, rules: { reward: 3, gap_k: 100, tide_phase: 0.2, tide_sn_phase: 0.0 },
  });
}

function mtlPoolbeg() {
  const ids = ["mtl"];
  const ships = [];
  const calls = [
    ["South Wall Feeder", 148, 7.0, "b41", 5, 10, "Rotterdam"],
    ["Ringsend Box", 165, 8.4, "b42", 8, 12, "Antwerp"],
    ["Irishtown Cut", 188, 8.6, "b43", 6, 14, "Le Havre"],
    ["Pigeon House", 120, 7.1, "b44", 10, 8, "Liverpool"],
    ["Shelly Banks", 158, 8.0, "b45", 4, 11, "Greenock"],
    ["South Wall Feeder", 148, 7.0, "b41", 28, 10, "Rotterdam"],
    ["Ringsend Box", 165, 8.4, "b43", 36, 12, "Antwerp"],
    ["Irishtown Cut", 188, 8.6, "b42", 40, 14, "Le Havre"],
    ["Merrion Strand", 210, 8.8, "b45", 32, 16, "Rotterdam"],
    ["Pigeon House", 120, 7.1, "b44", 48, 8, "Liverpool"],
    ["Shelly Banks", 158, 8.0, "b41", 52, 11, "Greenock"],
    ["Sandymount Box", 174, 8.3, "b43", 70, 13, "Zeebrugge"],
    ["Irishtown Cut", 188, 8.6, "b42", 72, 14, "Le Havre"],
    ["Merrion Strand", 210, 8.8, "b45", 80, 16, "Rotterdam"],
    ["Ringsend Box", 165, 8.4, "b41", 88, 12, "Antwerp"],
  ];
  calls.forEach((c, i) => {
    const [name, loa, d, bid, hour, handling, from] = c;
    const s = finalizeShip(shipBase(i, name, "container", loa, d, from, "Dublin", { allowed_berths: ids }), BERTH_BY_ID.mtl, hour, handling, hour + handling);
    s.display_name = `${name} (h${hour})`;
    ships.push(s);
  });
  const disruptions = [];
  const notices = [
    "MTL's current crane fleet was not independently verified; this scenario does not cap a crane pool.",
    "Berths 41–45 are planned as one continuous LoLo face (assumption). Official individual lengths still appear on the map. Approach depth 7.8 m is the official figure for berths 42–44.",
  ];
  const late = ships[8];
  late.arrival = late.planned_hour + 10;
  disruptions.push({ type: "late", ship: late.id, hours: 10 });
  notices.push(`Ship ${late.id} ${late.display_name} was delayed leaving ${late.from_port}: it now arrives at hour ${late.arrival} (planned berthing hour ${late.planned_hour}). Its planned departure stays hour ${late.due}.`);
  const mtl = BERTH_BY_ID.mtl;
  const closureFirst = mtl.first_section + 8; // assumed location of berth 44 along the combined face
  const closureLast = mtl.first_section + 9;
  const closure = { type: "closure", first: closureFirst, last: closureLast, start: 40, end: 64, reason: "fender works on berth 44 (two planning sections on the combined MTL face)" };
  disruptions.push(closure);
  notices.push(`Berth 44 is closed from hour ${closure.start} to hour ${closure.end} (${closure.reason}).`);
  const extra = finalizeShip(shipBase(ships.length, "Grand Canal Dock", "container", 142, 7.3, "Belfast", "Dublin", { allowed_berths: ids }), BERTH_BY_ID.mtl, 44, 9, 60);
  extra.planned_hour = null;
  extra.planned_section = null;
  extra.display_name = extra.name;
  ships.push(extra);
  disruptions.push({ type: "extra", ship: extra.id });
  notices.push(`Unscheduled call: ship ${extra.id} ${extra.name} (${extra.length_m} m) arrives at hour ${extra.arrival}, needs ${extra.handling} hours and asks to sail by hour ${extra.due}.`);
  const blocks = [{ first: closure.first, last: closure.last, start: closure.start, end: closure.end, kind: "closed", label: "berth 44 fender works" }];
  return makeTask({
    task_id: "dub-mtl-poolbeg-0", split: "play", quay: "41–45", terminal: "MTL, Poolbeg (south side)", title: "Poolbeg container terminal",
    blurb: "Feeders on MTL berths 41–45, south of the Liffey channel. A late deep-sea-feeder, a berth 44 closure, and an extra Belfast call.",
    week: 30, week_start_iso: "2026-07-20T00:00:00Z", difficulty: "hard",
    berth_ids: ids, first_section: BERTH_BY_ID.mtl.first_section, last_section: BERTH_BY_ID.mtl.last_section, section_m: SECTION_M,
    ships, blocks, notices, disruptions, rules: { reward: 3, gap_k: 100, tide_phase: 0.6, tide_sn_phase: 2.0 },
  });
}

function oilTide() {
  const ids = ["ob1", "ob2", "ob3", "ob4"];
  const ships = [];
  const calls = [
    ["Fairway Spirit", 178, 9.8, "ob1", 6, 14, "Milford Haven", "product"],
    ["Liffey Bar", 170, 10.1, "ob2", 8, 16, "Rotterdam", "product"],
    ["Bitumen Isle", 140, 7.4, "ob3", 10, 18, "Antwerp", "bitumen"],
    ["Poolbeg Gas", 130, 7.0, "ob3", 48, 12, "Teesside", "lpg"],
    ["Fairway Spirit", 178, 9.8, "ob1", 40, 14, "Milford Haven", "product"],
    ["Eastern Grade", 160, 9.6, "ob2", 44, 15, "Pembroke", "product"],
    ["Bitumen Isle", 140, 7.4, "ob4", 36, 16, "Antwerp", "bitumen"],
    ["North Wall Product", 175, 10.0, "ob1", 80, 16, "Rotterdam", "product"],
    ["Liffey Bar", 170, 10.1, "ob2", 84, 16, "Rotterdam", "product"],
    ["Poolbeg Gas", 130, 7.0, "ob3", 92, 12, "Teesside", "lpg"],
    ["Fairway Spirit", 178, 9.8, "ob1", 120, 14, "Milford Haven", "product"],
  ];
  calls.forEach((c, i) => {
    const [name, loa, d, bid, hour, handling, from, cargo] = c;
    const allowed = cargo === "product" ? ["ob1", "ob2"] : cargo === "lpg" ? ["ob3"] : ["ob3", "ob4"];
    const s = finalizeShip(shipBase(i, name, "tanker", loa, d, from, "Dublin", { allowed_berths: allowed, cargo }), BERTH_BY_ID[bid], hour, handling, hour + handling);
    s.display_name = `${name} (h${hour})`;
    if (d >= 9.8) s.weight = 2;
    ships.push(s);
  });
  const disruptions = [];
  const notices = [
    "Deep product tankers (draught around 10 m) cannot transit the official 7.7–7.8 m approach at low water. The planner blocks berthing and departure outside the tidal window (approach depth + tide − 1.0 m UKC).",
    "OB1 and OB2 take petroleum products; OB3 takes bitumen and LPG; OB4 is shallower (survey 6.2 m) and only suits the lighter bitumen calls.",
  ];
  const late = ships[5];
  late.arrival = late.planned_hour + 11;
  disruptions.push({ type: "late", ship: late.id, hours: 11 });
  notices.push(`Ship ${late.id} ${late.display_name} was delayed leaving ${late.from_port}: it now arrives at hour ${late.arrival} (planned berthing hour ${late.planned_hour}). Its planned departure stays hour ${late.due}.`);
  const emergency = ships[7];
  emergency.berth_deadline = emergency.planned_hour + 4;
  emergency.deadline_penalty = 20;
  emergency.weight = 3;
  disruptions.push({ type: "emergency", ship: emergency.id, berth_deadline: emergency.berth_deadline, deadline_penalty: 20 });
  notices.push(`Emergency: ship ${emergency.id} ${emergency.display_name} is a priority discharge and should be berthed by hour ${emergency.berth_deadline}, or a penalty of 20 per hour late to the berth applies (weight 3).`);
  return makeTask({
    task_id: "dub-oil-tide-0", split: "play", quay: "OB1–OB4", terminal: "Dublin Port oil jetties", title: "Oil berths and tidal windows",
    blurb: "Product, bitumen and LPG tankers on OB1–OB4. Deep draughts meet official approach depths only around high water. One late ship and one priority discharge.",
    week: 36, week_start_iso: "2026-08-31T00:00:00Z", difficulty: "expert",
    berth_ids: ids, first_section: BERTH_BY_ID.ob1.first_section, last_section: BERTH_BY_ID.ob4.last_section, section_m: SECTION_M,
    ships, blocks: [], notices, disruptions, rules: { reward: 3, gap_k: 100, tide_phase: 0.0, tide_sn_phase: 0.0 },
  });
}

function portStorm() {
  const ferries = ferriesHard();
  const dft = dftBusy();
  const oil = oilTide();
  const cruise = oceanCruise();
  const pick = [];
  const take = (task, pred) => { for (const s of task.ships) if (pred(s)) pick.push({ ...s, display_name: s.display_name || s.name }); };
  take(ferries, (s) => s.planned_hour != null && s.planned_hour < 72 && ["Ulysses", "Stena Estrid", "Mersey Trail", "W.B. Yeats"].includes(s.name));
  take(dft, (s) => s.id < 6 || s.planned_hour == null);
  take(oil, (s) => s.id === 0 || s.id === 1 || s.id === 7);
  take(cruise, (s) => s.kind === "cruise" && s.planned_hour != null && s.planned_hour < 60);
  const ships = pick.map((s, i) => ({ ...s, id: i }));
  const notices = [
    "Whole-port storm week: a thinner mix of ferries, DFT feeders, a cruise call and two deep product tankers.",
    "Gale: ships of 180 m and over may not berth or leave between hour 28 and hour 40.",
    "One DFT gantry is out from hour 20 to hour 36. DFT crane pool is otherwise 3.",
    "Deep tankers still need tidal windows on the official oil-jetty approach depths.",
  ];
  const disruptions = [
    { type: "gale", start: 28, end: 40, min_length: 180, reason: "storm, no large-ship movements" },
    { type: "crane_outage", start: 20, end: 36, cranes: 1, reason: "DFT gantry outage" },
  ];
  const u = ships.find((s) => s.name === "Ulysses" && (s.planned_hour || 0) >= 16);
  if (u) {
    u.arrival = u.planned_hour + 7;
    disruptions.push({ type: "late", ship: u.id, hours: 7 });
    notices.push(`Ship ${u.id} ${u.display_name || u.name} was delayed leaving Holyhead and now arrives at hour ${u.arrival}. Planned departure stays hour ${u.due}.`);
  }
  const tanker = ships.find((s) => s.kind === "tanker" && s.draught_m >= 9.8 && s.planned_hour);
  if (tanker) {
    tanker.berth_deadline = tanker.planned_hour + 6;
    tanker.deadline_penalty = 20;
    tanker.weight = 3;
    disruptions.push({ type: "emergency", ship: tanker.id, berth_deadline: tanker.berth_deadline, deadline_penalty: 20 });
    notices.push(`Priority tanker ${tanker.id} ${tanker.display_name || tanker.name} should be berthed by hour ${tanker.berth_deadline}.`);
  }
  const berth_ids = [...new Set(ships.flatMap((s) => s.allowed_berths))];
  const sections = berth_ids.flatMap((id) => [BERTH_BY_ID[id].first_section, BERTH_BY_ID[id].last_section]);
  return makeTask({
    task_id: "dub-port-storm-0", split: "play", quay: "Dublin Port", terminal: "Dublin Port (multi-terminal)", title: "Whole-port storm week",
    blurb: "Ferries, DFT feeders, a cruise ship and product tankers in the same episode. Channel gale, a DFT crane outage, a late Ulysses and a priority tanker.",
    week: 44, week_start_iso: "2026-10-26T00:00:00Z", difficulty: "storm",
    berth_ids, first_section: Math.min(...sections), last_section: Math.max(...sections), section_m: SECTION_M,
    ships, blocks: [], notices, disruptions,
    rules: { crane_pool: 3, crane_rate: CRANE_RATE, crane_outages: [{ start: 20, end: 36, cranes: 1 }], max_moves_per_hour: 3, no_moves: [{ start: 28, end: 40, min_length: 180, reason: "storm" }], reward: 3, gap_k: 100, tide_phase: 0.4, tide_sn_phase: 1.2 },
  });
}

function attachReference(task, seed) {
  const solved = solveTask(task, mulberry32(seed));
  const evN = evaluatePlan(task, solved.naive_plan);
  const evB = evaluatePlan(task, solved.best_plan);
  task.reference = {
    naive_cost: evN.feasible ? evN.cost : null,
    naive_feasible: evN.feasible,
    optimal_cost: evB.feasible ? evB.cost : evN.cost,
    best_known_cost: evB.feasible ? evB.cost : evN.cost,
    best_feasible: evB.feasible,
    unavoidable_cost: unavoidableCost(task),
    heuristic: "naive + local search (not a proven CP-SAT optimum)",
    naive_plan: solved.naive_plan,
    best_plan: solved.best_plan,
  };
  return task;
}

const builders = [[dftBusy, 11], [ferriesHard, 22], [oceanCruise, 33], [mtlPoolbeg, 44], [oilTide, 55], [portStorm, 66]];
const tasks = [];
for (const [fn, seed] of builders) {
  const task = attachReference(fn(), seed);
  const published = task.ships.filter((s) => s.planned_hour != null).map((s) => ({ ship: s.id, berth_hour: s.planned_hour, section: s.planned_section, cranes: s.std_cranes }));
  const evP = evaluatePlan(task, published);
  console.log(task.task_id, "ships", task.ships.length, "published_feasible", evP.feasible, "pub_issues", evP.issues.length, "naive", task.reference.naive_feasible, task.reference.naive_cost, "best", task.reference.best_feasible, task.reference.best_known_cost);
  if (!task.reference.naive_feasible) {
    const ev = evaluatePlan(task, task.reference.naive_plan);
    console.log("  missing", ev.missing, "issues:");
    for (const i of ev.issues.slice(0, 8)) console.log("   -", i.problem);
  }
  tasks.push(task);
}
mkdirSync("/workspace/dublin-portsim/web/data", { recursive: true });
mkdirSync("/workspace/dublin-portsim/python/dublin_portsim/tasks", { recursive: true });
writeFileSync("/workspace/dublin-portsim/web/data/tasks.json", JSON.stringify(tasks, null, 2));
writeFileSync("/workspace/dublin-portsim/python/dublin_portsim/tasks/tasks.json", JSON.stringify(tasks));
console.log("wrote", tasks.length, "tasks");
