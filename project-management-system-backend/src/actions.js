// Ask AI, phase (d) (docs/assistant-plan.md): the write tools, and the confirmation that runs them.
//   - A write tool never changes anything. It checks what the model asked for (the schema; ids it names must have
//     come from a lookup in this conversation; people by the names used), works out the ordinary API requests that
//     would make the change and a preview, and stores them as a proposal (ai_actions, migration 0031). The panel
//     shows it as a card with Confirm and Cancel.
//   - POST /api/assistant/actions/:id/confirm, from the person's own click, runs the requests once, in order, with
//     their own session (c.subrequest: the same handlers, permissions and checks as the rest of PMS). The model has
//     no way to confirm.
//   - POST /api/assistant/actions { tool, args }: a proposal straight from the panel (the "Create work items" button
//     under an extracted table), for create_work_items and create_risks only.
//   - POST /api/assistant/actions/:id/cancel, GET /api/assistant/actions/:id
//   - POST /api/systems/:id/notify { title, message }: an in-app notification to the people on a project (what
//     send_notification proposes), for its lead, Team Leaders, Managers and Administrators.
/** @typedef {import("./workitems").ItemContext} ItemContext */
/** @typedef {import("../../project-management-system-frontend/src/data/actions").ActionCard} ActionCard */
/** @typedef {import("../../project-management-system-frontend/src/data/actions").ActionRequest} ActionRequest */
import { HttpError, body, json } from "./http";
import { newToken } from "./auth";
import { ToolError, personRef, projectHref, projectRef } from "./toolkit";
import { itemByKey, toSummary } from "./workitems";
import { lifecycleSnapshot } from "./lifecycle";
import { runQuery } from "./search";
import { KITS } from "../../project-management-system-frontend/src/data/documentKits";
import { ACTION_TTL_MS, MAX_BULK, WORK_PRIORITIES, WORK_TYPES, fillPlaceholders } from "../../project-management-system-frontend/src/data/actions";
import { validateArgs } from "../../project-management-system-frontend/src/data/assistant";

