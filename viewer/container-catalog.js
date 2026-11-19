// Deterministic container identities, bookings and simulated history for the
// Dublin twin. ISO 6346 numbers carry a valid check digit; times follow the
// berth-chart clock and are labelled simulated.
import * as THREE from "three";
import { hashStr, mulberry32 } from "./model.js";
import { MARKINGS } from "./scene-kit.js";
import { BOX_H, BOX_L, BOX_W } from "./scene-world.js";
import { formatSimClock } from "./container-ops.js";

const OWNERS = [
  { code: "TCLU", line: "Textainer" },
  { code: "MAEU", line: "Maersk Line" },
  { code: "MSCU", line: "MSC" },
  { code: "CMAU", line: "CMA CGM" },
  { code: "HLCU", line: "Hapag-Lloyd" },
  { code: "ONEU", line: "Ocean Network Express" },
  { code: "EGSU", line: "Evergreen Line" },
  { code: "CSNU", line: "COSCO Shipping" },
  { code: "TRHU", line: "Triton" },
  { code: "TEXU", line: "Textainer" },
  { code: "SEAU", line: "Seaco" },
  { code: "FSCU", line: "Florens" },
  { code: "HMMU", line: "HMM" },
  { code: "ZIMU", line: "ZIM" },
];

const TYPES = {
  dry40: { code: "45G1", name: "40' high-cube dry", length_ft: 40, tare: 3850, max: 30480 },
  dry20: { code: "22G1", name: "20' dry", length_ft: 20, tare: 2280, max: 30480 },
  hc40: { code: "45G1", name: "40' high-cube dry", length_ft: 40, tare: 3900, max: 30480 },
  reefer40: { code: "45R1", name: "40' high-cube reefer", length_ft: 40, tare: 4600, max: 30480 },
  reefer20: { code: "22R1", name: "20' reefer", length_ft: 20, tare: 3050, max: 30480 },
  ot40: { code: "42U1", name: "40' open-top", length_ft: 40, tare: 4100, max: 30480 },
  tank20: { code: "22T1", name: "20' tank", length_ft: 20, tare: 3500, max: 36000 },
  flat40: { code: "45P3", name: "40' flat-rack", length_ft: 40, tare: 5200, max: 45000 },
};

const COMMODITIES = [
  "general cargo", "retail goods", "pharmaceuticals", "frozen meat", "dairy",
  "machinery parts", "paper reels", "empty repositioning", "electronics",
  "building materials", "beverages", "auto parts", "chemicals (non-hazardous)",
  "furniture", "fish (frozen)",
];

export function isoCharValue(ch) {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  const n = ch.toUpperCase().charCodeAt(0) - 65;
  if (n < 0 || n > 25) return 0;
  return n + 10 + Math.floor((n + 10) / 11); // skip multiples of 11
}

/** Check digit for the first 10 characters of an ISO 6346 number. 10 maps to 0. */
export function isoCheckDigit(body) {
  let sum = 0, w = 1;
  for (let i = 0; i < 10; i++) {
    sum += isoCharValue(body[i] || "0") * w;
    w *= 2;
  }
  const d = sum % 11;
  return d === 10 ? 0 : d;
}

/** Owner code (4 letters) + category U + 6-digit serial + valid check digit. */
export function iso6346(owner, serial) {
  const code = String(owner || "TCLU").replace(/[^A-Z]/gi, "X").toUpperCase().padEnd(4, "X").slice(0, 4);
  const num = String(Math.abs(serial | 0) % 1e6).padStart(6, "0");
  const body = `${code}${num}`;
  return body + isoCheckDigit(body);
}

function rng(seed) {
  return mulberry32(typeof seed === "number" ? seed : hashStr(String(seed)));
}

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

function ownerForBrand(b, r) {
  if (b > 0 && b < OWNERS.length) return OWNERS[b];
  return pick(r, [OWNERS[0], OWNERS[8], OWNERS[9], OWNERS[10], OWNERS[11]]);
}

