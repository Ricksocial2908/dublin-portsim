// In-browser stand-in for the OpenEnv WebSocket (/ws) and a helper for the Task API
// when this build is hosted statically (Vercel has no long-lived WebSockets).
// Tool results and the grade use the same evaluatePlan() the Explorer already uses.
import { evaluatePlan, parsePlanArgs } from "./model.js";

const TOOLS = [
  { name: "get_situation", description: "the quay, notices, closures, ships to berth", input_schema: { type: "object", properties: {} } },
  { name: "check_plan", description: "rule breaks and cost per ship; 10 per episode", input_schema: { type: "object", properties: { plan: { type: "array" } }, required: ["plan"] } },
  { name: "submit_plan", description: "ends the episode with one grade", input_schema: { type: "object", properties: { plan: { type: "array" } }, required: ["plan"] } },
];

function wrap(observation, extra = {}) {
  return { type: "response", data: { observation, reward: extra.reward ?? 0, done: !!extra.done, metadata: extra.metadata || {} } };
}

function toolText(obj) {
  return { result: { content: [{ type: "text", text: JSON.stringify(obj) }] } };
}

function gradeOf(task, plan, ev, ref) {
  const opt = (ref && ref.optimal_cost) != null ? ref.optimal_cost : ev.cost;
  const unav = (ref && ref.unavoidable_cost) != null ? ref.unavoidable_cost : 0;
  const n = (task.ships || []).length || 1;
  const clean = ev.rows.filter((r) => r.placed && !r.conflicts.length).length;
  let reward;
  if (!ev.feasible) reward = 0.2 * (clean / n);
  else {
    const gap = (ev.cost - opt) / (opt - unav + 100);
    reward = 0.2 + 0.8 * Math.exp(-Math.max(0, gap) / 0.5);
    if (ev.cost <= opt) reward = 1;
  }
  return {
    feasible: ev.feasible,
    cost: ev.cost,
    reward,
    optimal_cost: opt,
    naive_cost: ref && ref.naive_cost,
    submitted: true,
  };
}

export class LocalEnv {
  constructor() {
    this.task = null;
    this.ref = null;
    this.checks = 0;
    this.calls = 0;
    this.done = false;
    this.maxChecks = 10;
    this.maxCalls = 24;
  }
  async handle(msg) {
    const type = msg && msg.type;
    if (type === "reset") return wrap(await this._reset(msg.data || {}));
    if (type === "state") return wrap({ task_id: this.task && this.task.task_id }, { done: this.done });
    if (type === "step") {
      const d = msg.data || {};
      if (d.type === "list_tools") return wrap({ tools: TOOLS });
      if (d.type === "call_tool") return this._call(d.tool_name, d.arguments || {});
    }
    if (type === "close") return wrap({}, { done: this.done });
    return { type: "error", data: { message: `unsupported ${type}` } };
  }
  async _reset(data) {
    const id = data.task_id;
    let task = null;
    if (id) {
      task = await fetch(`/api/tasks/${encodeURIComponent(id)}`).then((r) => {
        if (!r.ok) throw new Error(`task ${id}: ${r.status}`);
        return r.json();
      });
    } else {
      const split = data.split || "test";
      const index = data.index || 0;
      const list = await fetch("/api/tasks").then((r) => r.json());
      const pool = (Array.isArray(list) ? list : []).filter((t) => (t.split || "test") === split);
      const row = pool[index] || pool[0];
      if (!row) throw new Error("no tasks");
      task = await fetch(`/api/tasks/${encodeURIComponent(row.task_id)}`).then((r) => r.json());
    }
    this.task = task;
    this.ref = await fetch(`/api/tasks/${encodeURIComponent(task.task_id)}/reference`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    this.checks = 0;
    this.calls = 0;
    this.done = false;
    return {
      metadata: {
        task_id: task.task_id,
        split: task.split || "test",
        episode_id: `local-${task.task_id}-${Date.now().toString(36)}`,
        max_checks: this.maxChecks,
        max_tool_calls: this.maxCalls,
        tools: TOOLS.map((t) => t.name),
        instructions: "Re-plan the week. Use get_situation, check_plan (10), submit_plan once.",
      },
    };
  }
  _call(name, args) {
    if (!this.task) return { type: "error", data: { message: "no episode" } };
    if (this.done) return { type: "error", data: { message: "episode already ended" } };
    this.calls += 1;
    if (name === "get_situation") {
      const t = this.task;
      const text = {
        task_id: t.task_id,
        quay: t.quay,
        terminal: t.terminal,
        first_section: t.first_section,
        last_section: t.last_section,
        section_m: t.section_m,
        week: t.week,
        week_start_utc: t.week_start_utc,
        ships: t.ships,
        blocks: t.blocks,
        notices: t.notices,
        rules: t.rules,
      };
      return wrap(toolText(text));
    }
    if (name === "check_plan" || name === "submit_plan") {
      const plan = parsePlanArgs(args) || args.plan || [];
      const ev = evaluatePlan(this.task, plan);
      const violations = [];
      for (const iss of ev.issues || []) {
        for (const s of iss.ships || []) violations.push({ ship: s, problem: iss.problem });
      }
      const ships = (ev.rows || []).map((r) => ({
        ship: r.id,
        placed: r.placed,
        berth_hour: r.berth,
        section: r.section,
        cranes: r.cranes,
        cost: r.cost,
        conflicts: r.conflicts,
      }));
      if (name === "check_plan") {
        this.checks += 1;
        const body = {
          feasible: ev.feasible,
          cost: ev.cost,
          violations,
          ships,
          missing: ev.missing,
          checks_left: Math.max(0, this.maxChecks - this.checks),
        };
        return wrap(toolText(body));
      }
      const g = gradeOf(this.task, plan, ev, this.ref);
      this.done = true;
      const body = { ...g, submitted: true, violations, ships, missing: ev.missing };
      return wrap(toolText(body), { reward: g.reward, done: true, metadata: { grade: g, end_reason: "submitted" } });
    }
    return { type: "error", data: { message: `unknown tool ${name}` } };
  }
}

/** Task API fallback used when /berth_planning is not hosted. */
export async function localTaskApi(path, body) {
  if (path === "splits") {
    const list = await fetch("/api/tasks").then((r) => r.json());
    const by = new Map();
    for (const t of list) {
      const n = t.split || "test";
      by.set(n, (by.get(n) || 0) + 1);
    }
    return [...by.entries()].map(([name, num_tasks]) => ({ name, num_tasks }));
  }
  if (path === "task_range") {
    const list = await fetch("/api/tasks").then((r) => r.json());
    const split = (body && body.split) || "test";
    const start = (body && body.start) || 0;
    const stop = body && body.stop;
    const pool = list.filter((t) => (t.split || "test") === split);
    const slice = pool.slice(start, stop == null ? undefined : stop);
    const tasks = await Promise.all(slice.map((row) => fetch(`/api/tasks/${encodeURIComponent(row.task_id)}`).then((r) => r.json())));
    return { tasks };
  }
  throw new Error(`local Task API has no ${path}`);
}