const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
const KEY = "^[A-Za-z]{2,10}-\\d{1,7}$";
/** Who may change anything at all through the assistant: not view-only links, Readers or Viewers. */
const mayWrite = (/** @type {ItemContext} */ c) => !c.guest && c.me.role !== "reader" && c.me.role !== "viewer";
const WEEKDAY = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * An id the model names must have come from a lookup in this conversation (or from the page the person is on, or
 * their own words). Proposals made straight from the panel skip this: the person chose them.
 * @param {WriteContext} x
 * @param {string[]} ids  any one of them (a project's id or its key)
 */
function seen(x, ...ids) {
  if (!x.seen || ids.some((id) => id && x.seen?.(id))) return;
  throw new ToolError(`"${ids.find(Boolean)}" didn't come from a lookup in this conversation. Look it up first (find_projects, search_items, list_documents), then propose the change.`);
}
/** A project the model names, seen and visible. @param {ItemContext} c @param {WriteContext} x @param {unknown} ref */
async function seenProject(c, x, ref) {
  const p = await projectRef(c, ref);
  seen(x, String(ref), p.id, p.key);
  return p;
}
/** A work item the model names, seen and visible. @param {ItemContext} c @param {WriteContext} x @param {unknown} key */
async function seenItem(c, x, key) {
  const k = String(key ?? "").toUpperCase();
  seen(x, k);
  return itemByKey(c, k).catch(() => {
    throw new ToolError(`No work item ${k} that you can see.`);
  });
}
/** A person by name, once per name. @param {ItemContext} c */
const people = (c) => {
  /** @type {Map<string, Promise<{ id: string; name: string } | null>>} */ const memo = new Map();
  return (/** @type {unknown} */ who) => {
    const k = String(who ?? "").trim().toLowerCase();
    if (!memo.has(k)) memo.set(k, personRef(c, who));
    return /** @type {Promise<{ id: string; name: string } | null>} */ (memo.get(k));
  };
};

/**
 * Stores a proposal and returns its card.
 * @param {ItemContext} c
 * @param {{ tool: string; title: string; preview: ActionCard["preview"]; requests: ActionRequest[]; projectId?: string | null }} p
 * @returns {Promise<ActionCard>}
 */
async function propose(c, p) {
  if (!p.requests.length) throw new ToolError("There's nothing to change.");
  const id = newToken().slice(0, 16);
  const expiresAt = new Date(Date.parse(c.now) + ACTION_TTL_MS).toISOString();
  const title = p.title.slice(0, 300);
  await c.db
    .prepare("INSERT INTO ai_actions (id, user_id, tool, title, preview, requests, status, project_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?)")
    .bind(id, c.me.id, p.tool, title, JSON.stringify(p.preview), JSON.stringify(p.requests), p.projectId ?? null, c.now, expiresAt)
    .run();
  return { id, tool: p.tool, title, preview: p.preview, status: "proposed", expiresAt };
}
/** What the model is told about a proposal. @param {ActionCard} card */
const proposed = (card) => ({
  data: { proposed: true, actionId: card.id, title: card.title, note: "Shown to the person as a card with Confirm and Cancel. Nothing has changed yet: say what the card would do and that they need to check and confirm it." },
  sources: [],
  action: card,
});

// ----- the proposals -----

/** @param {ItemContext} c @param {WriteContext} x @param {Record<string, any>} a */
async function createItems(c, x, a) {
  const p = await seenProject(c, x, a.projectId);
  const person = people(c);
  /** @type {ActionRequest[]} */ const requests = [];
  /** @type {Record<string, unknown>[]} */ const rows = [];
  /** @type {string[]} */ const warnings = [];
  for (const it of /** @type {any[]} */ (a.items)) {
    const who = it.assignee ? await person(it.assignee).catch((e) => (warnings.push(`${e.message} "${it.summary}" is left unassigned.`), null)) : null;
    if (it.parentKey) await seenItem(c, x, it.parentKey);
    requests.push({
      method: "POST",
      path: "/api/items",
      body: { systemId: p.id, type: it.type ?? "TASK", summary: it.summary, ...(it.description ? { description: it.description } : {}), ...(it.priority ? { priority: it.priority } : {}), ...(who ? { assignee: who.id } : {}), ...(it.dueDate ? { dueDate: it.dueDate } : {}), ...(it.labels?.length ? { labels: it.labels } : {}), ...(it.parentKey ? { parent: String(it.parentKey).toUpperCase() } : {}) },
      label: `Create "${it.summary}"`,
    });
    rows.push({ type: it.type ?? "TASK", summary: it.summary, priority: it.priority ?? "", assignee: who?.name ?? "", due: it.dueDate ?? "" });
  }
  const n = requests.length;
  return propose(c, {
    tool: "create_work_items",
    title: `Create ${n} work ${n === 1 ? "item" : "items"} in ${p.name}`,
    projectId: p.id,
    preview: {
      fields: [["Project", p.name]],
      table: { columns: [{ key: "type", label: "Type" }, { key: "summary", label: "Summary" }, { key: "priority", label: "Priority" }, { key: "assignee", label: "Assignee" }, { key: "due", label: "Due" }], rows },
      ...(warnings.length ? { warnings } : {}),
    },
    requests,
  });
}

/** @param {ItemContext} c @param {WriteContext} x @param {Record<string, any>} a */
async function createRisks(c, x, a) {
  const p = await seenProject(c, x, a.projectId);
  await needLifecycle(c, p);
  const person = people(c);
  /** @type {string[]} */ const warnings = [];
  /** @type {ActionRequest[]} */ const requests = [];
  /** @type {Record<string, unknown>[]} */ const rows = [];
  for (const r of /** @type {any[]} */ (a.risks)) {
    const who = r.owner ? await person(r.owner).catch((e) => (warnings.push(`${e.message} The risk is added without an owner.`), null)) : null;
    requests.push({ method: "POST", path: `/api/systems/${p.id}/lifecycle/risks`, body: { risk: r.risk, likelihood: r.likelihood, impact: r.impact, mitigation: r.mitigation ?? "", ownerId: who?.id ?? null }, label: `Add "${r.risk}"` });
    rows.push({ risk: r.risk, rating: `${r.likelihood} × ${r.impact}`, owner: who?.name ?? "", mitigation: r.mitigation ?? "" });
  }
  return propose(c, {
    tool: "create_risks",
    title: `Add ${requests.length} ${requests.length === 1 ? "risk" : "risks"} to ${p.name}'s risk register`,
    projectId: p.id,
    preview: { fields: [["Project", p.name]], table: { columns: [{ key: "risk", label: "Risk" }, { key: "rating", label: "Likelihood × impact" }, { key: "owner", label: "Owner" }, { key: "mitigation", label: "Mitigation" }], rows }, ...(warnings.length ? { warnings } : {}) },
    requests,
  });
}

/** Risks and findings live in a project's lifecycle: without one there's nowhere to add them. @param {ItemContext} c @param {{ id: string; name: string }} p */
async function needLifecycle(c, p) {
  if (!(await c.db.prepare("SELECT 1 FROM project_lifecycle WHERE system_id = ?").bind(p.id).first())) throw new ToolError(`${p.name} has no lifecycle, so it has no risk register or security findings yet.`);
}

/** @type {WriteTool[]} */
export const WRITE_TOOLS = [
  {
    name: "create_work_items",
    description: "Propose new work items in a project (one or up to 50): type, summary, description, priority, assignee (a person's name), due date, labels, parent (an item key). The person sees a card and confirms; nothing is created until then.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", maxLength: 64 },
        items: {
          type: "array",
          maxItems: MAX_BULK,
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: WORK_TYPES },
              summary: { type: "string", maxLength: 200 },
              description: { type: "string", maxLength: 10000 },
              priority: { type: "string", enum: WORK_PRIORITIES },
              assignee: { type: "string", maxLength: 120 },
              dueDate: { type: "string", pattern: DATE },
              labels: { type: "array", maxItems: 10 },
              parentKey: { type: "string", pattern: KEY },
            },
            required: ["summary"],
          },
        },
      },
      required: ["projectId", "items"],
    },
    label: (a) => `Preparing ${Array.isArray(a.items) && a.items.length > 1 ? `${a.items.length} work items` : "a work item"}`,
    available: (c) => mayWrite(c) && c.can("create_work_items"),
    run: async (c, a, x) => proposed(await createItems(c, x, a)),
  },
  {
    name: "update_work_items",
    description: "Propose changes to one or more work items (up to 50, by key): status (its name), priority, assignee (a name), unassign, due date, labels to add. The person confirms on a card.",
    schema: {
      type: "object",
      properties: {
        keys: { type: "array", maxItems: MAX_BULK },
        changes: {
          type: "object",
          properties: { status: { type: "string", maxLength: 60 }, priority: { type: "string", enum: WORK_PRIORITIES }, assignee: { type: "string", maxLength: 120 }, unassign: { type: "boolean" }, dueDate: { type: "string", pattern: DATE }, addLabels: { type: "array", maxItems: 10 } },
        },
      },
      required: ["keys", "changes"],
    },
    label: (a) => `Preparing changes to ${Array.isArray(a.keys) ? a.keys.length : 1} work ${Array.isArray(a.keys) && a.keys.length === 1 ? "item" : "items"}`,
    available: (c) => mayWrite(c) && (c.can("edit_work_items") || c.can("edit_assigned")),
    run: async (c, a, x) => {
      const ch = /** @type {Record<string, any>} */ (a.changes);
      const keys = /** @type {string[]} */ (a.keys);
      if (!keys.length) throw new ToolError("Name at least one work item.");
      const status = ch.status ? /** @type {{ id: string; name: string } | null} */ (await c.db.prepare("SELECT id, name FROM work_statuses WHERE lower(name) = lower(?) LIMIT 1").bind(String(ch.status)).first()) : null;
      if (ch.status && !status) throw new ToolError(`There's no status "${ch.status}" in this workspace.`);
      const who = ch.assignee ? await personRef(c, ch.assignee) : null;
      /** @type {ActionRequest[]} */ const requests = [];
      /** @type {Record<string, unknown>[]} */ const rows = [];
      for (const k of keys) {
        const r = await seenItem(c, x, k);
        const s = toSummary(r);
        /** @type {Record<string, unknown>} */ const patch = {};
        /** @type {string[]} */ const changes = [];
        if (ch.priority && ch.priority !== s.priority) (patch.priority = ch.priority), changes.push(`priority ${s.priority} → ${ch.priority}`);
        if (who && who.id !== s.assignee) (patch.assignee = who.id), changes.push(`assignee → ${who.name}`);
        if (ch.unassign && s.assignee) (patch.assignee = null), changes.push("unassigned");
        if (ch.dueDate && ch.dueDate !== s.dueDate) (patch.dueDate = ch.dueDate), changes.push(`due ${s.dueDate ?? "none"} → ${ch.dueDate}`);
        const add = (/** @type {string[]} */ (ch.addLabels ?? [])).filter((l) => !s.labels.includes(l));
        if (add.length) (patch.labels = [...s.labels, ...add]), changes.push(`labels + ${add.join(", ")}`);
        if (Object.keys(patch).length) requests.push({ method: "PATCH", path: `/api/items/${s.key}`, body: patch, label: `Change ${s.key}` });
        if (status && status.id !== s.status) {
          requests.push({ method: "POST", path: `/api/items/${s.key}/transitions`, body: { to: status.id }, label: `Move ${s.key} to ${status.name}` });
          changes.push(`${s.statusName} → ${status.name}`);
        }
        if (changes.length) rows.push({ key: s.key, summary: s.summary, change: changes.join("; ") });
      }
      if (!requests.length) throw new ToolError("Those work items already have those values: nothing would change.");
      return proposed(await propose(c, { tool: "update_work_items", title: `Change ${rows.length} work ${rows.length === 1 ? "item" : "items"}`, preview: { table: { columns: [{ key: "key", label: "Key" }, { key: "summary", label: "Summary" }, { key: "change", label: "Change" }], rows } }, requests }));
    },
  },
  {
    name: "add_comment",
    description: "Propose a comment on a work item (by key). For a service desk request, toCustomer: true makes it a reply the customer sees. The person confirms on a card.",
    schema: { type: "object", properties: { key: { type: "string", pattern: KEY }, text: { type: "string", maxLength: 5000 }, toCustomer: { type: "boolean" } }, required: ["key", "text"] },
    label: () => "Preparing a comment",
    available: mayWrite,
    run: async (c, a, x) => {
      const r = await seenItem(c, x, a.key);
      const s = toSummary(r);
      return proposed(
        await propose(c, {
          tool: "add_comment",
          title: `${a.toCustomer ? "Reply to the customer" : "Comment"} on ${s.key}`,
          projectId: r.system_id,
          preview: { fields: [["Work item", `${s.key} ${s.summary}`], ...(a.toCustomer ? [/** @type {[string, string]} */ (["Seen by", "the customer"])] : []), ["Comment", String(a.text)]] },
          requests: [{ method: "POST", path: `/api/items/${s.key}/comments`, body: { body: a.text, ...(a.toCustomer ? { public: true } : {}) }, label: `Comment on ${s.key}` }],
        }),
      );
    },
  },
  {
    name: "log_work",
    description: "Propose logging the person's own time on a work item: minutes (1 to 1440), the date (YYYY-MM-DD, default today), a note. The person confirms on a card.",
    schema: { type: "object", properties: { key: { type: "string", pattern: KEY }, minutes: { type: "integer", minimum: 1, maximum: 1440 }, date: { type: "string", pattern: DATE }, note: { type: "string", maxLength: 1000 } }, required: ["key", "minutes"] },
    label: () => "Preparing a time entry",
    available: (c) => mayWrite(c) && c.can("log_time"),
    run: async (c, a, x) => {
      const r = await seenItem(c, x, a.key);
      const s = toSummary(r);
      const m = Number(a.minutes);
      const spent = `${Math.floor(m / 60) ? `${Math.floor(m / 60)}h ` : ""}${m % 60 ? `${m % 60}m` : ""}`.trim();
      return proposed(
        await propose(c, {
          tool: "log_work",
          title: `Log ${spent} on ${s.key}`,
          projectId: r.system_id,
          preview: { fields: [["Work item", `${s.key} ${s.summary}`], ["Time", spent], ["Date", String(a.date ?? c.now.slice(0, 10))], ...(a.note ? [/** @type {[string, string]} */ (["Note", String(a.note)])] : [])] },
          requests: [{ method: "POST", path: `/api/items/${s.key}/worklogs`, body: { minutes: m, ...(a.date ? { date: a.date } : {}), ...(a.note ? { note: a.note } : {}) }, label: `Log ${spent} on ${s.key}` }],
        }),
      );
    },
  },
  {
    name: "request_update",
    description: "Propose asking a project's team for an update, with a message, by in-app chat, email or Teams (where connected). The person confirms on a card.",
    schema: { type: "object", properties: { projectId: { type: "string", maxLength: 64 }, message: { type: "string", maxLength: 1000 }, via: { type: "array", maxItems: 3 } }, required: ["projectId", "message"] },
    label: () => "Preparing an update request",
    available: (c) => mayWrite(c) && c.can("request_updates"),
    run: async (c, a, x) => {
      const p = await seenProject(c, x, a.projectId);
      const via = /** @type {string[]} */ (a.via ?? []).filter((v) => ["chat", "email", "teams"].includes(v));
      return proposed(
        await propose(c, {
          tool: "request_update",
          title: `Ask ${p.name}'s team for an update`,
          projectId: p.id,
          preview: { fields: [["Project", p.name], ["Message", String(a.message)], ...(via.length ? [/** @type {[string, string]} */ (["Sent by", via.join(", ")])] : [])] },
          requests: [{ method: "POST", path: "/api/requests", body: { systemId: p.id, message: a.message, ...(via.length ? { via } : {}) }, label: "Send the request" }],
        }),
      );
    },
  },
  {
    name: "create_risks",
    description: "Propose adding risks to a project's risk register: each with the risk, likelihood and impact (1 to 5), mitigation and owner (a name). The person confirms on a card.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", maxLength: 64 },
        risks: {
          type: "array",
          maxItems: MAX_BULK,
          items: { type: "object", properties: { risk: { type: "string", maxLength: 500 }, likelihood: { type: "integer", minimum: 1, maximum: 5 }, impact: { type: "integer", minimum: 1, maximum: 5 }, mitigation: { type: "string", maxLength: 1000 }, owner: { type: "string", maxLength: 120 } }, required: ["risk", "likelihood", "impact"] },
        },
      },
      required: ["projectId", "risks"],
    },
    label: () => "Preparing risks for the register",
    available: mayWrite,
    run: async (c, a, x) => proposed(await createRisks(c, x, a)),
  },
  {
    name: "create_finding",
    description: "Propose recording a security finding on a project: title, severity (Critical, High, Medium, Low, Info) and detail. The person confirms on a card.",
    schema: { type: "object", properties: { projectId: { type: "string", maxLength: 64 }, title: { type: "string", maxLength: 200 }, severity: { type: "string", enum: ["Critical", "High", "Medium", "Low", "Info"] }, detail: { type: "string", maxLength: 2000 } }, required: ["projectId", "title", "severity"] },
    label: () => "Preparing a security finding",
    available: mayWrite,
    run: async (c, a, x) => {
      const p = await seenProject(c, x, a.projectId);
      await needLifecycle(c, p);
      return proposed(
        await propose(c, {
          tool: "create_finding",
          title: `Record a ${a.severity} finding on ${p.name}`,
          projectId: p.id,
          preview: { fields: [["Project", p.name], ["Finding", String(a.title)], ["Severity", String(a.severity)], ...(a.detail ? [/** @type {[string, string]} */ (["Detail", String(a.detail)])] : [])] },
          requests: [{ method: "POST", path: `/api/systems/${p.id}/lifecycle/findings`, body: { title: a.title, severity: a.severity, detail: a.detail ?? "" }, label: "Record the finding" }],
        }),
      );
    },
  },
  {
    name: "draft_document",
    description: "Propose writing sections of a project's draft BRS, BSS or release notes (kind brs, bss or release_notes): each section by its title, with its text. Only the draft changes: it is never submitted, and signed or locked versions are never touched. The person confirms on a card.",
    schema: {
      type: "object",
      properties: {
        projectId: { type: "string", maxLength: 64 },
        kind: { type: "string", enum: ["brs", "bss", "release_notes"] },
        sections: { type: "array", maxItems: 20, items: { type: "object", properties: { section: { type: "string", maxLength: 120 }, text: { type: "string", maxLength: 20000 } }, required: ["section", "text"] } },
      },
      required: ["projectId", "kind", "sections"],
    },
    label: (a) => `Drafting the ${String(a.kind).replace("_", " ").toUpperCase()}`,
    available: mayWrite,
    run: async (c, a, x) => {
      const p = await seenProject(c, x, a.projectId);
      const kit = /** @type {Record<string, import("../../project-management-system-frontend/src/data/documentKits").Kit>} */ (KITS)[String(a.kind)];
      const texts = kit.sections.filter((s) => s.kind === "text");
      const norm = (/** @type {string} */ t) => t.toLowerCase().replace(/^[\d.\s]+/, "").replace(/[^a-z0-9]+/g, " ").trim();
      /** @type {Record<string, string>} */ const set = {};
      /** @type {[string, string][]} */ const fields = [];
      for (const s of /** @type {{ section: string; text: string }[]} */ (a.sections)) {
        const sec = texts.find((t) => t.key === s.section || norm(t.title) === norm(s.section)) ?? texts.find((t) => norm(t.title).includes(norm(s.section)));
        if (!sec) throw new ToolError(`The ${kit.short} has no text section "${s.section}". Its text sections: ${texts.map((t) => t.title).join("; ")}.`);
        set[sec.key] = s.text;
        fields.push([sec.title, s.text.length > 600 ? `${s.text.slice(0, 600)}…` : s.text]);
      }
      // The draft as it stands (or the new one PMS would start), with these sections written in.
      const now = await /** @type {NonNullable<ItemContext["subrequest"]>} */ (c.subrequest)("GET", `/api/systems/${p.id}/docs/${kit.kind}`);
      if (now.status >= 400) throw new ToolError(now.data?.error ?? `The ${kit.short} can't be opened.`);
      return proposed(
        await propose(c, {
          tool: "draft_document",
          title: `Write ${fields.length} ${fields.length === 1 ? "section" : "sections"} of ${p.name}'s ${kit.short} draft`,
          projectId: p.id,
          preview: { fields: [["Document", `${kit.name}, draft v${now.data?.version?.version ?? 1}`], ...fields], warnings: ["Only the draft changes. It isn't submitted: submit it from the project's Documents tab when it's ready."] },
          requests: [{ method: "PUT", path: `/api/systems/${p.id}/docs/${kit.kind}`, body: { data: { ...(now.data?.data ?? {}), ...set } }, label: `Save the ${kit.short} draft` }],
        }),
      );
    },
  },
  {
    name: "schedule_report",
    description: "Propose a report by email: a saved filter (a name and its PQL) and a subscription to it, daily or weekly (weekday 1 = Monday … 7 = Sunday) at an hour (0 to 23, the organisation's time). The person confirms on a card.",
    schema: { type: "object", properties: { name: { type: "string", maxLength: 80 }, pql: { type: "string", maxLength: 1000 }, frequency: { type: "string", enum: ["daily", "weekly"] }, weekday: { type: "integer", minimum: 1, maximum: 7 }, hour: { type: "integer", minimum: 0, maximum: 23 } }, required: ["name", "pql", "frequency", "hour"] },
    label: () => "Preparing a scheduled report",
    available: mayWrite,
    run: async (c, a) => {
      try {
        await runQuery(c.db, String(a.pql), c.viewer, Date.parse(c.now), 1, 0);
      } catch (e) {
        throw new ToolError(`That PQL didn't work: ${e instanceof Error ? e.message : "invalid query"}.`);
      }
      const weekday = a.frequency === "weekly" ? Number(a.weekday ?? 1) : null;
      const when = `${a.frequency === "weekly" ? `Every ${WEEKDAY[/** @type {number} */ (weekday)]}` : "Every day"} at ${String(a.hour).padStart(2, "0")}:00`;
      return proposed(
        await propose(c, {
          tool: "schedule_report",
          title: `Email "${a.name}" ${when.toLowerCase()}`,
          preview: { fields: [["Report", String(a.name)], ["Work items", String(a.pql)], ["When", when], ["To", "you"]] },
          requests: [
            { method: "POST", path: "/api/filters", body: { name: a.name, pql: a.pql }, label: `Save the filter "${a.name}"` },
            { method: "POST", path: "/api/filters/{{0.id}}/subscriptions", body: { frequency: a.frequency, weekday, hour: a.hour }, label: "Subscribe to it by email", dependsOn: 0 },
          ],
        }),
      );
    },
  },
  {
    name: "create_automation_rule",
    description:
      'Propose an automation rule, saved switched off for the person to check and turn on. `rule` is the rule as JSON, as POST /api/automation/rules takes it: { "name", "trigger", "triggerValue"?, "triggerConfig"?, "conditions"?, "conditionPql"?, "actions": [{ "kind", "value"? }] }. The person confirms on a card.',
    schema: { type: "object", properties: { rule: { type: "string", maxLength: 8000 } }, required: ["rule"] },
    label: () => "Preparing an automation rule",
    available: (c) => mayWrite(c) && c.can("manage_automation"),
    run: async (c, a) => {
      /** @type {any} */ let rule;
      try {
        rule = JSON.parse(String(a.rule));
      } catch {
        throw new ToolError("The rule isn't valid JSON.");
      }
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new ToolError("The rule must be a JSON object.");
      // Always saved off, and only for this workspace.
      const { sharedScope: _s, sharedWorkspaces: _w, ...own } = rule;
      const draft = { ...own, enabled: false };
      const check = await /** @type {NonNullable<ItemContext["subrequest"]>} */ (c.subrequest)("POST", "/api/automation/test", { rule: draft });
      if (check.status >= 400) throw new ToolError(`That rule wouldn't save: ${check.data?.error ?? `error ${check.status}`}.`);
      const actions = /** @type {any[]} */ (Array.isArray(draft.actions) ? draft.actions : []);
      return proposed(
        await propose(c, {
          tool: "create_automation_rule",
          title: `Create the automation rule "${String(draft.name ?? "Untitled")}", switched off`,
          preview: { fields: [["Rule", String(draft.name ?? "")], ["When", String(draft.trigger ?? "")], ["Then", actions.map((x) => x.kind).join(", ") || "nothing"], ...(Array.isArray(check.data?.actions) && check.data.actions.length ? [/** @type {[string, string]} */ (["It would", check.data.actions.join("; ")])] : [])], warnings: ["Saved switched off: check it in Settings → Automations and turn it on there."] },
          requests: [{ method: "POST", path: "/api/automation/rules", body: draft, label: "Save the rule, switched off" }],
        }),
      );
    },
  },
  {
    name: "advance_stage",
    description: "Propose moving a project to its next lifecycle stage. Only when the current stage's gate is met: otherwise it says what's missing. The person confirms on a card.",
    schema: { type: "object", properties: { projectId: { type: "string", maxLength: 64 }, comment: { type: "string", maxLength: 500 } }, required: ["projectId"] },
    label: () => "Checking the stage gate",
    available: mayWrite,
    run: async (c, a, x) => {
      const p = await seenProject(c, x, a.projectId);
      const s = await lifecycleSnapshot(c, p.id);
      if (!s) throw new ToolError(`${p.name} has no lifecycle.`);
      if (s.closed) throw new ToolError(`${p.name}'s lifecycle is closed.`);
      if (!s.ready) throw new ToolError(`The ${s.stage.name} gate isn't met yet. Still missing: ${s.gate.filter((g) => !g.ok).map((g) => g.label).join("; ")}.`);
      const at = s.def.stages.findIndex((st) => st.code === s.stage.code);
      const next = s.def.stages[at + 1]?.name ?? "the end of the lifecycle";
      return proposed(
        await propose(c, {
          tool: "advance_stage",
          title: `Move ${p.name} from ${s.stage.name} to ${next}`,
          projectId: p.id,
          preview: { fields: [["Project", p.name], ["From", s.stage.name], ["To", next], ...(a.comment ? [/** @type {[string, string]} */ (["Comment", String(a.comment)])] : [])] },
          requests: [{ method: "POST", path: `/api/systems/${p.id}/lifecycle/advance`, body: a.comment ? { comment: a.comment } : {}, label: `Move to ${next}` }],
        }),
      );
    },
  },
  {
    name: "send_notification",
    description: "Propose an in-app notification to the people on a project (its lead and developers): a title and a message. The person confirms on a card.",
    schema: { type: "object", properties: { projectId: { type: "string", maxLength: 64 }, title: { type: "string", maxLength: 120 }, message: { type: "string", maxLength: 1000 } }, required: ["projectId", "title", "message"] },
    label: () => "Preparing a notification",
    available: mayWrite,
    run: async (c, a, x) => {
      const p = await seenProject(c, x, a.projectId);
      return proposed(
        await propose(c, {
          tool: "send_notification",
          title: `Notify the people on ${p.name}`,
          projectId: p.id,
          preview: { fields: [["Project", p.name], ["To", "its lead and developers, in PMS"], ["Title", String(a.title)], ["Message", String(a.message)]] },
          requests: [{ method: "POST", path: `/api/systems/${p.id}/notify`, body: { title: a.title, message: a.message }, label: "Send the notification" }],
        }),
      );
    },
  },
];

