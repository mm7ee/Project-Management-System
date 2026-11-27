/** @import { ItemContext, ItemRow } from './workitems' */
/** @import { WorkCalendar, SlaTarget } from '../src/data/workCalendar' */
/** @import { Alert } from './notify' */
// SLAs for work items (Settings → This workspace → SLAs): targets for the first response and for resolution, in the
// organisation's working hours (src/data/workCalendar.js), for some item types and priorities or all. The first
// matching policy (in order) applies to an item.
//   First response: the first comment, or status change, by someone other than the reporter.
//   Resolution: the item reaching a Done status.
// Every cron run (every 5 minutes) looks at the workspace's open items: when a target reaches its warning point, the
// assignee is told; when it's breached, the assignee and the workspace's administrators are. Each happens once per
// item and target (item_sla_events), and also sets off automation rules ("An SLA is about to be breached",
// "An SLA was breached").
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { raise } from "./notify";
import { slaTarget } from "../src/data/workCalendar";
import { WORK_PRIORITIES } from "../src/data/workitems";

export const SLA_ITEMS_PER_RUN = 500;

/**
 * The organisation's working time, read through a workspace's (or the organisation's) handle.
 * @param {D1Database} db
 * @returns {Promise<WorkCalendar>}
 */
export async function loadCalendar(db) {
  const orgId = /** @type {Scope} */ (/** @type {TenantDatabase} */ (/** @type {unknown} */ (db)).scope).orgId;
  const [o, h] = await Promise.all([
    /** @type {Promise<{ time_zone: string; work_days: string; work_start: string; work_end: string } | null>} */ (db.prepare("SELECT time_zone, work_days, work_start, work_end FROM organizations WHERE id = ?").bind(orgId).first()),
    /** @type {Promise<D1Result<{ day: string }>>} */ (db.prepare("SELECT day FROM public_holidays").all()),
  ]);
  return {
    timeZone: o?.time_zone ?? "Africa/Harare",
    workDays: String(o?.work_days ?? "1,2,3,4,5")
      .split(",")
      .map(Number),
    start: o?.work_start ?? "08:00",
    end: o?.work_end ?? "17:00",
    holidays: new Set(h.results.map((r) => r.day)),
  };
}

/**
 * @typedef {{ id: string; name: string; itemTypes: string[] | null; priorities: string[] | null; firstResponseMinutes: number | null; resolutionMinutes: number | null; warnPercent: number; position: number; active: boolean }} SlaPolicy
 */
/** @param {D1Database} db @returns {Promise<SlaPolicy[]>} */
export async function loadPolicies(db) {
  const rows = /** @type {Record<string, unknown>[]} */ ((await db.prepare("SELECT * FROM sla_policies ORDER BY position, name").all()).results);
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    itemTypes: r.item_types ? JSON.parse(String(r.item_types)) : null,
    priorities: r.priorities ? JSON.parse(String(r.priorities)) : null,
    firstResponseMinutes: r.first_response_minutes == null ? null : Number(r.first_response_minutes),
    resolutionMinutes: r.resolution_minutes == null ? null : Number(r.resolution_minutes),
    warnPercent: Number(r.warn_percent),
    position: Number(r.position),
    active: !!r.active,
  }));
}
/** The first active policy for an item. @param {SlaPolicy[]} policies @param {{ item_type?: string; type: string; priority: string }} r */
export function policyFor(policies, r) {
  return policies.find((p) => p.active && (!p.itemTypes || p.itemTypes.includes(r.item_type ?? r.type)) && (!p.priorities || p.priorities.includes(r.priority))) ?? null;
}

/**
 * An item's SLA: its policy and each target's state, or null if no policy applies. Service desk requests have their
 * own SLAs and are left out.
 * @param {D1Database} db
 * @param {ItemRow} r
 * @param {{ cal?: WorkCalendar; policies?: SlaPolicy[]; now?: number }} [o]
 * @returns {Promise<{ policy: { id: string; name: string }; response?: SlaTarget; resolution?: SlaTarget } | null>}
 */