function typeFor(item, r) {
  const len = item?.s?.[0] ?? item?.w ?? BOX_L;
  const is20 = len < 8;
  const u = r();
  if (u < 0.07) return is20 ? TYPES.reefer20 : TYPES.reefer40;
  if (u < 0.09) return is20 ? TYPES.tank20 : TYPES.ot40;
  if (u < 0.11 && !is20) return TYPES.flat40;
  return is20 ? TYPES.dry20 : TYPES.hc40;
}

function kg(r, tare, max) {
  const payload = Math.round((0.22 + r() * 0.62) * (max - tare) / 10) * 10;
  const gross = tare + payload;
  return { tare, payload, gross };
}

function yardAddress(p, lay) {
  const x0 = lay?.quayX0 ?? -200;
  const x1 = lay?.quayX1 ?? 200;
  const span = Math.max(80, x1 - x0);
  const blockI = Math.max(0, Math.min(7, Math.floor((p.x - x0) / (span / 6))));
  const block = `DFT-${String.fromCharCode(65 + blockI)}`;
  const bay = 1 + Math.max(0, Math.round(Math.abs((p.z ?? -80) + 40) / 12.8));
  const row = 1 + Math.max(0, Math.round(((p.x - x0) % 80) / 4.1));
  const tier = 1 + Math.max(0, Math.round(((p.y ?? 1.4) - (0.08 + BOX_H / 2)) / (BOX_H + 0.03)));
  return { block, bay, row, tier, label: `${block} / bay ${bay} / row ${row} / tier ${tier}` };
}

function shipStow(slot) {
  const bay = `${slot.x > 0 ? "+" : ""}${slot.x.toFixed(0)} m`;
  const row = slot.z >= 0 ? "starboard" : "port";
  const tier = (slot.t ?? 0) + 1;
  return { bay, row, tier, label: `bay ${bay}, ${row}, tier ${tier}` };
}

function fmt(fmtFn, hour) {
  return formatSimClock(fmtFn, hour);
}

/**
 * Seeded history along the berth-chart clock. Events before `time` are past;
 * later ones are planned. Every line is simulated.
 */
