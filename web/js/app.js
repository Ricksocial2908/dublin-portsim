import { BERTH_BY_ID, berthForSection, sectionsNeeded } from "./port.js";
import {
  evaluatePlan, grade, publishedPlan, clockAt, tideHeight, horizonOf, hasCranes, handlingFor,
} from "./model.js";
import { naiveReplan } from "./solver.js";
import { createMap, LEGEND, kindColor } from "./map.js";
import { createChart } from "./chart.js";

const $ = (id) => document.getElementById(id);

const state = {
  tasks: [],
  task: null,
  plan: [],
  ev: null,
  submitted: null,
  hour: 0,
  playing: false,
  selected: null,
  lastCheck: 0,
};

const map = createMap($("map"), {
  onBerth(berth) {
    if (!berth || state.selected == null) return;
    placeSelected(berth.first_section, state.hour);
  },
});
const chart = createChart($("chart-wrap"), {
  onPlace(section, hour) { placeSelected(section, hour); },
  onSelect(id) { state.selected = id; render(); },
  onMove(id, hour, section) {
    const ship = state.task.ships.find((s) => s.id === id);
    if (!ship) return;
    const h = Math.max(ship.arrival, hour);
    upsert(id, h, section);
    render();
  },
});

function placeSelected(section, hour) {
  if (state.selected == null || !state.task) return;
  const ship = state.task.ships.find((s) => s.id === state.selected);
  if (!ship) return;
  const berth = berthForSection(section);
  if (!berth) return;
  if (ship.allowed_berths && !ship.allowed_berths.includes(berth.id)) return;
  const first = berth.sectional ? Math.min(section, berth.last_section - ship.sections + 1) : berth.first_section;
  upsert(ship.id, Math.max(hour, ship.arrival), Math.max(berth.first_section, first), ship.std_cranes);
  render();
}

function upsert(id, hour, section, cranes) {
  const ship = state.task.ships.find((s) => s.id === id);
  const entry = { ship: id, berth_hour: hour, section };
  if (hasCranes(state.task) && ship && ship.min_cranes != null) entry.cranes = cranes ?? ship.std_cranes;
  const i = state.plan.findIndex((p) => p.ship === id);
  if (i >= 0) state.plan[i] = entry; else state.plan.push(entry);
  state.submitted = null;
}

