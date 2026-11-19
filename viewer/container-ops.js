// Click-to-discharge (and optional load-back) for individual containers. Reuses
// the original cargo choreography so the STS trolley, spreader and quay handoff
// match the automatic replay; the clock for a clicked lift runs in real time
// so the move is visible even when the berth chart is playing at many hours/s.
import * as THREE from "three";
import { cargoRoute, cargoState, makeCargoJob, routePose } from "./cargo-handling.js";
import { BOX_H, BOX_L, BOX_W } from "./scene-world.js";
import { containerMesh, setInstance, vcMat, Parts } from "./scene-kit.js";

const _world = new THREE.Vector3();
const MAX_LIFTS = 8;
const SPEED = 0.28; // real-time scale of the original cycle (~20 s to the quay)

export function slotWorld(actor, slot, target = _world) {
  target.set(slot.x, slot.y, slot.z);
  actor.model.group.updateWorldMatrix(true, false);
  actor.model.group.localToWorld(target);
  return target;
}

export function scaleJob(job, scale) {
  const s0 = job.mark.start;
  for (const k of Object.keys(job.mark)) job.mark[k] = s0 + (job.mark[k] - s0) * scale;
  job.duration *= scale;
  return job;
}

export function stackAbove(slots, slot) {
  return slots
    .filter((s) => Math.abs(s.x - slot.x) < 0.05 && Math.abs(s.z - slot.z) < 0.05 && s.t > slot.t)
    .sort((a, b) => b.t - a.t);
}

function nearestSlot(slots, x) {
  if (!slots.length) return null;
  let best = slots[0], d = Infinity;
  for (const s of slots) {
    const dx = Math.abs((s.p ? s.p[0] : s.x) - x);
    if (dx < d) { d = dx; best = s; }
  }
  return best;
}

export function formatSimClock(fmt, hour) {
  try { return fmt ? fmt(hour) : `h ${hour.toFixed(2)}`; } catch { return `h ${hour.toFixed(2)}`; }
}

export function containerTitle(rec) {
  const bay = rec.slot != null ? `bay ${rec.slot.x > 0 ? "+" : ""}${rec.slot.x.toFixed(0)} m, tier ${rec.slot.t + 1}` : "yard";
  return `${rec.kind || "Container"} · ${rec.shipName || rec.ship}${rec.slot ? ` · ${bay}` : ""}`;
}

export function renderBoxPanel(rec, { canLoad = false, message = "" } = {}) {
  const hist = (rec.history || []).map((e) => `<li>${escape(e)}</li>`).join("") || "<li class='muted'>No events yet.</li>";
  const load = canLoad ? `<button type="button" class="btn sm primary" data-act="load-box">Load onto ship</button>` : "";
  return `<div class="box-head"><div><b>${escape(containerTitle(rec))}</b><div class="muted small">${escape(stateLabel(rec.state))}${rec.craneLabel ? ` · ${escape(rec.craneLabel)}` : ""}</div></div><button type="button" class="box-close" data-act="close-box" title="Close" aria-label="Close">×</button></div>
    ${message ? `<p class="box-msg">${escape(message)}</p>` : ""}
    <div class="box-hist"><div class="muted small">History</div><ol>${hist}</ol></div>
    <div class="box-acts">${load}</div>`;
}

function stateLabel(s) {
  return ({ aboard: "On board", lifting: "On the spreader", quay: "On the quay", transit: "To the yard", yard: "In the yard", loading: "Loading" })[s] || s;
}
function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createLiftLayer() {
  const root = new THREE.Group();
  root.name = "interactive-lifts";
  const items = Array.from({ length: MAX_LIFTS }, () => ({ p: [0, -200, 0], s: [0, 0, 0], c: "#C4472A", b: 0, k: 0 }));
  const boxes = containerMesh(items);
  boxes.frustumCulled = false;
  boxes.geometry.userData.shared = false;
  root.add(boxes);
  const p = new Parts();
  p.box(0, 1.1, 0, 13.2, 1.4, 3.4, "#E4E3DE");
  p.box(-3.2, 2.5, 0, 3.2, 1.6, 2.6, "#596773");
  for (const x of [-5.4, 5.4]) for (const z of [-1.3, 1.3]) p.cylZ(x, 0.55, z, 0.55, 0.45, "#202427", 10);
  const carriers = new THREE.InstancedMesh(p.geometry(), vcMat, MAX_LIFTS);
  carriers.count = MAX_LIFTS;
  carriers.frustumCulled = false;
  carriers.castShadow = true;
  root.add(carriers);
  return { root, boxes, carriers };
}