export function historyTimeline(rec, time, fmtFn) {
  const ev = (t, text, kind = "plan") => ({ t, text, kind, simulated: true });
  const inbound = rec.inbound;
  const outbound = rec.outbound;
  const out = [];
  const tLoad = inbound.berth != null ? inbound.berth - (inbound.voyageDays || 3) * 24 - 10 - rec._rOff * 8 : -36;
  const tGate = tLoad - 14 - rec._rOff * 6;
  const tBook = tGate - 48 - rec._rOff * 20;
  const tSail = tLoad + 6 + rec._rOff * 4;
  const tArrive = inbound.arrival != null ? inbound.arrival : (inbound.berth ?? 0) - 2;
  const tPilot = inbound.berth != null ? inbound.berth : tArrive + 2;
  out.push(ev(tBook, `Booking ${rec.booking} confirmed · ${rec.commodity}`));
  out.push(ev(tGate, `Gate-in at ${rec.origin} (${rec.iso}, ${rec.size.code})`));
  if (inbound.vessel) out.push(ev(tLoad, `Loaded onto ${inbound.vessel} at ${rec.origin}`));
  if (inbound.vessel) out.push(ev(tSail, `${inbound.vessel} sailed ${rec.origin} → Dublin`));
  if (inbound.vessel) out.push(ev(tArrive, `${inbound.vessel} arrived Dublin approaches`));
  if (inbound.vessel && inbound.berth != null) {
    const call = inbound.call || "the berth";
    out.push(ev(tPilot, `${inbound.vessel} alongside ${call}`));
  }
  if (rec.originState === "aboard" || rec.state === "aboard" || rec.state === "lifting") {
    out.push(ev(tPilot + 0.2, `On deck awaiting discharge at ${inbound.call || "Dublin"}`));
  }
  if (rec.liveHistory) {
    for (const line of rec.liveHistory) {
      // Live events already include a sim-clock stamp when we recorded them.
      out.push({ t: rec.liveTimes?.[line] ?? time, text: line, kind: "live", simulated: true });
    }
  } else if (rec.originState === "yard" || rec.state === "yard" || rec.state === "quay" || rec.state === "transit") {
    const tDisc = inbound.dischargeAt ?? (tPilot + 1 + rec._rOff * 3);
    const crane = rec.inbound.crane || "a quay crane";
    out.push(ev(tDisc, `Discharged by ${crane} at ${inbound.call || "the quay"}`));
    if (rec.yard) out.push(ev(tDisc + 0.6, `Stacked in the yard · ${rec.yard.label}`));
  }
  if (outbound?.vessel) {
    const tOut = outbound.berth != null ? outbound.berth : (tPilot + 24);
    out.push(ev(tOut - 4, `Released for export · planned load onto ${outbound.vessel}`));
    out.push(ev(tOut, `Planned load onto ${outbound.vessel} at ${outbound.call || "the berth"}`));
    out.push(ev(tOut + (outbound.voyageDays || 2) * 24, `Planned arrival ${rec.destination}`));
  } else if (rec.destination && rec.destination !== "Dublin") {
    out.push(ev(tPilot + 18, `Planned gate-out for delivery, ${rec.destination}`));
  } else {
    out.push(ev(tPilot + 18, "Held in the Dublin yard (no onward booking)"));
  }
  // Stable order; live lines that duplicate a seeded discharge stay once (live wins).
  const seen = new Set();
  const unique = [];
  for (const e of out) {
    const key = e.text.replace(/\s+/g, " ");
    if (seen.has(key) && e.kind !== "live") continue;
    seen.add(key);
    unique.push(e);
  }
  unique.sort((a, b) => a.t - b.t);
  return unique.map((e) => ({
    ...e,
    clock: fmt(fmtFn, e.t),
    when: e.t <= time + 1e-6 ? "past" : "planned",
  }));
}

export function relatedItems(rec, catalog) {
  const items = [];
  if (rec.inbound?.shipKey) items.push({ kind: "vessel", role: "Inbound vessel", id: rec.inbound.shipKey, label: rec.inbound.vessel, shipKey: rec.inbound.shipKey, shipId: rec.inbound.shipId });
  if (rec.outbound?.shipKey && rec.outbound.shipKey !== rec.inbound?.shipKey) {
    items.push({ kind: "vessel", role: "Outbound vessel", id: rec.outbound.shipKey, label: rec.outbound.vessel, shipKey: rec.outbound.shipKey, shipId: rec.outbound.shipId });
  }
  if (rec.craneIndex != null) items.push({ kind: "crane", role: "Quay crane", id: `crane-${rec.craneIndex}`, label: rec.craneLabel || `crane ${rec.craneIndex + 1}`, craneIndex: rec.craneIndex });
  else if (rec.preferredCraneIndex != null) items.push({ kind: "crane", role: "Nearest gantry", id: `crane-${rec.preferredCraneIndex}`, label: `crane ${rec.preferredCraneIndex + 1}`, craneIndex: rec.preferredCraneIndex });
  if (rec.yard) items.push({ kind: "slot", role: "Yard slot", id: `slot-${rec.id}`, label: rec.yard.label, recId: rec.id });
  const bookingMates = [...catalog.values()].filter((o) => o.id !== rec.id && o.booking === rec.booking);
  for (const o of bookingMates.slice(0, 2)) {
    items.push({ kind: "box", role: "Same booking", id: o.id, label: `${o.iso} · ${o.stateLabel || o.state}`, recId: o.id });
  }
  const bookingCount = items.filter((i) => i.role === "Same booking").length;
  if (bookingCount < 2) {
    const vesselMates = [...catalog.values()].filter((o) => o.id !== rec.id && o.ship === rec.ship).slice(0, 4);
    const have = new Set(items.map((i) => i.recId));
    for (const o of vesselMates) {
      if (have.has(o.id)) continue;
      items.push({ kind: "box", role: "Same vessel", id: o.id, label: `${o.iso} · ${o.stow?.label || o.yard?.label || o.state}`, recId: o.id });
      if (items.filter((i) => i.role === "Same vessel").length >= 2) break;
    }
  }
  return items;
}

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stateLabel(s) {
  return ({
    aboard: "On board", lifting: "On the spreader", quay: "On the quay",
    transit: "To the yard", yard: "In the yard", loading: "Loading",
  })[s] || s;
}