/** Proposals the panel may make itself (from an extracted table). */
const FROM_PANEL = new Set(["create_work_items", "create_risks"]);

/** A stored proposal as its card. @param {any} r @param {Partial<ActionCard>} [over] @returns {ActionCard} */
const cardOf = (r, over = {}) => ({ id: r.id, tool: r.tool, title: r.title, preview: JSON.parse(r.preview), status: r.status, expiresAt: r.expires_at, ...(r.result ? { results: JSON.parse(r.result) } : {}), ...over });
/** Where a created thing opens. @param {any} d */
const hrefOf = (d) => (d && typeof d.key === "string" && typeof d.systemId === "string" ? projectHref(d.systemId, `items/${d.key}`) : undefined);

/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function actionsApi(c, path, method) {
  const notify = path.match(/^\/api\/systems\/([a-z0-9-]+)\/notify$/);
  if (notify && method === "POST") return notifyProject(c, notify[1]);
  if (!path.startsWith("/api/assistant/actions")) return null;
  if (!mayWrite(c)) throw new HttpError(403, "Ask AI can't change anything for you here");
  if (path === "/api/assistant/actions" && method === "POST") {
    const b = /** @type {{ tool?: unknown; args?: unknown }} */ (await body(c.req));
    const tool = WRITE_TOOLS.find((t) => t.name === b.tool && FROM_PANEL.has(t.name));
    if (!tool || !tool.available(c)) throw new HttpError(400, "That can't be proposed from here");
    const v = validateArgs(tool.schema, /** @type {Record<string, unknown>} */ (b.args && typeof b.args === "object" ? b.args : {}));
    if (!v.ok) throw new HttpError(400, v.error);
    try {
      const card = tool.name === "create_risks" ? await createRisks(c, {}, v.value) : await createItems(c, {}, v.value);
      return json(card, 201);
    } catch (e) {
      if (e instanceof ToolError) throw new HttpError(400, e.message);
      throw e;
    }
  }
  const m = path.match(/^\/api\/assistant\/actions\/([a-f0-9]{16})(\/confirm|\/cancel)?$/);
  if (!m) return null;
  const row = /** @type {any} */ (await c.db.prepare("SELECT * FROM ai_actions WHERE id = ? AND user_id = ?").bind(m[1], c.me.id).first());
  if (!row) throw new HttpError(404, "Not found");
  const expired = row.status === "proposed" && row.expires_at <= c.now;
  if (!m[2] && method === "GET") return json(cardOf(row, expired ? { status: "cancelled" } : {}));
  if (method !== "POST") throw new HttpError(405, "Method not allowed");
  if (m[2] === "/cancel") {
    if (row.status === "proposed") await c.db.prepare("UPDATE ai_actions SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'proposed'").bind(c.now, row.id).run();
    return json(cardOf({ ...row, status: row.status === "proposed" ? "cancelled" : row.status }));
  }
  // Confirm: only once, only while it's fresh.
  if (expired) throw new HttpError(410, "This proposal has expired: ask again", "action_expired");
  const claimed = await c.db.prepare("UPDATE ai_actions SET status = 'running', decided_at = ? WHERE id = ? AND status = 'proposed' AND expires_at > ?").bind(c.now, row.id, c.now).run();
  if (!claimed.meta.changes) throw new HttpError(409, "This proposal was already confirmed or cancelled", "action_decided");
  const requests = /** @type {ActionRequest[]} */ (JSON.parse(row.requests));
  /** @type {unknown[]} */ const outputs = [];
  /** @type {NonNullable<ActionCard["results"]>} */ const results = [];
  for (const [i, r] of requests.entries()) {
    if (r.dependsOn !== undefined && !results[r.dependsOn]?.ok) {
      results.push({ ok: false, label: r.label, message: "Not done: the step before it failed" });
      continue;
    }
    // Only ordinary API requests, never the assistant's own.
    if (!r.path.startsWith("/api/") || r.path.startsWith("/api/assistant")) {
      results.push({ ok: false, label: r.label, message: "Refused" });
      continue;
    }
    try {
      const filled = fillPlaceholders({ path: r.path, body: r.body }, outputs);
      const res = await /** @type {NonNullable<ItemContext["subrequest"]>} */ (c.subrequest)(r.method, filled.path, filled.body);
      outputs[i] = res.data;
      const ok = res.status < 300;
      const href = ok ? hrefOf(res.data) : undefined;
      // What was made, by its key: "Created WCC-27: Email payslips".
      const made = ok && typeof res.data?.key === "string" ? `Created ${res.data.key}${res.data.summary ? `: ${String(res.data.summary).slice(0, 70)}${String(res.data.summary).length > 70 ? "…" : ""}` : ""}` : null;
      results.push({ ok, label: made ?? r.label, ...(ok ? {} : { message: String(res.data?.error ?? `Failed (${res.status})`).slice(0, 300) }), ...(href ? { href } : {}) });
    } catch (e) {
      results.push({ ok: false, label: r.label, message: e instanceof Error ? e.message.slice(0, 300) : "Failed" });
    }
  }
  const done = results.filter((r) => r.ok).length;
  const status = done === results.length ? "done" : done ? "partly_done" : "failed";
  await c.db.prepare("UPDATE ai_actions SET status = ?, result = ? WHERE id = ?").bind(status, JSON.stringify(results), row.id).run();
  await c.audit("assistant_action", row.project_id, { tool: row.tool, title: row.title, steps: results.length, done, outcome: status });
  return json(cardOf({ ...row, status, result: JSON.stringify(results) }));
}