export function hideLiftSlot(layer, i) {
  setInstance(layer.boxes, i, 0, -200, 0, 0, 0, 0, 0);
  setInstance(layer.carriers, i, 0, -200, 0, 0, 0, 0, 0);
}

export function writeLiftVisual(layer, i, rec, state) {
  const b = state.box;
  if (state.owner === "ship") hideLiftSlot(layer, i);
  else setInstance(layer.boxes, i, b.x, b.y, b.z, b.ry || 0, BOX_L, BOX_H, Math.min(BOX_W, rec.slot.w || BOX_W));
  const c = state.carrier;
  if (c && (state.owner === "quay" || state.owner === "carrier" || state.owner === "yard" && rec.state !== "yard")) {
    setInstance(layer.carriers, i, c.x, 0.34, c.z, c.ry || 0);
  } else if (c && rec.state === "loading" && state.owner !== "ship") {
    setInstance(layer.carriers, i, c.x, 0.34, c.z, c.ry || 0);
  } else setInstance(layer.carriers, i, 0, -200, 0, 0, 0, 0, 0);
}

export function pickDestination(world, sourceX, used) {
  const slots = (world.transferSlots || []).filter((s) => !used.has(s.corridor + ":" + (s.p && s.p.join(","))));
  const dest = nearestSlot(slots.length ? slots : world.transferSlots || [], sourceX);
  if (dest) return dest;
  const z = (world.cargoRoadZ ?? -80);
  return { p: [sourceX, 0.34 + BOX_H / 2, z - 12], via: [sourceX, z], ry: 0, travelY: 9.2, corridor: `click-${sourceX.toFixed(0)}`, depth: 12 };
}

/** Build a ship → yard job whose marks run from t=0 in real seconds (after scale). */
export function dischargeJob({ rec, source, destination, laneZ, roadZ, clearY }) {
  const job = makeCargoJob({
    id: rec.id,
    ship: rec.ship,
    slot: rec.slot,
    source,
    destination,
    start: 0,
    laneZ,
    roadZ,
    clearY,
  });
  return scaleJob(job, SPEED);
}

/** Yard/quay → ship, using a reversed choreography on the same marks. */
export function loadState(job, t) {
  // Run the discharge machine backwards: t=0 at the yard, t=duration back on the ship.
  const u = job.duration - t;
  const s = cargoState(job, Math.max(0, u));
  const phaseMap = {
    Stored: "Collected from yard",
    "Stacking in yard": "Lifting from the stack",
    "Carrier to yard": "Carrier to quay",
    "Carrier lifting": "Carrier lowering",
    "Quay handoff": "Ready on the quay",
    "Unlocking spreader": "Locking twistlocks",
    "Lowering to quay": "Hoisting off the quay",
    "Trolley to quay": "Trolley to ship",
    "Hoisting clear": "Lowering into the cell",
    "Locking twistlocks": "Unlocking spreader",
    "Lowering spreader": "Raising empty spreader",
    ready: "Complete",
  };
  let owner = s.owner;
  if (t >= job.duration) { owner = "ship"; s.phase = "Complete"; s.box = { ...job.source }; }
  else s.phase = phaseMap[s.phase] || s.phase;
  return { ...s, owner, phase: s.phase };
}

export function assignCraneIndex(cranes, lifts, worldX) {
  let best = 0, dist = Infinity;
  cranes.forEach((c, i) => {
    const busy = lifts.some((L) => L.craneIndex === i && L.active && L.mode === "discharge" && L.elapsed < (L.job.mark.clear || 0) + 1);
    if (busy) return;
    const d = Math.abs((c.st?.x ?? 0) - worldX);
    if (d < dist) { dist = d; best = i; }
  });
  return best;
}