function callLabel(task, ship, row) {
  const quay = task?.quay || "the quay";
  const sec = row?.section ?? ship?.planned_section;
  const n = ship?.sections;
  if (sec == null) return `${quay} (unassigned)`;
  const last = n ? sec + n - 1 : sec;
  return `${quay} · sections ${sec}${last !== sec ? "–" + last : ""}`;
}

function shipByKey(actors, key) {
  return actors.get(key);
}

/**
 * Build a deterministic catalogue of every shipboard and yard box for this task.
 */
export function buildContainerCatalog({ task, actors, world, lay, cranes = [], fmt: fmtFn }) {
  const catalog = new Map();
  const ships = [...actors.values()].filter((a) => a.ship);
  const r0 = rng(`catalog:${task?.task_id || "dub"}:${lay?.quay || ""}`);

  const laterShip = (afterKey, r) => {
    const rest = ships.filter((a) => a.key !== afterKey);
    if (!rest.length) return null;
    return rest[Math.floor(r() * rest.length) % rest.length];
  };

  const makeRec = ({ id, seed, slot, item, actor, state, mesh, inst, originState }) => {
    const r = rng(seed);
    const brand = slot?.b ?? item?.b ?? 0;
    const owner = ownerForBrand(brand, r);
    const serial = 100000 + (hashStr(seed) % 900000);
    const iso = iso6346(owner.code, serial);
    const size = typeFor(item || { s: [slot && slot.w < 8 ? 6.06 : BOX_L] }, r);
    const wt = kg(r, size.tare, size.max);
    const lineMark = MARKINGS[brand] || owner.line;
    const origin = actor?.ship?.from_port || pick(r, ["Rotterdam", "Antwerp", "Liverpool", "Le Havre", "Southampton", "Zeebrugge", "Greenock"]);
    const destChoices = [actor?.ship?.to_port, "Dublin", "Belfast", "Liverpool", "Holyhead", "Cork"].filter(Boolean);
    const destination = state === "aboard" || originState === "aboard" ? "Dublin" : pick(r, destChoices);
    const inboundShip = actor || null;
    const outActor = r() < 0.45 ? laterShip(inboundShip?.key, r) : null;
    const rec = {
      id,
      iso,
      seed,
      ship: inboundShip?.key || null,
      shipName: inboundShip?.name || inboundShip?.ship?.name || null,
      shipId: inboundShip?.id,
      slot: slot || null,
      mesh, inst, item,
      kind: size.name,
      size,
      weight: wt,
      line: lineMark,
      owner: owner.line,
      ownerCode: owner.code,
      commodity: pick(r, COMMODITIES),
      origin,
      destination,
      state,
      originState: originState || state,
      booking: "",
      yard: state === "yard" && item?.p ? yardAddress({ x: item.p[0], y: item.p[1], z: item.p[2] }, lay) : null,
      stow: slot ? shipStow(slot) : null,
      inbound: inboundShip ? {
        vessel: inboundShip.name,
        shipKey: inboundShip.key,
        shipId: inboundShip.id,
        arrival: inboundShip.ship?.arrival,
        berth: inboundShip.row?.berth ?? inboundShip.ship?.planned_hour,
        call: callLabel(task, inboundShip.ship, inboundShip.row),
        voyageDays: 2 + Math.floor(r() * 4),
        crane: null,
      } : { vessel: null, voyageDays: 3 },
      outbound: outActor ? {
        vessel: outActor.name,
        shipKey: outActor.key,
        shipId: outActor.id,
        berth: outActor.row?.berth ?? outActor.ship?.planned_hour,
        call: callLabel(task, outActor.ship, outActor.row),
        voyageDays: 1 + Math.floor(r() * 3),
      } : null,
      history: [],
      liveHistory: [],
      liveTimes: {},
      craneLabel: "",
      craneIndex: null,
      preferredCraneIndex: preferredCrane(cranes, item?.p?.[0] ?? slot?.x ?? 0, lay),
      _rOff: r(),
    };
    rec.stateLabel = stateLabel(rec.state);
    catalog.set(id, rec);
    return rec;
  };

  for (const actor of ships) {
    const slots = actor.model?.cargoSlots || [];
    for (const slot of slots) {
      const id = `${actor.key}:${slot.id}`;
      makeRec({ id, seed: `${task?.task_id || "t"}:${id}`, slot, actor, state: "aboard", originState: "aboard" });
    }
  }

  const yardRecs = [];
  if (world?.root) {
    world.root.traverse((o) => {
      if (!o.isInstancedMesh || o.userData?.kind !== "containers") return;
      const items = o.userData.items || [];
      items.forEach((item, inst) => {
        if (!item?.p) return;
        if (inst >= (o.count || items.length)) return;
        const id = `yard:${Math.round(item.p[0] * 10)}:${Math.round(item.p[1] * 10)}:${Math.round(item.p[2] * 10)}:${inst}`;
        if (catalog.has(id)) return;
        const rec = makeRec({ id, seed: `${task?.task_id || "t"}:${id}`, item, actor: null, state: "yard", mesh: o, inst, originState: "yard" });
        yardRecs.push(rec);
      });
    });
  }

  // Bookings: group 2–4 shipboard boxes on the same vessel; attach a yard box
  // to some consignments so a yard click can fly to the inbound ship.
  let bookingN = 1;
  for (const actor of ships) {
    const mine = [...catalog.values()].filter((r) => r.ship === actor.key && r.originState === "aboard");
    mine.sort((a, b) => (a.slot?.x ?? 0) - (b.slot?.x ?? 0) || (a.slot?.t ?? 0) - (b.slot?.t ?? 0));
    const r = rng(`${task?.task_id}:book:${actor.key}`);
    let i = 0;
    while (i < mine.length) {
      const n = 2 + Math.floor(r() * 3);
      const group = mine.slice(i, i + n);
      const booking = `BK${String(bookingN++).padStart(5, "0")}`;
      const dest = group[0].destination;
      const commodity = group[0].commodity;
      for (const rec of group) {
        rec.booking = booking;
        rec.destination = dest;
        rec.commodity = commodity;
        rec.outbound = group[0].outbound;
      }
      if (r() < 0.55 && yardRecs.length) {
        const y = yardRecs[Math.floor(r() * yardRecs.length) % yardRecs.length];
        if (!y.booking) {
          y.booking = booking;
          y.commodity = commodity;
          y.origin = group[0].origin;
          y.destination = dest;
          y.ship = actor.key;
          y.shipName = actor.name;
          y.shipId = actor.id;
          y.inbound = { ...group[0].inbound, dischargeAt: (group[0].inbound.berth ?? 0) - (8 + r() * 20) };
          y.outbound = group[0].outbound;
        }
      }
      i += n;
    }
  }
  for (const y of yardRecs) {
    if (y.booking) continue;
    y.booking = `BK${String(bookingN++).padStart(5, "0")}`;
    // Residual yard inventory: invent a previous Dublin call as inbound.
    if (!y.inbound.vessel) {
      const r = rng(y.seed + ":in");
      const prev = pick(r, ships) || null;
      if (prev) {
        y.inbound = {
          vessel: prev.name,
          shipKey: prev.key,
          shipId: prev.id,
          arrival: (prev.ship?.arrival ?? 0) - 24,
          berth: (prev.ship?.planned_hour ?? 0) - 24,
          call: callLabel(task, prev.ship, prev.row),
          voyageDays: 2 + Math.floor(r() * 3),
        };
        y.ship = prev.key;
        y.shipName = prev.name;
        y.shipId = prev.id;
        y.origin = prev.ship?.from_port || y.origin;
      }
    }
  }

  // Prefer a gantry near the box's quay x for "how it relates".
  for (const rec of catalog.values()) rec.stateLabel = stateLabel(rec.state);
  return catalog;
}