export async function slaFor(db, r, o = {}) {
  if (r.source === "service_desk") return null;
  const policy = policyFor(o.policies ?? (await loadPolicies(db)), r);
  if (!policy) return null;
  const cal = o.cal ?? (await loadCalendar(db));
  const now = o.now ?? Date.now();
  const start = Date.parse(r.created_at);
  /** @type {{ policy: { id: string; name: string }; response?: SlaTarget; resolution?: SlaTarget }} */ const out = { policy: { id: policy.id, name: policy.name } };
  if (policy.firstResponseMinutes) {
    const first = /** @type {{ at: string | null } | null} */ (
      await db
        .prepare(
          `SELECT MIN(at) AS at FROM (
             SELECT created_at AS at FROM work_item_comments WHERE item_id = ? AND author_id IS NOT NULL AND author_id <> ?
             UNION ALL SELECT changed_at AS at FROM status_history WHERE item_id = ? AND changed_by IS NOT NULL AND changed_by <> ?
           ) x`,
        )
        .bind(r.id, r.reporter, r.id, r.reporter)
        .first()
    );
    out.response = slaTarget({ target: "response", start, stoppedAt: first?.at ? Date.parse(first.at) : null, now, targetMinutes: policy.firstResponseMinutes, warnPercent: policy.warnPercent, cal });
  }
  if (policy.resolutionMinutes) {
    const done = /** @type {{ status_category?: string }} */ (/** @type {unknown} */ (r)).status_category === "DONE" && r.resolved_at ? Date.parse(r.resolved_at) : null;
    out.resolution = slaTarget({ target: "resolution", start, stoppedAt: done, now, targetMinutes: policy.resolutionMinutes, warnPercent: policy.warnPercent, cal });
  }
  return out;
}

/**
 * The cron: open items reaching their warning point or breaching. Each event once per item and target.
 * @param {Env} env  scoped to a workspace
 * @param {(e: import('./workitems').ItemEvent) => Promise<void>} [onEvent]  sets off automation
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>}  how many events
 */
export async function runWorkItemSla(env, onEvent, now = Date.now()) {
  const db = env.DB;
  const policies = (await loadPolicies(db)).filter((p) => p.active);
  if (!policies.length) return 0;
  const cal = await loadCalendar(db);
  const { SELECT } = await import("./workitems");
  const rows = /** @type {ItemRow[]} */ (
    (await db.prepare(`${SELECT} WHERE st.category <> 'DONE' AND w.source <> 'service_desk' ORDER BY w.created_at DESC LIMIT ?`).bind(SLA_ITEMS_PER_RUN).all()).results
  );
  const admins = /** @type {{ id: string }[]} */ ((await db.prepare("SELECT id FROM users WHERE role = 'admin' AND deactivated_at IS NULL").all()).results).map((u) => u.id);
  let n = 0;
  for (const r of rows) {
    const s = await slaFor(db, r, { cal, policies, now });
    if (!s) continue;
    for (const t of [s.response, s.resolution]) {
      if (!t || (t.state !== "warning" && t.state !== "breached")) continue;
      const event = t.state === "breached" ? "breached" : "warning";
      const first = await db
        .prepare("INSERT INTO item_sla_events (item_id, target, event, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING item_id")
        .bind(r.id, t.target, event, new Date(now).toISOString())
        .first();
      if (!first) continue;
      n += 1;
      const key = `${r.project_key}-${r.number}`;
      const what = t.target === "response" ? "first response" : "resolution";
      const to = new Set([...(r.assignee ? [r.assignee] : []), ...(event === "breached" ? admins : [])]);
      /** @type {Alert[]} */ const alerts = [...to].map((userId) => ({
        userId,
        kind: "sla",
        title: event === "breached" ? `SLA breached: ${key}'s ${what}` : `SLA at risk: ${key}'s ${what} is due soon`,
        body: `${key} ${r.summary}`.slice(0, 500),
        link: `#/projects/${r.system_id}/items/${key}`,
        dedupe: `sla:${r.id}:${t.target}:${event}`,
      }));
      if (alerts.length) await raise(env, alerts).catch(() => undefined);
      if (onEvent) await onEvent({ type: event === "breached" ? "sla_breached" : "sla_warning", itemId: r.id, target: t.target }).catch(() => undefined);
    }
  }
  return n;
}

