import { BERTHS, BERTH_BY_ID, TIDE } from "./port.js";
import { tideHeight, clockAt } from "./model.js";

const KIND_COLOR = {
  ferry: "#e2b84a", roro: "#e2b84a", container: "#4f8fce",
  tanker: "#c45c4a", cruise: "#d9c4a0", bulk: "#7a8f5a", small: "#8b9aa6",
};

export function kindColor(kind) {
  return KIND_COLOR[kind] || "#8b9aa6";
}

const VIEW = { x0: -280, y0: -980, x1: 4100, y1: 1180 };

export function createMap(canvas, { onBerth }) {
  const ctx = canvas.getContext("2d");
  let task = null, planRows = [], hour = 0, hover = null, selected = null;

  function worldToScreen(x, y) {
    const w = canvas.width, h = canvas.height;
    const sx = (x - VIEW.x0) / (VIEW.x1 - VIEW.x0);
    const sy = (VIEW.y1 - y) / (VIEW.y1 - VIEW.y0);
    return [sx * w, sy * h];
  }

  function drawPoly(pts, fill, stroke) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const [sx, sy] = worldToScreen(x, y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function label(x, y, text, color = "#c9d6de", align = "left") {
    const [sx, sy] = worldToScreen(x, y);
    ctx.fillStyle = color;
    ctx.font = "12px IBM Plex Sans, sans-serif";
    ctx.textAlign = align;
    ctx.fillText(text, sx, sy);
  }

  function berthRect(b) {
    const [x, y] = worldToScreen(b.x, b.y);
    const [x2, y2] = worldToScreen(b.x + (b.vertical ? b.w : b.w), b.y + (b.vertical ? b.h : b.h));
    return { x: Math.min(x, x2), y: Math.min(y, y2), w: Math.abs(x2 - x), h: Math.abs(y2 - y), b };
  }

  function activeBerths() {
    const ids = task && task.berth_ids;
    return BERTHS.filter((b) => b.id !== "mtl" && (!ids || ids.includes(b.id) || (ids.includes("mtl") && ["b41","b42","b43","b44","b45"].includes(b.id))));
  }

  function shipAtHour(rows, h) {
    return rows.filter((r) => r.placed && r.berth <= h && h < r.dep);
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#0c1b26");
    g.addColorStop(1, "#081118");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Dublin Bay / channel water
    drawPoly([[-400, -400], [4300, -400], [4300, 280], [3100, 220], [1500, 180], [200, 160], [-400, 140]], "#123044");
    // Tolka estuary
    drawPoly([[3000, 280], [4100, 280], [4100, 900], [3050, 820], [2980, 500]], "#0f3a3a");
    // North land
    drawPoly([[-400, 140], [200, 160], [700, 180], [700, 700], [1400, 700], [1400, 240], [2200, 260], [2600, 240],
      [2680, 620], [3100, 620], [3100, 220], [4300, 280], [4300, 1200], [-400, 1200]], "#18242c");
    // Alexandra Basin cut
    drawPoly([[720, 200], [1320, 200], [1320, 560], [860, 560], [860, 280], [720, 280]], "#123044");
    // DFT basin
    drawPoly([[2680, 230], [3100, 230], [3100, 500], [2680, 500]], "#123044");
    // South land / Poolbeg
    drawPoly([[-400, -400], [4300, -400], [4300, -1200], [-400, -1200], [-400, -220], [1800, -200], [3600, -200], [3600, -400]], "#18242c");
    // Great South Wall hint
    drawPoly([[3600, -220], [4100, -180], [4180, -260], [3600, -280]], "#2a3a34");

    // Channel fairway line
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    const fairway = [[80, 40], [1500, 80], [2500, 90], [4000, 80]];
    fairway.forEach((p, i) => {
      const [sx, sy] = worldToScreen(p[0], p[1]);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = "rgba(142,224,216,.35)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // East Link bridge
    const [bx1, by1] = worldToScreen(-20, 220);
    const [bx2, by2] = worldToScreen(40, -240);
    ctx.fillStyle = "#c9844a";
    ctx.fillRect(Math.min(bx1, bx2), Math.min(by1, by2), Math.abs(bx2 - bx1), Math.abs(by2 - by1));
    label(60, 300, "Tom Clarke", "#d3924f", "left");
    label(60, 250, "East Link", "#d3924f", "left");

    // Poolbeg chimneys
    const chim = [[3300, -420], [3380, -420]];
    chim.forEach(([x, y]) => {
      const [sx, sy] = worldToScreen(x, y);
      const [sx2, sy2] = worldToScreen(x + 28, y + 260);
      ctx.fillStyle = "#4a3a3a";
      ctx.fillRect(sx, Math.min(sy, sy2), Math.abs(sx2 - sx), Math.abs(sy2 - sy));
    });
    label(3480, -520, "Poolbeg", "#8b9aa6");

    label(3600, 700, "Tolka estuary", "#6ea8a0");
    label(200, -500, "City / Liffey", "#8b9aa6");
    label(4000, 40, "Dublin Bay", "#8ee0d8");
    label(1000, 640, "Alexandra Basin", "#8b9aa6");
    label(1600, 360, "Ocean Pier", "#8b9aa6");
    label(2800, 700, "DFT", "#8b9aa6");
    label(3300, 700, "Ferry terminals", "#8b9aa6");
    label(2200, -360, "MTL / Poolbeg", "#8b9aa6");

    const shown = task ? activeBerths() : BERTHS.filter((b) => b.id !== "mtl");
    const tide = task ? tideHeight(hour, task.rules) : TIDE.msl;
    for (const b of shown) {
      const r = berthRect(b);
      const live = task && task.berth_ids && (task.berth_ids.includes(b.id) || (task.berth_ids.includes("mtl") && b.area === "MTL Poolbeg"));
      ctx.fillStyle = live ? "rgba(58,168,160,.55)" : "rgba(80,100,110,.45)";
      if (hover && hover.id === b.id) ctx.fillStyle = "rgba(226,184,74,.7)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = live ? "#8ee0d8" : "#3a4a54";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "#e8eef2";
      ctx.font = "10px IBM Plex Sans, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(b.name.replace("Berth ", "B"), r.x + 3, r.y - 4 < 12 ? r.y + 12 : r.y - 4);
    }

    // Ships alongside
    if (task) {
      for (const r of shipAtHour(planRows, hour)) {
        const b = r.berthObj || BERTH_BY_ID[(r.ship.allowed_berths || [])[0]];
        if (!b || b.id === "mtl") {
          // place on MTL face
          const face = BERTH_BY_ID.b42;
          if (r.ship.allowed_berths && r.ship.allowed_berths.includes("mtl") && face) {
            drawShipOnBerth(face, r);
          }
          continue;
        }
        drawShipOnBerth(b, r);
      }
      // Approaching ships in the channel
      for (const r of planRows) {
        if (!r.placed) continue;
        const eta = r.berth - hour;
        if (eta > 0 && eta <= 6) {
          const x = 3900 - (6 - eta) * 280;
          drawShipIcon(x, 30, r, 0);
        } else if (!r.placed) {
          /* skip */
        } else if (hour < r.ship.arrival && r.ship.arrival - hour <= 8) {
          const eta = r.ship.arrival - hour;
          const x = 3900 - (8 - eta) * 200;
          drawShipIcon(x, -20, r, 0);
        }
      }
    }

    // Tide staff
    ctx.fillStyle = "rgba(10,16,20,.75)";
    ctx.fillRect(w - 86, 16, 70, 150);
    ctx.strokeStyle = "#3aa8a0";
    ctx.strokeRect(w - 86, 16, 70, 150);
    const tMin = -0.2, tMax = 4.7;
    const ty = 150 - ((tide - tMin) / (tMax - tMin)) * 130;
    ctx.fillStyle = "#1c4460";
    ctx.fillRect(w - 72, 26 + ty, 22, 150 - 16 - (26 + ty - 16));
    ctx.fillStyle = "#8ee0d8";
    ctx.font = "11px IBM Plex Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${tide.toFixed(2)} m`, w - 51, 32);
    ctx.fillText("CD", w - 51, 156);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,238,242,.7)";
    ctx.font = "12px IBM Plex Sans, sans-serif";
    ctx.fillText(task ? clockAt(task, hour) : "", 12, h - 12);
  }

  function drawShipOnBerth(b, r) {
    const along = b.vertical ? { x: b.x - 8, y: b.y + 10 } : { x: b.x + 8, y: b.y - 36 };
    drawShipIcon(along.x, along.y, r, b.vertical ? -Math.PI / 2 : 0);
  }

  function drawShipIcon(x, y, r, rot) {
    const [sx, sy] = worldToScreen(x, y);
    const len = Math.max(28, Math.min(90, (r.ship.length_m || 120) * 0.22));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.fillStyle = kindColor(r.ship.kind === "roro" ? "ferry" : r.ship.kind);
    ctx.beginPath();
    ctx.moveTo(-len / 2, -7);
    ctx.lineTo(len / 2 - 10, -7);
    ctx.lineTo(len / 2, 0);
    ctx.lineTo(len / 2 - 10, 7);
    ctx.lineTo(-len / 2, 7);
    ctx.closePath();
    ctx.fill();
    if (selected === r.id) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = "#0b1218";
    ctx.font = "10px IBM Plex Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText((r.ship.display_name || r.ship.name).slice(0, 16), 0, 3);
    ctx.restore();
  }

  function hitBerth(mx, my) {
    for (const b of (task ? activeBerths() : BERTHS)) {
      const r = berthRect(b);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return b;
    }
    return null;
  }

  function pointerPos(ev) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY];
  }

  canvas.addEventListener("mousemove", (ev) => {
    const [mx, my] = pointerPos(ev);
    hover = hitBerth(mx, my);
    canvas.style.cursor = hover ? "pointer" : "crosshair";
    draw();
  });
  canvas.addEventListener("click", (ev) => {
    const [mx, my] = pointerPos(ev);
    const b = hitBerth(mx, my);
    if (!b || !onBerth) return;
    const mtlIds = ["b41", "b42", "b43", "b44", "b45"];
    if (task && task.berth_ids && task.berth_ids.includes("mtl") && mtlIds.includes(b.id)) onBerth(BERTH_BY_ID.mtl);
    else onBerth(b);
  });

  return {
    set({ task: t, rows, hour: hr, selectedId }) {
      task = t; planRows = rows || []; hour = hr || 0; selected = selectedId;
      draw();
    },
    draw,
  };
}

export const LEGEND = [
  ["ferry", "RoRo / ferry"],
  ["container", "Container"],
  ["tanker", "Tanker"],
  ["cruise", "Cruise"],
  ["bulk", "Bulk"],
];