function preferredCrane(cranes, x, lay) {
  if (!cranes?.length) return 0;
  // Fall back to a section-based index when cranes have not yet been posed.
  let best = 0, d = Infinity;
  cranes.forEach((c, i) => {
    const cx = c.st?.x ?? (lay ? lay.X0 + ((i + 0.5) * lay.L) / cranes.length : i * 40);
    const dd = Math.abs(cx - (x || 0));
    if (dd < d) { d = dd; best = i; }
  });
  return best;
}

export function renderContainerPanel(rec, { catalog, time, fmt: fmtFn, canLoad = false, message = "", shipList = null } = {}) {
  if (shipList) return renderShipPanel(shipList, { fmt: fmtFn, time });
  const hist = historyTimeline(rec, time, fmtFn);
  const rel = relatedItems(rec, catalog || new Map());
  const wt = rec.weight;
  const live = rec.liveHistory?.length ? rec.liveHistory : [];
  const head = `<div class="box-head"><div>
      <div class="box-iso">${escape(rec.iso)}</div>
      <div class="muted small">${escape(rec.size?.name || rec.kind)} · ${escape(rec.line || rec.owner)}</div>
      <div class="muted small">${escape(stateLabel(rec.state))}${rec.craneLabel ? ` · ${escape(rec.craneLabel)}` : ""}</div>
    </div><button type="button" class="box-close" data-act="close-box" title="Close" aria-label="Close">×</button></div>`;
  const facts = `<dl class="box-facts">
      <div><dt>Size / type</dt><dd>${escape(rec.size?.code)} · ${escape(rec.size?.name)}</dd></div>
      <div><dt>Weight</dt><dd>${fmtKg(wt?.gross)} kg gross · tare ${fmtKg(wt?.tare)} kg · cargo ${fmtKg(wt?.payload)} kg</dd></div>
      <div><dt>Line</dt><dd>${escape(rec.line)} (${escape(rec.ownerCode)})</dd></div>
      <div><dt>Commodity</dt><dd>${escape(rec.commodity)}</dd></div>
      <div><dt>Origin / destination</dt><dd>${escape(rec.origin)} → ${escape(rec.destination)}</dd></div>
      <div><dt>Inbound call</dt><dd>${rec.inbound?.vessel ? `${escape(rec.inbound.vessel)} · ${escape(rec.inbound.call || "")}${rec.inbound.berth != null ? ` · alongside ${escape(fmt(fmtFn, rec.inbound.berth))}` : ""}` : "—"}</dd></div>
      <div><dt>Outbound call</dt><dd>${rec.outbound?.vessel ? `${escape(rec.outbound.vessel)} · ${escape(rec.outbound.call || "")}${rec.outbound.berth != null ? ` · planned ${escape(fmt(fmtFn, rec.outbound.berth))}` : ""}` : "Not booked"}</dd></div>
      <div><dt>Stowage</dt><dd>${escape(rec.state === "yard" || rec.state === "quay" || rec.state === "transit" ? (rec.yard?.label || "On the apron") : (rec.stow?.label || "On board"))}</dd></div>
      <div><dt>Booking</dt><dd>${escape(rec.booking)}</dd></div>
    </dl>`;
  const relHtml = `<div class="box-rel"><div class="muted small">How it relates</div><ul>${rel.map((it) => {
    const act = it.kind === "box" ? "select-box" : it.kind === "vessel" ? "select-ship" : it.kind === "crane" ? "select-crane" : "select-slot";
    const key = it.kind === "box" || it.kind === "slot" ? it.recId : it.kind === "vessel" ? it.shipKey : String(it.craneIndex);
    return `<li><button type="button" class="box-link" data-act="${act}" data-id="${escape(key)}"><span class="muted">${escape(it.role)}</span> ${escape(it.label)}</button></li>`;
  }).join("") || "<li class='muted'>No related objects in this scene.</li>"}</ul></div>`;
  const histHtml = `<div class="box-hist"><div class="muted small">History <span class="sim-tag">simulated</span></div>
    <ol>${hist.map((e) => `<li class="${e.when}${e.kind === "live" ? " live" : ""}"><span class="box-h-time">${escape(e.clock)}</span> ${escape(e.text)}${e.when === "planned" ? " <span class='muted'>(planned)</span>" : ""}</li>`).join("")}</ol>
    <p class="muted small box-sim-note">Times follow the berth-chart clock and are simulated.</p></div>`;
  const load = canLoad ? `<button type="button" class="btn sm primary" data-act="load-box">Load onto ship</button>` : "";
  return `${head}${message ? `<p class="box-msg">${escape(message)}</p>` : ""}${relHtml}${facts}${histHtml}<div class="box-acts">${load}</div>`;
}