/**
 * An in-app notification to the people on a project: its lead and developers (not the sender).
 * @param {ItemContext} c
 * @param {string} systemId
 */
async function notifyProject(c, systemId) {
  if (!mayWrite(c)) throw new HttpError(403, "You can't send notifications");
  const p = await projectRef(c, systemId).catch(() => {
    throw new HttpError(404, "Project not found");
  });
  const sys = /** @type {{ data: string }} */ (await c.db.prepare("SELECT data FROM systems WHERE id = ?").bind(p.id).first());
  const lead = /** @type {{ lead?: string }} */ (JSON.parse(sys.data)).lead ?? null;
  if (!(["admin", "manager", "team_lead"].includes(c.me.role) || c.can("manage_systems") || lead === c.me.id)) throw new HttpError(403, "Only the project's lead, Team Leaders, Managers and Administrators can notify its people");
  const b = /** @type {{ title?: unknown; message?: unknown }} */ (await body(c.req));
  const title = String(b.title ?? "").trim().slice(0, 120);
  const message = String(b.message ?? "").trim().slice(0, 1000);
  if (!title || !message) throw new HttpError(400, "Give a title and a message");
  const devs = /** @type {{ user_id: string }[]} */ ((await c.db.prepare("SELECT user_id FROM assignments WHERE system_id = ?").bind(p.id).all()).results).map((r) => r.user_id);
  const to = [...new Set([lead, ...devs].filter((u) => u && u !== c.me.id))];
  c.alert?.(to.map((userId) => ({ userId: /** @type {string} */ (userId), kind: "watching", title: `${p.name}: ${title}`, body: `${message}\n\n${c.me.name}`, link: projectHref(p.id) })));
  await c.audit("project_notified", p.id, { name: p.name, title, people: to.length });
  return json({ ok: true, people: to.length });
}

/**
 * What a write tool gets besides the person's context: the model and request marker (as the read tools), and
 * `seen`, which says whether an id came from a lookup in this conversation (absent for proposals from the panel).
 * @typedef {{ ai?: Ai; model?: string; nonce?: string; seen?: (id: string) => boolean }} WriteContext
 * @typedef {Object} WriteTool
 * @property {string} name
 * @property {string} description
 * @property {import("../../project-management-system-frontend/src/data/assistant").ToolSchema} schema
 * @property {(args: Record<string, unknown>) => string} label
 * @property {(c: ItemContext) => boolean} available
 * @property {(c: ItemContext, args: Record<string, any>, x: WriteContext) => Promise<{ data: unknown; sources: { label: string; href: string }[]; action: ActionCard }>} run
 */
