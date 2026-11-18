import { BERTHS, BERTH_BY_ID } from "./port.js";
import { clockAt } from "./model.js";
import { kindColor } from "./map.js";

export function scenarioBerths(task) {
  const ids = task.berth_ids || [];
  const list = [];
  for (const id of ids) {
    if (id === "mtl") {
      const m = BERTH_BY_ID.mtl;
      for (let s = m.first_section; s <= m.last_section; s++) {
        list.push({ id: "mtl", section: s, name: `MTL §${s}`, berth: m });
      }
    } else {
      const b = BERTH_BY_ID[id];
      if (!b) continue;
      for (let s = b.first_section; s <= b.last_section; s++) {
        const label = b.sectional ? `${b.name} §${s}` : b.name;
        list.push({ id: b.id, section: s, name: label, berth: b });
      }
    }
  }
  return list;
}

export function createChart(wrap, { onPlace, onSelect, onMove }) {
  const canvas = document.createElement("canvas");
  canvas.className = "chart-canvas";
  wrap.innerHTML = "";
  wrap.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const rowH = 26;
  const labelW = 128;
  const hourW = 16;
  let task = null, rows = [], hour = 0, selected = null, drag = null, hover = null;

  function layout() {
    const lanes = task ? scenarioBerths(task) : [];
    const horizon = Math.max(task?.horizon || 168, hour + 24);
    const width = labelW + horizon * hourW + 24;
    const height = 28 + lanes.length * rowH + 16;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { lanes, horizon, width, height };
  }

  function xOf(h) { return labelW + h * hourW; }
  function yOf(i) { return 28 + i * rowH; }

  function draw() {
    if (!task) return;
    const { lanes, horizon, width, height } = layout();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0e171e";
    ctx.fillRect(0, 0, width, height);

    // hours
    for (let h = 0; h <= horizon; h++) {
      const x = xOf(h);
      const day = h % 24 === 0;
      ctx.fillStyle = day ? "rgba(58,168,160,.12)" : (h % 6 === 0 ? "rgba(255,255,255,.03)" : "transparent");
      if (day) ctx.fillRect(x, 0, 24 * hourW, height);
      ctx.strokeStyle = day ? "rgba(142,224,216,.35)" : "rgba(42,61,76,.6)";
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      if (h % 6 === 0) {
        ctx.fillStyle = "#8b9aa6";
        ctx.font = "10px IBM Plex Sans, sans-serif";
        ctx.fillText(String(h), x + 2, 12);
      }
    }

    // blocks (closures)
    for (const b of task.blocks || []) {
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i].section >= b.first && lanes[i].section <= b.last) {
          ctx.fillStyle = "rgba(224,106,92,.18)";
          ctx.fillRect(xOf(b.start), yOf(i), (b.end - b.start) * hourW, rowH - 2);
        }
      }
    }
    // no-move windows
    for (const w of (task.rules && task.rules.no_moves) || []) {
      ctx.fillStyle = "rgba(226,184,74,.08)";
      ctx.fillRect(xOf(w.start), 28, (w.end - w.start) * hourW, lanes.length * rowH);
    }

    lanes.forEach((lane, i) => {
      ctx.fillStyle = "#15202a";
      ctx.fillRect(0, yOf(i), labelW, rowH - 2);
      ctx.fillStyle = "#c9d6de";
      ctx.font = "11px IBM Plex Sans, sans-serif";
      ctx.fillText(lane.name, 6, yOf(i) + 16);
    });

    for (const r of rows) {
      if (!r.placed) continue;
      for (let sec = r.section; sec <= r.last; sec++) {
        const i = lanes.findIndex((l) => l.section === sec);
        if (i < 0) continue;
        const x = xOf(r.berth);
        const w = (r.dep - r.berth) * hourW;
        ctx.fillStyle = kindColor(r.ship.kind === "roro" ? "ferry" : r.ship.kind);
        if (r.conflicts.length) ctx.fillStyle = "#c45c4a";
        ctx.globalAlpha = selected != null && selected !== r.id ? 0.45 : 0.92;
        ctx.fillRect(x, yOf(i) + 3, Math.max(w, 2), rowH - 8);
        ctx.globalAlpha = 1;
        if (selected === r.id) {
          ctx.strokeStyle = "#fff";
          ctx.strokeRect(x, yOf(i) + 3, Math.max(w, 2), rowH - 8);
        }
        if (sec === r.section && w > 36) {
          ctx.fillStyle = "#0b1218";
          ctx.font = "10px IBM Plex Sans, sans-serif";
          ctx.fillText((r.ship.display_name || r.ship.name).slice(0, Math.floor(w / 6)), x + 3, yOf(i) + 16);
        }
      }
    }

    // playhead
    const px = xOf(hour);
    ctx.strokeStyle = "#8ee0d8";
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke();
  }

  function pos(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function cellAt(px, py) {
    const lanes = scenarioBerths(task);
    const h = Math.floor((px - labelW) / hourW);
    const i = Math.floor((py - 28) / rowH);
    if (i < 0 || i >= lanes.length || h < 0) return null;
    return { hour: h, lane: lanes[i] };
  }

  function shipAt(px, py) {
    const c = cellAt(px, py);
    if (!c) return null;
    return rows.find((r) => r.placed && r.section <= c.lane.section && c.lane.section <= r.last && r.berth <= c.hour && c.hour < r.dep) || null;
  }

  canvas.addEventListener("mousedown", (ev) => {
    if (!task) return;
    const p = pos(ev);
    const hit = shipAt(p.x, p.y);
    if (hit) {
      drag = { id: hit.id, startHour: hit.berth, origin: p.x, section: hit.section };
      if (onSelect) onSelect(hit.id);
    } else {
      const c = cellAt(p.x, p.y);
      if (c && onPlace) onPlace(c.lane.section, c.hour);
    }
  });
  window.addEventListener("mousemove", (ev) => {
    if (!drag) return;
    const p = pos(ev);
    const dh = Math.round((p.x - drag.origin) / hourW);
    if (onMove) onMove(drag.id, drag.startHour + dh, drag.section);
  });
  window.addEventListener("mouseup", () => { drag = null; });

  return {
    set(state) {
      task = state.task; rows = state.rows || []; hour = state.hour || 0; selected = state.selectedId;
      draw();
    },
    draw,
  };
}