export function renderShipPanel(ship, { fmt: fmtFn, time } = {}) {
  const recs = ship.containers || [];
  const call = ship.call || "";
  const rows = recs.map((r) => `<li><button type="button" class="box-link" data-act="select-box" data-id="${escape(r.id)}"><span class="box-iso sm">${escape(r.iso)}</span> <span class="muted">${escape(r.size?.code || "")} · ${escape(stateLabel(r.state))}</span></button></li>`).join("") || "<li class='muted'>No containers on this call.</li>";
  return `<div class="box-head"><div>
      <b>${escape(ship.name)}</b>
      <div class="muted small">${escape(call)}</div>
      <div class="muted small">${recs.length} containers on this call</div>
    </div><button type="button" class="box-close" data-act="close-box" title="Close" aria-label="Close">×</button></div>
    <ul class="box-ship-list">${rows}</ul>
    <p class="muted small box-sim-note">Identities and history are simulated and follow the berth-chart clock${time != null && fmtFn ? ` (${escape(fmt(fmtFn, time))})` : ""}.</p>`;
}

function fmtKg(n) {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-IE");
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** World-space centre of a catalogue record at the current pose. */
export function recordWorldPos(rec, actors, target = _p) {
  if (rec.mesh && rec.inst != null) {
    rec.mesh.updateWorldMatrix(true, false);
    rec.mesh.getMatrixAt(rec.inst, _m);
    _m.decompose(target, _q, _s);
    target.applyMatrix4(rec.mesh.matrixWorld);
    return target;
  }
  if ((rec.state === "lifting" || rec.state === "transit" || rec.state === "quay") && rec._lastBox) {
    target.set(rec._lastBox.x, rec._lastBox.y, rec._lastBox.z);
    return target;
  }
  const actor = rec.ship && actors?.get(rec.ship);
  if (actor && rec.slot && rec.state === "aboard") {
    const p = rec.slot;
    actor.model.group.updateWorldMatrix(true, false);
    target.set(p.x, p.y, p.z);
    actor.model.group.localToWorld(target);
    return target;
  }
  if (rec.item?.p) {
    target.set(rec.item.p[0], rec.item.p[1], rec.item.p[2]);
    return target;
  }
  if (rec.yard && rec.item?.p) {
    target.set(rec.item.p[0], rec.item.p[1], rec.item.p[2]);
    return target;
  }
  return null;
}

export { stateLabel, callLabel, shipStow, yardAddress };