function loadTask(id) {
  const task = state.tasks.find((t) => t.task_id === id) || state.tasks[0];
  state.task = task;
  state.plan = publishedPlan(task);
  state.submitted = null;
  state.hour = 0;
  state.selected = task.ships[0]?.id ?? null;
  $("blurb").textContent = task.blurb;
  $("meta").innerHTML = `
    <div><strong>${task.terminal}</strong> · ${task.quay}</div>
    <div>Week ${task.week} starting ${task.week_start_iso.slice(0, 10)} (illustrative) · ${task.difficulty} · ${task.ships.length} ships</div>
    <div>Best-known feasible cost ${task.reference.best_known_cost ?? "–"} (heuristic) · unavoidable ${task.reference.unavoidable_cost}</div>`;
  $("notices").innerHTML = task.notices.map((n) => `<li>${escapeHtml(n)}</li>`).join("");
  const horizon = horizonOf(task, [state.plan]);
  $("time").max = String(horizon);
  $("time").value = "0";
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function currentEval() {
  state.ev = evaluatePlan(state.task, state.plan);
  return state.ev;
}

function render() {
  if (!state.task) return;
  const ev = currentEval();
  const tide = tideHeight(state.hour, state.task.rules);
  $("clock").textContent = clockAt(state.task, state.hour);
  $("tide").textContent = `Tide ${tide.toFixed(2)} m CD`;
  $("time").value = String(state.hour);
  $("btn-play").textContent = state.playing ? "Pause" : "Play";

  const g = state.submitted;
  const score = $("score");
  const line = $("score-line");
  if (g) {
    score.className = "score " + (g.feasible ? "ok" : "bad");
    line.textContent = `Submitted reward ${g.reward.toFixed(3)} · cost ${g.cost ?? "–"} · ${g.feasible ? "feasible" : "infeasible"}`;
  } else {
    score.className = "score " + (ev.feasible ? "ok" : "bad");
    const miss = ev.missing.length ? `, ${ev.missing.length} unplaced` : "";
    line.textContent = ev.feasible
      ? `Feasible draft · cost ${ev.cost} (delay ${ev.delayCost}, ${ev.moves} moves)`
      : `Infeasible draft · ${ev.issues.length} violations${miss} · running cost ${ev.cost}`;
  }

  const issuesWrap = $("issues-wrap");
  if (ev.issues.length || ev.missing.length) {
    issuesWrap.hidden = false;
    const missing = ev.missing.length ? ev.missing.map((id) => {
      const s = state.task.ships.find((x) => x.id === id);
      return `<li>${escapeHtml((s && (s.display_name || s.name)) || id)} is not placed</li>`;
    }).join("") : "";
    $("issues").innerHTML = ev.issues.slice(0, 20).map((i) => `<li>${escapeHtml(i.problem)}</li>`).join("") + missing;
  } else {
    issuesWrap.hidden = true;
  }

  map.set({ task: state.task, rows: ev.rows, hour: state.hour, selectedId: state.selected });
  chart.set({ task: state.task, rows: ev.rows, hour: state.hour, selectedId: state.selected });
  renderTable(ev);
}

function renderTable(ev) {
  const cr = hasCranes(state.task);
  const head = $("ships-table").querySelector("thead");
  const body = $("ships-table").querySelector("tbody");
  const cols = ["", "Ship", "Type", "LOA m", "Draught", "From", "Arrives", "Due", "Berth", "Stay", cr ? "Cranes" : null, "Delay", "Cost", "Status"].filter(Boolean);
  head.innerHTML = `<tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>`;
  body.innerHTML = ev.rows.map((r) => {
    const s = r.ship;
    const berth = r.berthObj ? r.berthObj.name : (r.placed ? `§${r.section}` : "—");
    const status = !r.placed ? "unplaced" : r.conflicts.length ? r.conflicts[0] : "ok";
    const cls = state.selected === s.id ? "sel" : "";
    const flag = !r.placed || r.conflicts.length ? "bad" : "ok";
    const cranes = cr && s.min_cranes != null ? (r.cranes ?? s.std_cranes) : "—";
    return `<tr class="${cls} ${flag}" data-id="${s.id}">
      <td><input type="radio" name="ship" ${state.selected === s.id ? "checked" : ""} /></td>
      <td>${escapeHtml(s.display_name || s.name)}</td>
      <td><span class="pill ${s.kind === "roro" ? "ferry" : s.kind}">${escapeHtml(s.kind)}</span></td>
      <td>${s.length_m}</td>
      <td>${s.draught_m ?? "—"}</td>
      <td>${escapeHtml(s.from_port || "")}</td>
      <td>${clockAt(state.task, s.arrival)}</td>
      <td>${clockAt(state.task, s.due)}</td>
      <td>${escapeHtml(berth)}${r.placed ? ` @ ${r.berth}h` : ""}</td>
      <td>${r.placed ? r.work : s.handling}h</td>
      ${cr ? `<td>${cranes}</td>` : ""}
      <td>${r.delay ?? "—"}</td>
      <td>${r.cost ?? "—"}</td>
      <td title="${escapeHtml(r.conflicts.join("; "))}">${escapeHtml(status)}</td>
    </tr>`;
  }).join("");
  body.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => {
      state.selected = Number(tr.dataset.id);
      render();
    });
  });
}

$("scenario").addEventListener("change", (e) => loadTask(e.target.value));
$("btn-check").addEventListener("click", () => { state.submitted = null; render(); });
$("btn-submit").addEventListener("click", () => {
  const ev = currentEval();
  state.submitted = grade(state.task, ev);
  render();
});
$("btn-reset").addEventListener("click", () => {
  state.plan = publishedPlan(state.task);
  state.submitted = null;
  render();
});
$("btn-naive").addEventListener("click", () => {
  state.plan = naiveReplan(state.task);
  state.submitted = null;
  render();
});
$("time").addEventListener("input", (e) => {
  state.hour = Number(e.target.value);
  render();
});
$("btn-play").addEventListener("click", () => {
  state.playing = !state.playing;
  render();
});
$("btn-about").addEventListener("click", () => $("dlg-about").showModal());
$("btn-sources").addEventListener("click", () => $("dlg-sources").showModal());

let lastTs = 0;
function tick(ts) {
  if (state.playing && state.task) {
    const speed = Number($("speed").value) || 4;
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    if (dt > 0.25) {
      lastTs = ts;
      const horizon = Number($("time").max);
      state.hour = Math.min(horizon, state.hour + speed * dt * 0.8);
      if (state.hour >= horizon) state.playing = false;
      render();
    }
  } else lastTs = ts;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

$("legend").innerHTML = LEGEND.map(([k, label]) => `<span><i style="background:${kindColor(k)}"></i>${label}</span>`).join("");

const tasksUrl = new URL("../data/tasks.json", import.meta.url);
const res = await fetch(tasksUrl);
if (!res.ok) throw new Error("Could not load scenarios");
state.tasks = await res.json();
const sel = $("scenario");
sel.innerHTML = state.tasks.map((t) => `<option value="${t.task_id}">${t.title} · ${t.difficulty}</option>`).join("");
loadTask(state.tasks[0].task_id);