// ---------- Settings → This workspace → SLAs ----------

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function slaApi(c, path, method) {
  if (!path.startsWith("/api/sla-policies")) return null;
  const { db, req } = c;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  if (path === "/api/sla-policies" && method === "GET") return json({ policies: await loadPolicies(db), calendar: calendarSummary(await loadCalendar(db)) });
  if (!c.can("manage_workflows")) throw new HttpError(403, "You don't have permission to change SLAs");
  /** @param {Record<string, unknown>} b @param {SlaPolicy | null} before */
  const check = async (b, before) => {
    const name = String(b.name ?? before?.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) throw new HttpError(400, "Name the SLA");
    const minutes = /** @param {unknown} v @param {number | null | undefined} old @param {string} label */ (v, old, label) => {
      if (v === undefined) return old ?? null;
      if (v === null || v === "") return null;
      const m = Math.round(Number(v));
      if (!Number.isInteger(m) || m < 1 || m > 525_600) throw new HttpError(400, `${label}: a number of working minutes`);
      return m;
    };
    const first = minutes(b.firstResponseMinutes, before?.firstResponseMinutes, "First response");
    const resolution = minutes(b.resolutionMinutes, before?.resolutionMinutes, "Resolution");
    if (!first && !resolution) throw new HttpError(400, "Give a first-response target, a resolution target, or both");
    const warn = b.warnPercent === undefined ? (before?.warnPercent ?? 80) : Math.round(Number(b.warnPercent));
    if (!(warn >= 10 && warn <= 99)) throw new HttpError(400, "Warn at 10% to 99% of the time");
    const types = b.itemTypes === undefined ? (before?.itemTypes ?? null) : Array.isArray(b.itemTypes) && b.itemTypes.length ? b.itemTypes.map(String).slice(0, 30) : null;
    if (types) {
      const known = new Set((/** @type {{ id: string }[]} */ ((await db.prepare("SELECT id FROM item_types").all()).results)).map((t) => t.id));
      const bad = types.find((t) => !known.has(t));
      if (bad) throw new HttpError(400, `Unknown item type ${bad}`);
    }
    const priorities = b.priorities === undefined ? (before?.priorities ?? null) : Array.isArray(b.priorities) && b.priorities.length ? b.priorities.map(String) : null;
    if (priorities?.some((p) => !WORK_PRIORITIES.includes(/** @type {never} */ (p)))) throw new HttpError(400, "Unknown priority");
    return { name, first, resolution, warn, types, priorities, active: b.active === undefined ? (before?.active ?? true) : !!b.active };
  };
  if (path === "/api/sla-policies" && method === "POST") {
    const v = await check(/** @type {Record<string, unknown>} */ (await body(req)), null);
    const id = newToken().slice(0, 12);
    const pos = Number((/** @type {{ p: number }} */ (await db.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM sla_policies").first())).p);
    await db
      .prepare("INSERT INTO sla_policies (id, name, item_types, priorities, first_response_minutes, resolution_minutes, warn_percent, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, v.name, v.types ? JSON.stringify(v.types) : null, v.priorities ? JSON.stringify(v.priorities) : null, v.first, v.resolution, v.warn, pos, v.active ? 1 : 0, c.now, c.now)
      .run();
    await c.audit("sla_policy_created", null, { name: v.name, firstResponseMinutes: v.first, resolutionMinutes: v.resolution });
    return json((await loadPolicies(db)).find((p) => p.id === id), 201);
  }
  const m = path.match(/^\/api\/sla-policies\/([a-f0-9]{12})$/);
  if (m && (method === "PATCH" || method === "DELETE")) {
    const before = (await loadPolicies(db)).find((p) => p.id === m[1]);
    if (!before) throw new HttpError(404, "SLA not found");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM sla_policies WHERE id = ?").bind(before.id).run();
      await c.audit("sla_policy_deleted", null, { name: before.name });
      return json({ ok: true });
    }
    const b = /** @type {Record<string, unknown>} */ (await body(req));
    const v = await check(b, before);
    await db
      .prepare("UPDATE sla_policies SET name = ?, item_types = ?, priorities = ?, first_response_minutes = ?, resolution_minutes = ?, warn_percent = ?, active = ?, position = ?, updated_at = ? WHERE id = ?")
      .bind(v.name, v.types ? JSON.stringify(v.types) : null, v.priorities ? JSON.stringify(v.priorities) : null, v.first, v.resolution, v.warn, v.active ? 1 : 0, b.position === undefined ? before.position : Number(b.position) || 0, c.now, before.id)
      .run();
    await c.audit("sla_policy_updated", null, { name: v.name });
    return json((await loadPolicies(db)).find((p) => p.id === before.id));
  }
  throw new HttpError(404, "Not found");
}
/** @param {WorkCalendar} cal */
const calendarSummary = (cal) => ({ timeZone: cal.timeZone, workDays: cal.workDays, start: cal.start, end: cal.end, holidays: cal.holidays.size });
