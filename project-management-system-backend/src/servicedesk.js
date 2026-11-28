/** @import { Role } from '../../project-management-system-frontend/src/data/roles' */
/** @import { Alert } from './notify' */
/** @import { ItemContext, ItemRow } from './workitems' */
/** @import { WorkPriority, StatusCategory } from '../../project-management-system-frontend/src/data/workitems' */
/** @import { Holiday, PortalLink, PortalRequest, QueueItem, QueueKey, RequestField, RequestFieldKind, RequestInfo, RequestKind, RequestType, SlaClock } from '../../project-management-system-frontend/src/data/servicedesk' */
// Service Desk lite. Requests are work items (source 'service_desk') in the project chosen in Settings,
// which uses the Service desk workflow. Each has a request type (Incident, Service request, Change,
// Question) with its own form, a customer, and two SLA clocks (first response and resolution) counted
// in business hours, paused while the request waits for the customer.
//
// People raise requests on the portal: a link (like a view-only link: it expires and can be revoked),
// or a page for signed-in staff. The portal shows people only their own requests and the public replies
// on them; never internal items or notes. The team works the requests in queues.
import { brandingFor } from "./branding";
import { newToken, tokenHash } from "./auth";
import { tenantEnv } from "./pg";
import { HttpError, body, json } from "./http";
import { canSeeItem, itemAccess, roleMatrix, viewersOf } from "./access";
import { permissionsFor } from "../../project-management-system-frontend/src/data/roles";
import { noteFailure, raise, readDelivery, sendEmail } from "./notify";
import { SELECT, addComment, createItem, itemByKey, keyOf, toSummary, transitionItem } from "./workitems";
import { loadWorkflow } from "./workflowData";
import { runEvent } from "./automation";
import { WORK_PRIORITIES, WORK_PRIORITY_META, MAX_COMMENT, MAX_DESCRIPTION, MAX_SUMMARY } from "../../project-management-system-frontend/src/data/workitems";
import { QUEUES, REQUEST_FIELD_KINDS, REQUEST_KINDS, formatBusinessMinutes, slaClock } from "../../project-management-system-frontend/src/data/servicedesk";
const SD_WORKFLOW = "service-desk";
const WAITING = "WAITING_CUSTOMER";
const APPROVAL = "CHANGE_APPROVAL";
const MAX_OPEN_SCAN = 2000;
const PORTAL_REQUESTS_PER_HOUR = 30;
// ---------- reading the set-up ----------
/**
 * @param {D1Database} db
 * @returns {Promise<Holiday[]>}
 */
export async function loadHolidays(db) {
  return (await /** @type {Promise<D1Result<Holiday>>} */ (/** @type {unknown} */ (db.prepare("SELECT day, name FROM public_holidays ORDER BY day").all()))).results;
}
/**
 * @param {D1Database} db
 * @param {boolean} [onlyEnabled=false]
 * @returns {Promise<RequestType[]>}
 */
export async function loadTypes(db, onlyEnabled = false) {
  const [types, fields, options, targets] = await Promise.all([
    /** @type {Promise<D1Result<{ id: string; name: string; kind: RequestKind; description: string; item_type: "TASK" | "BUG"; enabled: number; }>>} */ (/** @type {unknown} */ (db.prepare(`SELECT * FROM request_types${onlyEnabled ? " WHERE enabled = 1" : ""} ORDER BY position, name`).all())),
    /** @type {Promise<D1Result<{ id: string; request_type_id: string; label: string; kind: RequestFieldKind; help: string; required: number; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM request_type_fields ORDER BY position").all())),
    /** @type {Promise<D1Result<{ id: string; field_id: string; label: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM request_type_field_options ORDER BY position").all())),
    /** @type {Promise<D1Result<{ request_type_id: string; priority: WorkPriority; first_response_minutes: number; resolution_minutes: number; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM sla_targets").all())),
  ]);
  return types.results.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    description: t.description,
    itemType: t.item_type,
    enabled: !!t.enabled,
    fields: fields.results
      .filter((f) => f.request_type_id === t.id)
      .map(
        /** @returns {RequestField} */ (f) => ({
          id: f.id,
          label: f.label,
          kind: f.kind,
          help: f.help,
          required: !!f.required,
          options: options.results.filter((o) => o.field_id === f.id).map((o) => ({ id: o.id, label: o.label })),
        }),
      ),
    targets: WORK_PRIORITIES.map((p) => {
      const x = targets.results.find((r) => r.request_type_id === t.id && r.priority === p);
      return { priority: p, firstResponseMinutes: Number(x?.first_response_minutes ?? 540), resolutionMinutes: Number(x?.resolution_minutes ?? 2700) };
    }),
  }));
}
/**
 * @param {D1Database} db
 * @returns {Promise<string | null>}
 */
async function configuredSystem(db) {
  return (await /** @type {Promise<{ system_id: string | null; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT system_id FROM service_desk_config WHERE id = 1").first())))?.system_id ?? null;
}
/**
 * Both clocks for each request.
 * @param {D1Database} db
 * @param {ClockRow[]} rows
 * @param {number} now
 * @returns {Promise<Map<string, { first: SlaClock; resolution: SlaClock; waiting: boolean; }>>}
 */
async function clocksFor(db, rows, now) {
  const out = /** @type {Map<string, { first: SlaClock; resolution: SlaClock; waiting: boolean; }>} */ (/** @type {unknown} */ (new Map()));
  if (!rows.length) return out;
  const [holidays, types, pauses] = await Promise.all([
    loadHolidays(db),
    loadTypes(db),
    /** @type {Promise<D1Result<{ item_id: string; started_at: string; ended_at: string | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT item_id, started_at, ended_at FROM sd_pauses WHERE item_id IN (${rows.map(() => "?").join(", ")}) ORDER BY started_at`)
          .bind(...rows.map((r) => r.item_id))
          .all()
      )
    ),
  ]);
  const days = new Set(holidays.map((h) => h.day));
  for (const r of rows) {
    const t = types.find((x) => x.id === r.request_type_id)?.targets.find((x) => x.priority === r.priority);
    const spans = pauses.results.filter((p) => p.item_id === r.item_id).map(/** @returns {[number, number | null]} */ (p) => [Date.parse(p.started_at), p.ended_at ? Date.parse(p.ended_at) : null]);
    const start = Date.parse(r.created_at);
    out.set(r.item_id, {
      first: slaClock({ start, stoppedAt: r.first_response_at ? Date.parse(r.first_response_at) : null, now, targetMinutes: t?.firstResponseMinutes ?? 540, holidays: days, pauses: spans }),
      resolution: slaClock({ start, stoppedAt: r.resolved_at ? Date.parse(r.resolved_at) : null, now, targetMinutes: t?.resolutionMinutes ?? 2700, holidays: days, pauses: spans }),
      waiting: r.status === WAITING,
    });
  }
  return out;
}
// ---------- hooks from worker/workitems.ts ----------
/**
 * A Change is resolved only through Change Approval, which a Manager approves.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {string} from
 * @param {string} _to
 * @param {StatusCategory} toCategory
 * @returns {Promise<string | null>}
 */
export async function requestMoveProblem(c, r, from, _to, toCategory) {
  if (toCategory !== "DONE" || r.status_category === "DONE" || from === APPROVAL) return null;
  const kind = await /** @type {Promise<{ kind: RequestKind; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT t.kind FROM sd_requests q JOIN request_types t ON t.id = q.request_type_id WHERE q.item_id = ?").bind(r.id).first()));
  if (kind?.kind !== "change") return null;
  return "A change is resolved through Change Approval: move it to Change Approval first, for a Manager to approve";
}
/**
 * After a status move: the SLA pause, and telling the customer.
 * @param {ItemContext} c
 * @param {ItemRow} before
 * @param {ItemRow} after
 * @returns {Promise<void>}
 */
export async function onRequestMove(c, before, after) {
  const db = c.db;
  if (after.status === WAITING && before.status !== WAITING) {
    await db.prepare("INSERT INTO sd_pauses (item_id, started_at) VALUES (?, ?)").bind(after.id, c.now).run();
  } else if (before.status === WAITING && after.status !== WAITING) {
    await db.prepare("UPDATE sd_pauses SET ended_at = ? WHERE item_id = ? AND ended_at IS NULL").bind(c.now, after.id).run();
  }
  if (after.status_category === "DONE") await db.prepare("UPDATE sd_pauses SET ended_at = ? WHERE item_id = ? AND ended_at IS NULL").bind(c.now, after.id).run();
  const resolved = after.status_category === "DONE" && before.status_category !== "DONE";
  const reopened = after.status_category !== "DONE" && before.status_category === "DONE";
  await tellCustomer(
    c,
    after,
    resolved ? `Your request ${keyOf(after)} has been resolved` : `Your request ${keyOf(after)} is now: ${after.status_name}`,
    resolved
      ? `"${after.summary}" has been resolved. If it isn't fixed, reply on the portal and the team will reopen it.`
      : reopened
        ? `"${after.summary}" has been reopened.`
        : after.status === WAITING
          ? `"${after.summary}": the team is waiting for your reply. Please answer on the portal.`
          : `"${after.summary}" moved to ${after.status_name}.`,
  );
}
/**
 * After a comment: the first response, telling the customer, and resuming when the customer replies.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {{ public: boolean; fromCustomer: boolean; text: string }} x
 * @returns {Promise<void>}
 */
export async function onRequestComment(c, r, x) {
  if (!x.public) return;
  if (!x.fromCustomer) {
    await c.db.prepare("UPDATE sd_requests SET first_response_at = COALESCE(first_response_at, ?) WHERE item_id = ?").bind(c.now, r.id).run();
    await tellCustomer(c, r, `New reply on your request ${keyOf(r)}`, `${c.me.name} replied about "${r.summary}":\n\n${x.text.slice(0, 2000)}`);
    return;
  }
  // The customer answered: the request goes back to the team, and its clock runs again.
  if (r.status === WAITING) {
    await transitionItem(c, r, { to: "IN_PROGRESS" }, { log: true }).catch(() => undefined);
  }
}
/**
 * The customer hears by email (portal customers) or under their bell and by email (staff).
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {string} title
 * @param {string} text
 * @returns {Promise<void>}
 */
async function tellCustomer(c, r, title, text) {
  const q = await /** @type {Promise<{ customer_name: string; customer_email: string | null; customer_user_id: string | null; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT customer_name, customer_email, customer_user_id FROM sd_requests WHERE item_id = ?").bind(r.id).first()));
  if (!q) return;
  if (q.customer_user_id) {
    if (q.customer_user_id === c.me.id) return;
    c.alert([{ userId: q.customer_user_id, kind: "service_desk", title, body: text.slice(0, 500), link: "view:service-desk" }]);
    return;
  }
  const env = c.env;
  if (!q.customer_email || !env) return;
  const work = (async () => {
    const delivery = await readDelivery(env.DB);
    if (!delivery.resendKey || !delivery.from) return;
    try {
      const mail = customerEmail(title, `Hello ${q.customer_name},`, text);
      await sendEmail(env, delivery, /** @type {NonNullable<typeof q.customer_email>} */ (q.customer_email), mail.subject, mail.html, mail.text);
    } catch (e) {
      await noteFailure(env.DB, "Email", e);
    }
  })();
  if (c.defer) c.defer(work);
  else await work;
}
const esc =
  /** @param {string} s
   * @returns {string}
   */ (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * Emails to customers: plain, with no link into PMS (they can't sign in).
 * @param {string} title
 * @param {string} greeting
 * @param {string} text
 * @returns {{ subject: string; html: string; text: string; }}
 */
function customerEmail(title, greeting, text) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;white-space:pre-wrap">${esc(p)}</p>`)
    .join("");
  return {
    subject: title,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45;background:#ffffff;padding:24px;border-radius:12px;max-width:600px">
<!--pms:header-->
<p style="margin:0 0 6px;font-weight:700;font-size:12px;letter-spacing:.08em;color:#5b6776">SERVICE DESK</p>
<h2 style="margin:0 0 10px;font-size:19px;color:#1f2933">${esc(title)}</h2>
<p style="margin:0 0 12px">${esc(greeting)}</p>${paras}
<p style="margin:18px 0 0;font-size:12px;color:#6b7a90">You can see your request and reply to it on the service desk portal link you used to raise it.</p>
</div>`,
    text: [title, greeting, text, "You can see your request and reply to it on the service desk portal link you used to raise it."].join("\n\n"),
  };
}
/**
 * The request part of the item page.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<RequestInfo | undefined>}
 */
export async function requestDetail(c, r) {
  const q = await /** @type {Promise<(ClockRow & { type_name: string; kind: RequestKind; customer_name: string; customer_email: string | null; portal_link_id: string | null; }) | null>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `SELECT q.*, t.name AS type_name, t.kind, w.created_at, w.resolved_at, w.priority, w.status
       FROM sd_requests q JOIN request_types t ON t.id = q.request_type_id JOIN work_items w ON w.id = q.item_id WHERE q.item_id = ?`,
        )
        .bind(r.id)
        .first()
    )
  );
  if (!q) return undefined;
  const answers = await /** @type {Promise<D1Result<{ label: string; value: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT label, value FROM sd_answers WHERE item_id = ? ORDER BY position").bind(r.id).all()));
  const clocks = /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ ((await clocksFor(c.db, [q], Date.parse(c.now))).get(r.id));
  const staff = !c.guest && c.can("work_service_desk");
  return {
    typeId: q.request_type_id,
    typeName: q.type_name,
    kind: q.kind,
    customerName: q.customer_name,
    // Contact details: staff only, never on view-only links.
    ...(staff && q.customer_email ? { customerEmail: q.customer_email } : {}),
    viaPortal: !!q.portal_link_id,
    answers: answers.results,
    waiting: clocks.waiting,
    firstResponse: clocks.first,
    resolution: clocks.resolution,
  };
}
// ---------- queues ----------
/**
 * @param {ItemContext} c
 * @returns {Promise<QueueItem[]>}
 */
async function openRequests(c) {
  const vis = itemAccess(c.viewer);
  const rows = await /** @type {Promise<D1Result<ItemRow & { request_type_id: string; customer_name: string; first_response_at: string | null; type_name: string; request_kind: RequestKind; }>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `${SELECT.replace("SELECT w.*,", "SELECT w.*, q.request_type_id, q.customer_name, q.first_response_at, t.name AS type_name, t.kind AS request_kind,")}
       JOIN sd_requests q ON q.item_id = w.id JOIN request_types t ON t.id = q.request_type_id
       WHERE st.category <> 'DONE' AND ${vis.sql} ORDER BY w.created_at LIMIT ?`,
        )
        .bind(...vis.args, MAX_OPEN_SCAN)
        .all()
    )
  );
  const clocks = await clocksFor(
    c.db,
    rows.results.map((r) => ({ item_id: r.id, created_at: r.created_at, first_response_at: r.first_response_at, resolved_at: r.resolved_at, priority: r.priority, request_type_id: r.request_type_id, status: r.status })),
    Date.parse(c.now),
  );
  return rows.results.map(
    /** @returns {QueueItem} */ (r) => ({
      ...toSummary(r),
      requestType: r.type_name,
      kind: r.request_kind,
      customerName: r.customer_name,
      sla: { firstResponse: /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.id)).first, resolution: /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.id)).resolution },
    }),
  );
}
const inQueue =
  /** @param {QueueKey} q
   * @param {string} meId
   * @returns {(i: QueueItem) => boolean}
   */ (q, meId) => /** @param {QueueItem} i */ (i) => {
    const breached = i.sla.firstResponse.state === "breached" || i.sla.resolution.state === "breached";
    if (q === "unassigned") return !i.assignee;
    if (q === "mine") return i.assignee === meId;
    if (q === "breached") return breached;
    if (q === "at_risk") return !breached && (i.sla.firstResponse.atRisk || i.sla.resolution.atRisk);
    return true;
  };
// ---------- the API for staff ----------
/**
 * @param {unknown} raw
 * @returns {{ priority: string; fr: number; res: number; }[]}
 */
function cleanTargets(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return WORK_PRIORITIES.map((p) => {
    const t = /** @type {{ firstResponseMinutes?: unknown; resolutionMinutes?: unknown }} */ (list.find((x) => x && /** @type {{ priority?: unknown }} */ (x).priority === p) ?? {});
    const fr = Math.round(Number(t.firstResponseMinutes));
    const res = Math.round(Number(t.resolutionMinutes));
    if (!(fr > 0 && fr <= 100_000) || !(res > 0 && res <= 500_000)) throw new HttpError(400, `${WORK_PRIORITY_META[p].label}: targets must be more than zero minutes`);
    if (fr > res) throw new HttpError(400, `${WORK_PRIORITY_META[p].label}: the first response must be due before the resolution`);
    return { priority: p, fr, res };
  });
}
/**
 * @param {unknown} raw
 * @returns {{ id: string; label: string; kind: RequestFieldKind; help: string; required: number; options: string[]; }[]}
 */
function cleanFields(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 20) : [];
  return list.map((x, i) => {
    const f = /** @type {{ id?: unknown; label?: unknown; kind?: unknown; help?: unknown; required?: unknown; options?: unknown }} */ (x ?? {});
    const label = String(f.label ?? "")
      .trim()
      .slice(0, 120);
    if (!label) throw new HttpError(400, `Question ${i + 1} needs a label`);
    const kind = /** @type {RequestFieldKind} */ (String(f.kind));
    if (!(kind in REQUEST_FIELD_KINDS)) throw new HttpError(400, `Question ${i + 1}: choose its kind`);
    const options =
      kind === "select"
        ? (Array.isArray(f.options) ? f.options : [])
            .map((o) =>
              String(typeof o === "object" && o ? /** @type {{ label?: unknown }} */ (o).label : o)
                .trim()
                .slice(0, 80),
            )
            .filter(Boolean)
        : [];
    if (kind === "select" && !options.length) throw new HttpError(400, `${label}: add the choices`);
    return {
      id: typeof f.id === "string" && /^[a-z0-9-]{3,40}$/.test(f.id) ? f.id : newToken().slice(0, 16),
      label,
      kind,
      help: String(f.help ?? "")
        .trim()
        .slice(0, 200),
      required: f.required ? 1 : 0,
      options,
    };
  });
}
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function serviceDeskApi(c, path, method) {
  if (!path.startsWith("/api/service-desk")) return null;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  const { db, req } = c;
  const need = /** @param {"work_service_desk" | "manage_service_desk"} p */ (p) => {
    if (!c.can(p)) throw new HttpError(403, p === "manage_service_desk" ? "You don't have permission to set up the service desk" : "You don't have permission to work the service desk");
  };
  // The set-up. Everyone signed in reads the request types (to raise requests); the rest is for managers.
  if (path === "/api/service-desk/config" && method === "GET") {
    const manage = c.can("manage_service_desk");
    const [systemId, types, holidays, links] = await Promise.all([
      configuredSystem(db),
      loadTypes(db, !manage),
      manage ? loadHolidays(db) : Promise.resolve(/** @type {Holiday[]} */ ([])),
      manage
        ? /** @type {Promise<D1Result<{ id: string; label: string; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; requests: number; }>>} */ (
            /** @type {unknown} */ (db.prepare("SELECT * FROM portal_links ORDER BY created_at DESC LIMIT 100").all())
          )
        : Promise.resolve({ results: [] }),
    ]);
    return json({
      systemId,
      types,
      holidays,
      portalLinks: links.results.map(
        /** @returns {PortalLink} */ (l) => ({
          id: l.id,
          label: l.label,
          createdBy: l.created_by,
          createdAt: l.created_at,
          expiresAt: l.expires_at,
          ...(l.revoked_at ? { revokedAt: l.revoked_at } : {}),
          ...(l.last_used_at ? { lastUsedAt: l.last_used_at } : {}),
          requests: Number(l.requests),
        }),
      ),
    });
  }
  if (path === "/api/service-desk/config" && method === "PUT") {
    need("manage_service_desk");
    const b = await /** @type {Promise<{ systemId?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const systemId = b.systemId ? String(b.systemId) : null;
    const before = await configuredSystem(db);
    if (systemId) {
      const sys = await /** @type {Promise<{ id: string; workflow_id: string | null; name: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT id, workflow_id, (data::json ->> 'name') AS name FROM systems WHERE id = ?").bind(systemId).first()));
      if (!sys) throw new HttpError(404, "Project not found");
      // The project takes the Service desk workflow, if its items' statuses fit it.
      if (sys.workflow_id !== SD_WORKFLOW) {
        const wf = await loadWorkflow(db, SD_WORKFLOW);
        const misfit = await /** @type {Promise<{ name: string; } | null>} */ (
          /** @type {unknown} */ (
            db
              .prepare(`SELECT st.name FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE w.system_id = ? AND w.status NOT IN (${wf.statuses.map(() => "?").join(", ")}) LIMIT 1`)
              .bind(sys.id, ...wf.statuses.map((s) => s.id))
              .first()
          )
        );
        if (misfit) throw new HttpError(400, `${sys.name} has work items in "${misfit.name}", which the Service desk workflow doesn't have. Choose an empty project, or move those items first.`);
        await db.prepare("UPDATE systems SET workflow_id = ? WHERE id = ?").bind(SD_WORKFLOW, sys.id).run();
      }
    }
    await db.prepare("INSERT INTO service_desk_config (id, system_id, updated_by, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET system_id = excluded.system_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(systemId, c.me.id, c.now).run();
    await c.audit("service_desk_updated", systemId, { from: { project: before }, to: { project: systemId } });
    return json({ systemId });
  }
  // Request types, with their questions and SLA targets.
  if (path === "/api/service-desk/types" && method === "POST") need("manage_service_desk");
  let m = path.match(/^\/api\/service-desk\/types(?:\/([a-z0-9-]{3,40}))?$/);
  if (m && (method === "POST" || method === "PUT" || method === "DELETE")) {
    need("manage_service_desk");
    const id = m[1];
    const before = id ? (await loadTypes(db)).find((t) => t.id === id) : undefined;
    if (id && !before) throw new HttpError(404, "Request type not found");
    if (method === "DELETE") {
      const used = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM sd_requests WHERE request_type_id = ?").bind(id).first()));
      if (Number(used?.n ?? 0)) throw new HttpError(400, `${/** @type {NonNullable<typeof before>} */ (before).name} has ${/** @type {NonNullable<typeof used>} */ (used).n} requests; turn it off instead`);
      await db.prepare("DELETE FROM request_types WHERE id = ?").bind(id).run();
      await c.audit("request_type_deleted", null, { requestType: /** @type {NonNullable<typeof before>} */ (before).name });
      return json({ ok: true });
    }
    const b = await /** @type {Promise<{ name?: unknown; kind?: unknown; description?: unknown; itemType?: unknown; enabled?: unknown; fields?: unknown; targets?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 60);
    if (!name) throw new HttpError(400, "A request type needs a name");
    const kind = /** @type {RequestKind} */ (String(b.kind ?? before?.kind ?? ""));
    if (!(kind in REQUEST_KINDS)) throw new HttpError(400, "Choose what kind of request it is");
    const itemType = b.itemType === "BUG" ? "BUG" : "TASK";
    const fields = cleanFields(b.fields);
    const targets = cleanTargets(b.targets);
    const typeId = id ?? newToken().slice(0, 16);
    /** @type {D1PreparedStatement[]} */ const stmts = [
      id
        ? db.prepare("UPDATE request_types SET name = ?, kind = ?, description = ?, item_type = ?, enabled = ?, updated_at = ? WHERE id = ?").bind(
            name,
            kind,
            String(b.description ?? "")
              .trim()
              .slice(0, 300),
            itemType,
            b.enabled === false ? 0 : 1,
            c.now,
            typeId,
          )
        : db.prepare("INSERT INTO request_types (id, name, kind, description, item_type, position, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM request_types), ?, ?, ?)").bind(
            typeId,
            name,
            kind,
            String(b.description ?? "")
              .trim()
              .slice(0, 300),
            itemType,
            b.enabled === false ? 0 : 1,
            c.now,
            c.now,
          ),
      db.prepare("DELETE FROM request_type_fields WHERE request_type_id = ?").bind(typeId),
      db.prepare("DELETE FROM sla_targets WHERE request_type_id = ?").bind(typeId),
    ];
    fields.forEach((f, i) => {
      stmts.push(db.prepare("INSERT INTO request_type_fields (id, request_type_id, label, kind, help, required, position) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(f.id, typeId, f.label, f.kind, f.help, f.required, i + 1));
      f.options.forEach((o, j) => stmts.push(db.prepare("INSERT INTO request_type_field_options (id, field_id, label, position) VALUES (?, ?, ?, ?)").bind(newToken().slice(0, 16), f.id, o, j + 1)));
    });
    for (const t of targets) stmts.push(db.prepare("INSERT INTO sla_targets (request_type_id, priority, first_response_minutes, resolution_minutes) VALUES (?, ?, ?, ?)").bind(typeId, t.priority, t.fr, t.res));
    await db.batch(stmts);
    const after = /** @type {RequestType} */ ((await loadTypes(db)).find((t) => t.id === typeId));
    const summary = /** @param {RequestType} t */ (t) => ({
      name: t.name,
      kind: REQUEST_KINDS[t.kind],
      enabled: t.enabled,
      questions: t.fields.map((f) => f.label),
      targets: t.targets.map((x) => `${WORK_PRIORITY_META[x.priority].label}: reply ${formatBusinessMinutes(x.firstResponseMinutes)}, resolve ${formatBusinessMinutes(x.resolutionMinutes)}`),
    });
    await c.audit(id ? "request_type_updated" : "request_type_created", null, id ? { requestType: name, from: summary(/** @type {NonNullable<typeof before>} */ (before)), to: summary(after) } : { requestType: name, ...summary(after) });
    return json(after, id ? 200 : 201);
  }
  if (path === "/api/service-desk/holidays" && method === "PUT") {
    need("manage_service_desk");
    const list = (await /** @type {Promise<{ holidays?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).holidays;
    if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, "Send up to 200 holidays");
    const clean = list.map((x) => {
      const h = /** @type {{ day?: unknown; name?: unknown }} */ (x ?? {});
      const day = String(h.day ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, `"${day.slice(0, 20)}" isn't a date (YYYY-MM-DD)`);
      const name = String(h.name ?? "")
        .trim()
        .slice(0, 80);
      if (!name) throw new HttpError(400, `${day}: give the holiday a name`);
      return { day, name };
    });
    if (new Set(clean.map((h) => h.day)).size !== clean.length) throw new HttpError(400, "Each day can be listed once");
    const before = await loadHolidays(db);
    await db.batch([db.prepare("DELETE FROM public_holidays"), ...clean.map((h) => db.prepare("INSERT INTO public_holidays (day, name) VALUES (?, ?)").bind(h.day, h.name))]);
    const added = clean.filter((h) => !before.some((x) => x.day === h.day)).map((h) => `${h.day} ${h.name}`);
    const removed = before.filter((h) => !clean.some((x) => x.day === h.day)).map((h) => `${h.day} ${h.name}`);
    await c.audit("holidays_updated", null, { added, removed, total: clean.length });
    return json(await loadHolidays(db));
  }
  // Portal links: like view-only links, the secret is shown once.
  if (path === "/api/service-desk/portal-links" && method === "POST") {
    need("manage_service_desk");
    const b = await /** @type {Promise<{ label?: unknown; days?: unknown; }>} */ (/** @type {unknown} */ (body(req)));
    const label = String(b.label ?? "")
      .trim()
      .slice(0, 80);
    if (!label) throw new HttpError(400, "Say who the link is for");
    const days = [7, 30, 90, 180, 365].includes(Number(b.days)) ? Number(b.days) : 90;
    const token = newToken();
    const id = newToken().slice(0, 12);
    const expires = new Date(Date.parse(c.now) + days * 86_400_000).toISOString();
    await db
      .prepare("INSERT INTO portal_links (id, token_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, await tokenHash(token), label, c.me.id, c.now, expires)
      .run();
    await c.audit("portal_link_created", null, { label, days });
    return json({ id, label, createdBy: c.me.id, createdAt: c.now, expiresAt: expires, requests: 0, url: `${new URL(req.url).origin}/portal/${token}` }, 201);
  }
  m = path.match(/^\/api\/service-desk\/portal-links\/([a-z0-9]{6,20})$/);
  if (m && method === "DELETE") {
    need("manage_service_desk");
    const row = await /** @type {Promise<{ label: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT label FROM portal_links WHERE id = ? AND revoked_at IS NULL").bind(m[1]).first()));
    if (!row) throw new HttpError(404, "Link not found");
    await db.prepare("UPDATE portal_links SET revoked_at = ? WHERE id = ?").bind(c.now, m[1]).run();
    await c.audit("portal_link_revoked", null, { label: row.label });
    return json({ ok: true });
  }
  // Queues.
  if (path === "/api/service-desk/queues" && method === "GET") {
    need("work_service_desk");
    const q = new URL(req.url).searchParams;
    const key = /** @type {QueueKey} */ (QUEUES.some((x) => x.key === q.get("queue")) ? q.get("queue") : "unassigned");
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 50));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const all = await openRequests(c);
    const counts = /** @type {Record<QueueKey, number>} */ (Object.fromEntries(QUEUES.map((x) => [x.key, all.filter(inQueue(x.key, c.me.id)).length])));
    const list = all.filter(inQueue(key, c.me.id));
    // Most urgent first: breached, then nearest to breaching.
    const urgency = /** @param {QueueItem} i */ (i) => Math.max(i.sla.firstResponse.state === "met" ? 0 : i.sla.firstResponse.elapsedMinutes / i.sla.firstResponse.targetMinutes, i.sla.resolution.elapsedMinutes / i.sla.resolution.targetMinutes);
    list.sort((a, b) => urgency(b) - urgency(a));
    return json({ items: list.slice(offset, offset + limit), total: list.length, offset, counts });
  }
  // Reports.
  if (path === "/api/service-desk/reports" && method === "GET") {
    if (!c.can("reports") && !c.can("manage_service_desk")) throw new HttpError(403, "You don't have permission to see reports");
    const days = Math.min(365, Math.max(7, Number(new URL(req.url).searchParams.get("days")) || 30));
    const since = new Date(Date.parse(c.now) - days * 86_400_000).toISOString();
    const vis = itemAccess(c.viewer);
    const rows = await /** @type {Promise<D1Result<ClockRow & { type_name: string; kind: RequestKind; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT w.id AS item_id, w.created_at, w.resolved_at, w.priority, w.status, q.first_response_at, q.request_type_id, t.name AS type_name, t.kind
         FROM work_items w JOIN sd_requests q ON q.item_id = w.id JOIN request_types t ON t.id = q.request_type_id
         WHERE w.created_at >= ? AND ${vis.sql} ORDER BY w.created_at LIMIT ?`,
          )
          .bind(since, ...vis.args, MAX_OPEN_SCAN * 2)
          .all()
      )
    );
    const clocks = await clocksFor(db, rows.results, Date.parse(c.now));
    const settled = /** @param {"first" | "resolution"} k @param {"met" | "breached"} s */ (k, s) => rows.results.filter((r) => /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.item_id))[k].state === s).length;
    const resolved = rows.results.filter((r) => r.resolved_at);
    const byType = /** @type {Map<string, { name: string; kind: RequestKind; count: number; resolved: number; minutes: number; }>} */ (/** @type {unknown} */ (new Map()));
    for (const r of rows.results) {
      const t = byType.get(r.request_type_id) ?? { name: r.type_name, kind: r.kind, count: 0, resolved: 0, minutes: 0 };
      t.count++;
      if (r.resolved_at) {
        t.resolved++;
        t.minutes += /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.item_id)).resolution.elapsedMinutes;
      }
      byType.set(r.request_type_id, t);
    }
    const totalResolveMinutes = resolved.reduce((n, r) => n + /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.item_id)).resolution.elapsedMinutes, 0);
    const weeks = /** @type {Map<string, number>} */ (/** @type {unknown} */ (new Map()));
    for (const r of rows.results) {
      const d = new Date(r.created_at);
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
      weeks.set(monday, (weeks.get(monday) ?? 0) + 1);
    }
    return json({
      days,
      total: rows.results.length,
      open: rows.results.length - resolved.length,
      firstResponse: { met: settled("first", "met"), breached: settled("first", "breached") },
      resolution: { met: settled("resolution", "met"), breached: settled("resolution", "breached") },
      averageResolveMinutes: resolved.length ? Math.round(totalResolveMinutes / resolved.length) : null,
      byType: [...byType.values()].map((t) => ({ name: t.name, kind: t.kind, count: t.count, resolved: t.resolved, averageResolveMinutes: t.resolved ? Math.round(t.minutes / t.resolved) : null })),
      byWeek: [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count })),
    });
  }
  // The staff portal: anyone signed in raises requests and follows their own.
  if (path === "/api/service-desk/requests" && method === "POST") {
    const b = await /** @type {Promise<RaiseBody>} */ (/** @type {unknown} */ (body(req)));
    const u = await /** @type {Promise<{ name: string; email: string | null; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT name, email FROM users WHERE id = ?").bind(c.me.id).first()));
    const row = await raiseRequest(c, b, { name: u?.name ?? c.me.name, email: u?.email ?? null, userId: c.me.id });
    return json({ key: keyOf(row) }, 201);
  }
  if (path === "/api/service-desk/my-requests" && method === "GET") {
    return json(await portalList(c, "q.customer_user_id = ?", [c.me.id]));
  }
  m = path.match(/^\/api\/service-desk\/my-requests\/([A-Z][A-Z0-9]{1,9}-\d{1,7})(\/reply)?$/);
  if (m) {
    const r = await ownRequest(c, m[1], "q.customer_user_id = ?", [c.me.id]);
    if (!m[2] && method === "GET") return json(await portalDetail(c, r));
    if (m[2] && method === "POST") {
      const text = String((await /** @type {Promise<{ body?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).body ?? "")
        .trim()
        .slice(0, MAX_COMMENT);
      if (!text) throw new HttpError(400, "Write your reply");
      await addComment({ ...c, viewer: { ...c.viewer, all: true } }, r, text, {}, { customerName: c.me.name });
      return json(await portalDetail(c, await itemByKeyAll(c, m[1])), 201);
    }
  }
  throw new HttpError(404, "Not found");
}
/**
 * A Change request raised by the system for a member of staff (the project lifecycle's Deployment stage): the
 * service desk's first enabled Change type, in the person's name. Throws (503) when there is none.
 * @param {ItemContext} c
 * @param {{ summary: string; description: string }} b
 * @returns {Promise<{ id: string; key: string }>}
 */
export async function raiseChangeRequest(c, b) {
  const type = (await loadTypes(c.db, true)).find((t) => t.kind === "change");
  if (!type) throw new HttpError(503, "The service desk has no Change request type");
  const row = await raiseRequest(c, { typeId: type.id, summary: b.summary, description: b.description, priority: "MEDIUM" }, { name: c.me.name, email: null, userId: c.me.id });
  return { id: row.id, key: keyOf(row) };
}
/**
 * @param {ItemContext} c
 * @param {RaiseBody} b
 * @param {{ name: string; email: string | null; userId?: string; linkId?: string; requesterHash?: string }} who
 * @returns {Promise<ItemRow>}
 */
async function raiseRequest(c, b, who) {
  const systemId = await configuredSystem(c.db);
  if (!systemId) throw new HttpError(503, "The service desk isn't set up yet. Ask an administrator to choose its project.");
  const type = (await loadTypes(c.db, true)).find((t) => t.id === String(b.typeId ?? ""));
  if (!type) throw new HttpError(400, "Choose what kind of request this is");
  const summary = String(b.summary ?? "")
    .trim()
    .slice(0, MAX_SUMMARY);
  if (!summary) throw new HttpError(400, "Give your request a short title");
  const description = String(b.description ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION);
  const priority = /** @type {string[]} */ (WORK_PRIORITIES).includes(String(b.priority)) ? /** @type {WorkPriority} */ (String(b.priority)) : "MEDIUM";
  const given = b.answers && typeof b.answers === "object" ? /** @type {Record<string, unknown>} */ (b.answers) : {};
  const answers = type.fields.map((f, i) => {
    let v = String(given[f.id] ?? "")
      .trim()
      .slice(0, f.kind === "textarea" ? 4000 : 300);
    if (f.kind === "select" && v) {
      const o = f.options.find((x) => x.id === v || x.label === v);
      if (!o) throw new HttpError(400, `${f.label}: choose one of the choices`);
      v = o.label;
    }
    if (f.kind === "date" && v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) throw new HttpError(400, `${f.label}: give a date`);
    if (f.required && !v) throw new HttpError(400, `${f.label} is required`);
    return { id: f.id, label: f.label, value: v, position: i + 1 };
  });
  const id = newToken().slice(0, 16);
  const row = await createItem(c, { systemId, type: type.itemType, summary, description, priority }, "service_desk", id);
  await c.db.batch([
    c.db
      .prepare(
        `INSERT INTO sd_requests (item_id, request_type_id, customer_name, customer_email, customer_user_id, portal_link_id, requester_key_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(row.id, type.id, who.name.slice(0, 100), who.email, who.userId ?? null, who.linkId ?? null, who.requesterHash ?? null, row.created_at),
    ...answers.filter((a) => a.value).map((a) => c.db.prepare("INSERT INTO sd_answers (item_id, field_id, label, value, position) VALUES (?, ?, ?, ?, ?)").bind(row.id, a.id, a.label, a.value, a.position)),
    ...(who.linkId ? [c.db.prepare("UPDATE portal_links SET requests = requests + 1, last_used_at = ? WHERE id = ?").bind(c.now, who.linkId)] : []),
  ]);
  await c.audit("work_item_created", row.system_id, { name: row.project_name, key: keyOf(row), summary: row.summary, type: row.type, priority: row.priority, status: row.status, source: "service desk" });
  await c.audit("service_request_raised", row.system_id, { key: keyOf(row), requestType: type.name, customer: who.name, viaPortalLink: !!who.linkId });
  // The people who work the service desk hear about it.
  const team = await /** @type {Promise<D1Result<{ id: string; role: Role; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, role FROM users").all()));
  const matrix = await roleMatrix(c.db);
  /** @type {Alert[]} */ const alerts = team.results
    .filter((u) => u.id !== c.me.id && permissionsFor(u.role, matrix).includes("manage_service_desk"))
    .map((u) => ({ userId: u.id, kind: "service_desk", title: `New ${type.name.toLowerCase()}: ${keyOf(row)} ${row.summary}`.slice(0, 200), body: `From ${who.name}. ${WORK_PRIORITY_META[priority].label} priority.`, link: `#/projects/${row.system_id}/items/${keyOf(row)}` }));
  if (alerts.length) c.alert(alerts);
  if (who.email && !who.userId) {
    await tellCustomerDirect(c, who.email, `We've received your request ${keyOf(row)}`, `Hello ${who.name},`, `Thank you. "${row.summary}" is logged as ${keyOf(row)}. The team will reply on the portal and by email.`);
  }
  return row;
}
/**
 * @param {ItemContext} c
 * @param {string} to
 * @param {string} title
 * @param {string} greeting
 * @param {string} text
 * @returns {Promise<void>}
 */
async function tellCustomerDirect(c, to, title, greeting, text) {
  const env = c.env;
  if (!env) return;
  const work = (async () => {
    const delivery = await readDelivery(env.DB);
    if (!delivery.resendKey || !delivery.from) return;
    const mail = customerEmail(title, greeting, text);
    await sendEmail(env, delivery, to, mail.subject, mail.html, mail.text).catch((e) => noteFailure(env.DB, "Email", e));
  })();
  if (c.defer) c.defer(work);
  else await work;
}
/**
 * A request by key, whatever its visibility (the portal checks ownership itself).
 * @param {ItemContext} c
 * @param {string} key
 * @returns {Promise<ItemRow>}
 */
async function itemByKeyAll(c, key) {
  return itemByKey({ ...c, viewer: { ...c.viewer, all: true } }, key);
}
/**
 * @param {ItemContext} c
 * @param {string} key
 * @param {string} where
 * @param {unknown[]} args
 * @returns {Promise<ItemRow>}
 */
async function ownRequest(c, key, where, args) {
  const r = await itemByKeyAll(c, key).catch(() => null);
  if (!r || r.source !== "service_desk") throw new HttpError(404, "Request not found");
  const q = await c.db
    .prepare(`SELECT 1 FROM sd_requests q WHERE q.item_id = ? AND ${where}`)
    .bind(r.id, ...args)
    .first();
  if (!q) throw new HttpError(404, "Request not found");
  return r;
}
/**
 * @param {ItemContext} c
 * @param {string} where
 * @param {unknown[]} args
 * @returns {Promise<PortalRequest[]>}
 */
async function portalList(c, where, args) {
  const rows = await /** @type {Promise<D1Result<ItemRow & { type_name: string; }>>} */ (
    /** @type {unknown} */ (
      c.db
        .prepare(
          `${SELECT.replace("SELECT w.*,", "SELECT w.*, t.name AS type_name,")} JOIN sd_requests q ON q.item_id = w.id JOIN request_types t ON t.id = q.request_type_id
       WHERE ${where} ORDER BY w.created_at DESC LIMIT 100`,
        )
        .bind(...args)
        .all()
    )
  );
  return rows.results.map((r) => ({
    key: keyOf(r),
    summary: r.summary,
    description: "",
    typeName: r.type_name,
    statusName: r.status_name,
    done: r.status_category === "DONE",
    waiting: r.status === WAITING,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
    answers: [],
    replies: [],
  }));
}
/**
 * What the customer sees: their words, the public replies, the status. Never internal comments.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @returns {Promise<PortalRequest>}
 */
async function portalDetail(c, r) {
  const [type, answers, replies] = await Promise.all([
    /** @type {Promise<{ name: string; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT t.name FROM sd_requests q JOIN request_types t ON t.id = q.request_type_id WHERE q.item_id = ?").bind(r.id).first())),
    /** @type {Promise<D1Result<{ label: string; value: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT label, value FROM sd_answers WHERE item_id = ? ORDER BY position").bind(r.id).all())),
    /** @type {Promise<D1Result<{ body: string; customer_name: string | null; created_at: string; name: string | null; }>>} */ (
      /** @type {unknown} */ (c.db.prepare("SELECT k.body, k.customer_name, k.created_at, u.name FROM work_item_comments k LEFT JOIN users u ON u.id = k.author_id WHERE k.item_id = ? AND k.public = 1 ORDER BY k.created_at, k.id LIMIT 200").bind(r.id).all())
    ),
  ]);
  return {
    key: keyOf(r),
    summary: r.summary,
    description: r.description,
    typeName: type?.name ?? "Request",
    statusName: r.status_name,
    done: r.status_category === "DONE",
    waiting: r.status === WAITING,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
    answers: answers.results,
    replies: replies.results.map((x) => ({
      body: x.body,
      fromCustomer: !!x.customer_name,
      // Staff are named by first name only on the portal.
      author: x.customer_name ?? (x.name ?? "The service desk").split(" ")[0],
      at: x.created_at,
    })),
  };
}
/**
 * The context a portal customer acts in: logged as them, through the link's creator for the record.
 * @param {Env} env
 * @param {Request} req
 * @param {PortalLinkRow} link
 * @param {string} customerName
 * @param {(p: Promise<unknown>) => void} waitUntil
 * @returns {ItemContext}
 */
function portalContext(env, req, link, customerName, waitUntil) {
  const name = `${customerName.slice(0, 60)} (customer)`;
  const db = env.DB;
  return {
    db,
    req,
    me: { id: link.created_by, name, username: "service-desk-portal", role: "viewer" },
    guest: false,
    can: () => true,
    ownOnly: false,
    viewer: { id: link.created_by, role: "viewer", ownOnly: false, all: true },
    now: new Date().toISOString(),
    audit: async (action, target, detail) => {
      await db
        .prepare("INSERT INTO activity (at, user_id, actor, action, target, detail, ip, agent) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)")
        .bind(new Date().toISOString(), name, action, target, JSON.stringify({ ...detail, portalLink: link.label }), req.headers.get("cf-connecting-ip"), (req.headers.get("user-agent") ?? "").slice(0, 300))
        .run()
        .catch(() => undefined);
    },
    alert: (alerts, channel) => waitUntil(raise(env, alerts, channel).catch((e) => noteFailure(db, "Notification", e))),
    // Automation rules and webhooks hear about portal requests too.
    emit: (e) => waitUntil(runEvent(env, e).catch((err) => console.error("automation failed", err))),
    env,
    defer: waitUntil,
  };
}
/**
 * /api/portal…: the customer portal, by the link's secret (x-portal-token) and the browser's key (x-requester-key).
 * @param {Env} env
 * @param {Request} req
 * @param {string} path
 * @param {(p: Promise<unknown>) => void} waitUntil
 * @returns {Promise<Response | null>}
 */
export async function portalApi(env, req, path, waitUntil) {
  if (!path.startsWith("/api/portal")) return null;
  const method = req.method;
  const token = req.headers.get("x-portal-token") ?? "";
  // The link is found by its hash (as the owner, before its tenant is known); everything after is done with
  // the handle of the workspace the link belongs to, so a customer only ever reaches that workspace's desk.
  const link = token
    ? await /** @type {Promise<(PortalLinkRow & { organization_id: string; workspace_id: string }) | null>} */ (
        /** @type {unknown} */ (
          env.ROOT
            .prepare("SELECT l.id, l.label, l.created_by, l.expires_at, l.organization_id, l.workspace_id FROM portal_links l JOIN workspaces w ON w.id = l.workspace_id AND w.status = 'active' JOIN organizations o ON o.id = l.organization_id AND o.status = 'active' WHERE l.token_hash = ? AND l.revoked_at IS NULL AND l.expires_at > ?")
            .bind(await tokenHash(token), new Date().toISOString())
            .first()
        )
      )
    : null;
  if (!link) throw new HttpError(401, "This service desk link has expired or been turned off. Ask whoever sent it for a new one.", "portal_invalid");
  env = tenantEnv(env, { orgId: link.organization_id, workspaceId: link.workspace_id });
  const db = env.DB;
  const key = req.headers.get("x-requester-key") ?? "";
  const keyHash = /^[a-f0-9]{32,64}$/.test(key) ? await tokenHash(key) : null;
  if (path === "/api/portal" && method === "GET") {
    const ready = !!(await configuredSystem(db));
    // Whose service desk it is, for the heading.
    const owner = /** @type {{ name: string } | null} */ (await db.prepare("SELECT name FROM organizations WHERE id = ?").bind(link.organization_id).first());
    // The portal is that organisation's: its branding, with "Powered by" in small print.
    return json({ label: link.label, organization: owner?.name ?? "", branding: await brandingFor(db, link.organization_id), expiresAt: link.expires_at, ready, types: ready ? await loadTypes(db, true) : [] });
  }
  if (path === "/api/portal/requests" && method === "POST") {
    const b = await /** @type {Promise<RaiseBody>} */ (/** @type {unknown} */ (body(req)));
    const name = String(b.name ?? "")
      .trim()
      .slice(0, 100);
    const email = String(b.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 200);
    if (!name) throw new HttpError(400, "Tell us your name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Give an email address we can reply to");
    const recent = await /** @type {Promise<{ n: number; } | null>} */ (
      /** @type {unknown} */ (
        db
          .prepare("SELECT COUNT(*) AS n FROM sd_requests WHERE portal_link_id = ? AND created_at > ?")
          .bind(link.id, new Date(Date.now() - 3_600_000).toISOString())
          .first()
      )
    );
    if (Number(recent?.n ?? 0) >= PORTAL_REQUESTS_PER_HOUR) throw new HttpError(429, "Too many requests through this link in the last hour. Please try again later.");
    const requesterKey = /^[a-f0-9]{32,64}$/.test(String(b.requesterKey ?? "")) ? String(b.requesterKey) : newToken();
    const c = portalContext(env, req, link, name, waitUntil);
    const row = await raiseRequest(c, b, { name, email, linkId: link.id, requesterHash: await tokenHash(requesterKey) });
    return json({ key: keyOf(row), requesterKey }, 201);
  }
  if (!keyHash) throw new HttpError(401, "This browser hasn't raised any requests through this link yet", "requester_unknown");
  const where = "q.portal_link_id = ? AND q.requester_key_hash = ?";
  const args = [link.id, keyHash];
  const sys = portalContext(env, req, link, "Customer", waitUntil);
  if (path === "/api/portal/requests" && method === "GET") return json(await portalList(sys, where, args));
  const m = path.match(/^\/api\/portal\/requests\/([A-Z][A-Z0-9]{1,9}-\d{1,7})(\/reply)?$/);
  if (m) {
    const r = await ownRequest(sys, m[1], where, args);
    if (!m[2] && method === "GET") return json(await portalDetail(sys, r));
    if (m[2] && method === "POST") {
      const text = String((await /** @type {Promise<{ body?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).body ?? "")
        .trim()
        .slice(0, MAX_COMMENT);
      if (!text) throw new HttpError(400, "Write your reply");
      const customer = await /** @type {Promise<{ customer_name: string; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT customer_name FROM sd_requests WHERE item_id = ?").bind(r.id).first()));
      const c = portalContext(env, req, link, customer?.customer_name ?? "Customer", waitUntil);
      await addComment(c, r, text, {}, { customerName: customer?.customer_name ?? "Customer" });
      return json(await portalDetail(c, await itemByKeyAll(c, m[1])), 201);
    }
  }
  throw new HttpError(404, "Not found");
}
// ---------- SLA warnings and breaches (hourly) ----------
/**
 * Warns at 75% of a target and alerts on a breach, once each. Returns how many alerts were raised.
 * @param {Env} env
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>}
 */
export async function runSlaChecks(env, now = Date.now()) {
  const db = env.DB;
  const rows =
    await /** @type {Promise<D1Result<ClockRow & { assignee: string | null; summary: string; system_id: string; security_level: string | null; project_key: string; number: number; first_response_warned_at: string | null; first_response_breached_at: string | null; resolution_warned_at: string | null; resolution_breached_at: string | null; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(
            `SELECT w.id AS item_id, w.created_at, w.resolved_at, w.priority, w.status, w.assignee, w.summary, w.system_id, w.security_level, s.key AS project_key, w.number,
         q.first_response_at, q.request_type_id, q.first_response_warned_at, q.first_response_breached_at, q.resolution_warned_at, q.resolution_breached_at
       FROM work_items w JOIN systems s ON s.id = w.system_id JOIN work_statuses st ON st.id = w.status JOIN sd_requests q ON q.item_id = w.id
       WHERE st.category <> 'DONE' LIMIT ?`,
          )
          .bind(MAX_OPEN_SCAN)
          .all()
      )
    );
  if (!rows.results.length) return 0;
  const clocks = await clocksFor(db, rows.results, now);
  const at = new Date(now).toISOString();
  const matrix = await roleMatrix(db);
  const users = await /** @type {Promise<D1Result<{ id: string; role: Role; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, role FROM users").all()));
  const managers = users.results.filter((u) => permissionsFor(u.role, matrix).includes("manage_service_desk")).map((u) => u.id);
  const viewers = await viewersOf(
    db,
    users.results.map((u) => u.id),
  );
  /** @type {Alert[]} */ const alerts = [];
  /** @type {D1PreparedStatement[]} */ const stmts = [];
  for (const r of rows.results) {
    const cl = /** @type {{ first: SlaClock; resolution: SlaClock; waiting: boolean; }} */ (clocks.get(r.item_id));
    const key = `${r.project_key}-${r.number}`;
    const link = `#/projects/${r.system_id}/items/${key}`;
    /** @type {[string, SlaClock, "first_response" | "resolution", string | null, string | null][]} */ const steps = [
      ["first response", cl.first, "first_response", r.first_response_warned_at, r.first_response_breached_at],
      ["resolution", cl.resolution, "resolution", r.resolution_warned_at, r.resolution_breached_at],
    ];
    for (const [label, clock, col, warned, breached] of steps) {
      if (clock.state === "met") continue;
      /** @type {"warn" | "breach" | null} */ let kind = null;
      if (clock.state === "breached" && !breached) kind = "breach";
      else if (clock.atRisk && !warned && clock.state !== "breached") kind = "warn";
      if (!kind) continue;
      stmts.push(db.prepare(`UPDATE sd_requests SET ${col}_${kind === "breach" ? "breached" : "warned"}_at = ? WHERE item_id = ?`).bind(at, r.item_id));
      // The assignee hears of a warning; the assignee and the service desk's managers hear of a breach.
      const who = /** @type {Set<string>} */ (/** @type {unknown} */ (new Set([...(r.assignee ? [r.assignee] : []), ...(kind === "breach" || !r.assignee ? managers : [])])));
      for (const id of who) {
        const v = viewers.get(id);
        if (!v || !(await canSeeItem(db, v, { assignee: r.assignee, reporter: "", security_level: r.security_level }))) continue;
        alerts.push({
          userId: id,
          kind: "sla",
          title: (kind === "breach" ? `SLA breached: ${key} ${label}` : `SLA at risk: ${key} ${label}`).slice(0, 200),
          body: `${r.summary}. ${formatBusinessMinutes(clock.elapsedMinutes)} of ${formatBusinessMinutes(clock.targetMinutes)} used.`.slice(0, 500),
          link,
          dedupe: `sla:${r.item_id}:${col}:${kind}`,
        });
      }
    }
  }
  if (stmts.length) await db.batch(stmts);
  if (alerts.length) await raise(env, alerts);
  return alerts.length;
}
/**
 * Ask AI: open requests by queue, and the ones at risk or breached, within the person's visibility.
 * @param {ItemContext} c
 * @returns {Promise<string[]>}
 */
export async function askServiceDeskLines(c) {
  if (c.guest || !c.can("work_service_desk")) return [];
  const open = await openRequests(c);
  if (!open.length) return [];
  const flag = /** @param {QueueItem} i */ (i) => (i.sla.firstResponse.state === "breached" || i.sla.resolution.state === "breached" ? "BREACHED" : i.sla.firstResponse.atRisk || i.sla.resolution.atRisk ? "at risk" : i.sla.firstResponse.state === "paused" ? "waiting for customer" : "on track");
  return [
    "",
    `SERVICE DESK (${open.length} open: ${open.filter((i) => !i.assignee).length} unassigned, ${open.filter(inQueue("at_risk", c.me.id)).length} at risk, ${open.filter(inQueue("breached", c.me.id)).length} breached)`,
    "key | type | customer | priority | status | assignee id | SLA",
    ...open.slice(0, 60).map((i) => [i.key, i.requestType, i.customerName, i.priority, i.statusName, i.assignee ?? "unassigned", flag(i)].map((x) => String(x).replace(/\|/g, "/")).join(" | ")),
  ];
}
/**
 * @typedef {Object} ClockRow
 * @property {string} item_id
 * @property {string} created_at
 * @property {string | null} first_response_at
 * @property {string | null} resolved_at
 * @property {WorkPriority} priority
 * @property {string} request_type_id
 * @property {string} status
 */
/**
 * @typedef {Object} RaiseBody
 * @property {unknown} [typeId]
 * @property {unknown} [summary]
 * @property {unknown} [description]
 * @property {unknown} [priority]
 * @property {unknown} [answers]
 * @property {unknown} [name]
 * @property {unknown} [email]
 * @property {unknown} [requesterKey]
 */
/**
 * @typedef {Object} PortalLinkRow
 * @property {string} id
 * @property {string} label
 * @property {string} created_by
 * @property {string} expires_at
 */
