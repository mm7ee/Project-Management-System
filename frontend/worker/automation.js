/** @import { Alert, ChannelPost } from './notify' */
/** @import { ItemContext, ItemEvent, ItemRow } from './workitems' */
/** @import { Role } from '../src/data/roles' */
/** @import { Viewer } from './access' */
/** @import { ActionKind, AutomationAction, AutomationRule, AutomationRun, Trigger } from '../src/data/search' */
/** @import { ConditionGroup, EvalItem, TriggerConfig } from '../src/data/automation' */
// Automation: WHEN something happens IF conditions hold THEN act.
//
// Triggers: work item and sprint events, an item being assigned, a due date coming up or passing, a schedule (every
// day, working day, week or month at a time, in the organisation's time zone), another system calling the rule's
// webhook, or someone pressing the rule's button on an item.
// Conditions: AND/OR groups (src/data/automation.js) and/or a PQL query.
// Actions: move, assign (a person, by role, round-robin or least loaded), set, clear or label, comment, notify,
// create a sub-task or an item (here or in another workspace), link, email, WhatsApp/SMS, call a webhook, escalate.
//
// Rules act as "Automation: <rule name>" with full rights in their workspace, through the same code people use, so
// workflow moves, the activity log, history and alerts behave as usual. Each piece of work is a job in
// automation_jobs: tried at once, and when it fails before changing anything, again after 1, 2, 4 and 8 minutes; then
// it's failed and the rule's owner is told. Loop protection: events caused by rules go at most MAX_AUTOMATION_DEPTH
// levels deep; a rule runs at most MAX_PER_ITEM_HOUR times an hour on one item and max_per_minute times a minute;
// an organisation's rules run at most ORG_RUNS_PER_MINUTE times a minute between them. Every run is logged in
// automation_runs, with each condition's result and what each action did.
import { newToken, openSecret, sealSecret, tokenHash } from "./auth";
import { HttpError, body, json } from "./http";
import { postToTeams, raise, readDelivery, sendEmail } from "./notify";
import { filterSql } from "./search";
import { SELECT, addComment, afterChange, applyChange, createItem, itemById, itemByKey, keyOf, personWithRole, transitionItem } from "./workitems";
import { loadWorkflow, statusCatalogue, workflowIdFor } from "./workflowData";
import { customValuesFor } from "./customfields";
import { sendMessage } from "./messaging";
import { relativeDate } from "../src/data/pql";
import { ROLES, assignable, permissionsFor } from "../src/data/roles";
import { canSeeItem, roleMatrix, viewersOf } from "./access";
import { dispatchWebhooks } from "./integrations";
import { ACTIONS, BULK_TRIGGERS, MAX_AUTOMATION_DEPTH, SETTABLE_FIELDS, TRIGGERS } from "../src/data/search";
import { LINK_TYPES, WORK_PRIORITIES, cleanLabel } from "../src/data/workitems";
import { checkTransition, transitionsFrom } from "../src/data/workflows";
import { MESSAGE_CHANNELS, PRESETS, addWorkingDays, cleanConditions, describeSchedule, evaluateConditions, localTime, renderTemplate, scheduleOccasion } from "../src/data/automation";
/** @type {Viewer} */ const AUTOMATION_VIEWER = { id: "automation", role: /** @type {Role} */ ("admin"), ownOnly: false, all: true };
export const MAX_ATTEMPTS = 5;
export const MAX_PER_ITEM_HOUR = 10;
export const ORG_RUNS_PER_MINUTE = 600;
/** Actions that happen once per run of a bulk trigger, not once per matching item. */
const ONCE_PER_RUN = /** @type {ActionKind[]} */ (["create_item", "webhook"]);
const CLEARABLE = /** @type {Record<string, Record<string, unknown>>} */ ({
  dueDate: { dueDate: null },
  startDate: { startDate: null },
  component: { component: null },
  storyPoints: { storyPoints: null },
  labels: { labels: [] },
  description: { description: "" },
  assignee: { assignee: null },
});

/**
 * @param {D1Database} db
 * @param {string} [where="TRUE"]
 * @param {unknown[]} [args=[]]
 */
async function loadRules(db, where = "TRUE", args = []) {
  const rules = /** @type {D1Result<RuleRow>} */ (
    await db
      .prepare(`SELECT * FROM automation_rules WHERE ${where} ORDER BY name`)
      .bind(...args)
      .all()
  );
  if (!rules.results.length) return [];
  const ids = rules.results.map((r) => r.id);
  const marks = ids.map(() => "?").join(", ");
  const actions = /** @type {D1Result<ActionRow>} */ (await db.prepare(`SELECT * FROM automation_actions WHERE rule_id IN (${marks}) ORDER BY position`).bind(...ids).all());
  const last = /** @type {D1Result<{ rule_id: string; status: AutomationRun["status"]; }>} */ (await db.prepare(`SELECT DISTINCT ON (rule_id) rule_id, status FROM automation_runs WHERE rule_id IN (${marks}) ORDER BY rule_id, id DESC`).bind(...ids).all());
  const owners = /** @type {D1Result<{ id: string; name: string }>} */ (await db.prepare("SELECT id, name FROM users").all());
  const ownerName = new Map(owners.results.map((u) => [u.id, u.name]));
  return rules.results.map((r) => ({
    row: r,
    actionRows: actions.results.filter((a) => a.rule_id === r.id),
    rule: /** @type {AutomationRule} */ ({
      id: r.id,
      name: r.name,
      description: r.description,
      enabled: !!r.enabled,
      scope: r.scope,
      ...(r.scope_value ? { scopeValue: r.scope_value } : {}),
      trigger: r.trigger,
      ...(r.trigger_value ? { triggerValue: r.trigger_value } : {}),
      ...(r.schedule_weekday != null ? { scheduleWeekday: Number(r.schedule_weekday) } : {}),
      ...(r.schedule_hour != null ? { scheduleHour: Number(r.schedule_hour) } : {}),
      ...(triggerConfigOf(r) ? { triggerConfig: triggerConfigOf(r) } : {}),
      conditionPql: r.condition_pql,
      conditions: r.conditions ? JSON.parse(r.conditions) : null,
      maxPerMinute: Number(r.max_per_minute),
      ownerId: r.owner_id ?? r.created_by,
      ownerName: ownerName.get(r.owner_id ?? r.created_by) ?? "a former user",
      ...(r.shared_scope ? { sharedScope: r.shared_scope } : {}),
      hasWebhook: !!r.webhook_token_hash,
      actions: actions.results
        .filter((a) => a.rule_id === r.id)
        .map(/** @returns {AutomationAction} */ (a) => ({ id: a.id, kind: a.kind, ...(a.field ? { field: a.field } : {}), ...(a.value ? { value: a.value } : {}), ...(a.value2 ? { value2: a.value2 } : {}) })),
      ...(r.last_run_at ? { lastRunAt: r.last_run_at } : {}),
      ...(last.results.find((l) => l.rule_id === r.id) ? { lastStatus: /** @type {{ status: AutomationRun["status"] }} */ (last.results.find((l) => l.rule_id === r.id)).status } : {}),
    }),
  }));
}
/**
 * A rule's trigger settings. Schedules made before phase 3 (an hour, maybe a weekday) read as the same schedule.
 * @param {RuleRow} r
 * @returns {TriggerConfig | undefined}
 */
function triggerConfigOf(r) {
  if (r.trigger_config) return JSON.parse(r.trigger_config);
  if (r.trigger === "schedule" && r.schedule_hour != null) {
    const time = `${String(r.schedule_hour).padStart(2, "0")}:00`;
    return r.schedule_weekday != null ? { every: "week", weekday: Number(r.schedule_weekday), time } : { every: "day", time };
  }
  return undefined;
}

/**
 * The organisation and workspace a rule runs in: names, time zone and working days.
 * @param {D1Database} db  scoped to the workspace
 * @returns {Promise<OrgInfo>}
 */
async function orgInfo(db) {
  const ws = /** @type {Scope} */ (/** @type {TenantDatabase} */ (/** @type {unknown} */ (db)).scope);
  const o = /** @type {{ name: string; time_zone: string; work_days: string } | null} */ (await db.prepare("SELECT name, time_zone, work_days FROM organizations WHERE id = ?").bind(ws.orgId).first());
  const w = /** @type {{ name: string } | null} */ (await db.prepare("SELECT name FROM workspaces WHERE id = ?").bind(ws.workspaceId).first());
  return {
    orgId: ws.orgId,
    workspaceId: ws.workspaceId,
    orgName: o?.name ?? "",
    workspaceName: w?.name ?? "",
    timeZone: o?.time_zone ?? "Africa/Harare",
    workDays: String(o?.work_days ?? "1,2,3,4,5")
      .split(",")
      .map(Number),
  };
}

/**
 * The context a rule acts in: full rights in its workspace, logged as the rule, its alerts and events collected.
 * @param {Env} env
 * @param {RuleRow} rule
 * @param {Alert[]} alerts
 * @param {ItemEvent[]} events
 * @param {ChannelPost[]} [posts=[]]
 * @returns {ItemContext}
 */
function ruleContext(env, rule, alerts, events, posts = []) {
  const name = `Automation: ${rule.name}`.slice(0, 64);
  return {
    db: env.DB,
    req: new Request("https://automation.pulse/"),
    me: { id: "automation", name, username: "automation", role: "admin" },
    guest: false,
    can: () => true,
    ownOnly: false,
    viewer: AUTOMATION_VIEWER,
    env,
    now: new Date().toISOString(),
    audit: async (action, target, detail) => {
      await env.DB.prepare("INSERT INTO activity (at, user_id, actor, action, target, detail, ip, agent) VALUES (?, NULL, ?, ?, ?, ?, NULL, 'automation')")
        .bind(new Date().toISOString(), name, action, target, JSON.stringify({ ...detail, automation: rule.name }))
        .run()
        .catch(() => undefined);
    },
    alert: (a, channel) => {
      alerts.push(...a);
      if (channel) posts.push(channel);
    },
    emit: (e) => events.push({ ...e, by: "automation" }),
  };
}

/**
 * The smart values for an item (and for a run with no item: the workspace's, the trigger's, the date).
 * @param {Env} env
 * @param {OrgInfo} info
 * @param {ItemRow | null} r
 * @param {Map<string, string>} names
 * @param {string | undefined} by  who set the rule off
 * @param {Record<string, unknown>} [payload]  a webhook trigger's JSON body (top-level values)
 * @returns {Record<string, string>}
 */
function smartValues(env, info, r, names, by, payload = {}) {
  const now = Date.now();
  const local = localTime(now, info.timeZone);
  /** @type {Record<string, string>} */ const v = {
    "workspace.name": info.workspaceName,
    "organization.name": info.orgName,
    "trigger.user.name": by === "automation" ? "an automation rule" : by ? (names.get(by) ?? "someone") : "a schedule",
    now: `${local.day} ${local.time}`,
    today: local.day,
  };
  for (const [k, x] of Object.entries(payload)) if (/^[a-zA-Z]\w{0,40}$/.test(k) && (typeof x === "string" || typeof x === "number" || typeof x === "boolean")) v[`webhook.${k}`] = String(x).slice(0, 500);
  if (!r) return v;
  return {
    ...v,
    "item.key": keyOf(r),
    "item.title": r.summary,
    "item.summary": r.summary,
    "item.status": r.status_name,
    "item.priority": r.priority.charAt(0) + r.priority.slice(1).toLowerCase(),
    "item.type": r.item_type_name ?? r.type,
    "item.assignee.name": r.assignee ? (names.get(r.assignee) ?? "someone") : "nobody",
    "item.reporter.name": names.get(r.reporter) ?? "someone",
    "item.dueDate": r.due_date ?? "",
    "item.url": `${env.PUBLIC_URL ?? ""}/#/projects/${r.system_id}/items/${keyOf(r)}`,
    "project.name": r.project_name,
  };
}

/**
 * What conditions see of an item.
 * @param {D1Database} db
 * @param {ItemRow} r
 * @returns {Promise<EvalItem>}
 */
async function evalItemOf(db, r) {
  const [role, values] = await Promise.all([
    r.assignee ? /** @type {Promise<{ role: string } | null>} */ (db.prepare("SELECT role FROM users WHERE id = ?").bind(r.assignee).first()) : Promise.resolve(null),
    customValuesFor(db, [r.id]),
  ]);
  /** @type {EvalItem["custom"]} */ const custom = {};
  for (const v of values.get(r.id) ?? []) {
    // Choices are compared by their labels; the rest by value.
    custom[v.fieldId] = v.kind === "select" ? v.display : v.kind === "multiselect" ? v.display.split(", ").filter(Boolean) : /** @type {any} */ (v.value);
  }
  return {
    type: r.item_type ?? r.type,
    kind: r.type,
    priority: r.priority,
    status: r.status,
    statusName: r.status_name,
    statusCategory: /** @type {any} */ (r).status_category,
    assignee: r.assignee,
    assigneeRole: role?.role ?? null,
    reporter: r.reporter,
    labels: r.labels ? r.labels.split(",") : [],
    summary: r.summary,
    description: r.description,
    component: r.component,
    dueDate: r.due_date,
    storyPoints: r.story_points == null ? null : Number(r.story_points),
    custom,
  };
}

/**
 * @param {D1Database} db
 * @param {RuleRow} rule
 * @param {string} systemId
 * @returns {Promise<boolean>}
 */
async function inScope(db, rule, systemId) {
  if (rule.scope === "global") return true;
  if (rule.scope === "project") return rule.scope_value === systemId;
  const ws = /** @type {{ w: string | null } | null} */ (await db.prepare("SELECT (data::json ->> 'workspace') AS w FROM systems WHERE id = ?").bind(systemId).first());
  return (ws?.w ?? "") === rule.scope_value;
}
/**
 * The items a rule's PQL condition picks within its scope (all of them with no condition).
 * @param {D1Database} db
 * @param {RuleRow} rule
 * @param {number} now
 * @param {string} [extra=""]
 * @param {unknown[]} [extraArgs=[]]
 * @param {number} [limit=500]
 * @returns {Promise<ItemRow[]>}
 */
async function matchingItems(db, rule, now, extra = "", extraArgs = [], limit = 500) {
  const f = await filterSql(db, rule.condition_pql, AUTOMATION_VIEWER, now);
  const scope = rule.scope === "project" ? { sql: " AND w.system_id = ?", args: [rule.scope_value] } : rule.scope === "workspace" ? { sql: " AND (s.data::json ->> 'workspace') = ?", args: [rule.scope_value] } : { sql: "", args: [] };
  const rows = /** @type {D1Result<ItemRow>} */ (
    await db
      .prepare(`${SELECT} WHERE ${f.where}${scope.sql}${extra} ORDER BY ${f.orderBy} LIMIT ?`)
      .bind(...f.params, ...scope.args, ...extraArgs, limit)
      .all()
  );
  return rows.results;
}
/**
 * @param {D1Database} db
 * @param {RuleRow} rule
 * @param {{ trigger: string; itemKey?: string; status: AutomationRun["status"]; message: string; touched: string[]; depth: number; detail?: unknown }} run
 */
async function logRun(db, rule, run) {
  const at = new Date().toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO automation_runs (rule_id, at, trigger_event, item_key, status, message, touched, depth, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(rule.id, at, run.trigger, run.itemKey ?? null, run.status, run.message.slice(0, 1000), run.touched.join(",").slice(0, 2000), run.depth, run.detail ? JSON.stringify(run.detail).slice(0, 8000) : null),
    ...(run.status !== "skipped" ? [db.prepare("UPDATE automation_rules SET last_run_at = ? WHERE id = ?").bind(at, rule.id)] : []),
  ]);
}

/**
 * Runs a rule's actions on the items given. `bulk`: a run over many items (one notification per person listing
 * theirs; create-item and webhook actions once). Returns how it went; never throws.
 * @param {Env} env
 * @param {Loaded} loaded
 * @param {ItemRow[]} rows
 * @param {RunInput} input
 * @returns {Promise<{ status: AutomationRun["status"]; retryable: boolean; message: string }>}
 */
async function execute(env, loaded, rows, input) {
  const db = env.DB;
  const { row: rule, rule: r } = loaded;
  /** @type {Alert[]} */ const alerts = [];
  /** @type {ItemEvent[]} */ const events = [];
  /** @type {ChannelPost[]} */ const posts = [];
  const c = ruleContext(env, rule, alerts, events, posts);
  const touched = /** @type {Set<string>} */ (new Set());
  /** @type {string[]} */ const notes = [];
  const info = await orgInfo(db);
  const names = new Map((/** @type {D1Result<{ id: string; name: string; }>} */ (await db.prepare("SELECT id, name FROM users").all())).results.map((u) => [u.id, u.name]));
  const x = /** @type {ActContext} */ ({ env, info, names, rule, actionRows: loaded.actionRows, by: input.by, payload: input.payload ?? {}, dry: false });
  /** @type {AutomationRun["status"]} */ let status = "success";
  // Whether anything was done before a failure: then trying again could do it twice, so it isn't retried.
  let didSomething = false;
  try {
    for (const action of r.actions) {
      if (action.kind === "notify") {
        const note = await notify(env, c, action, rows, x, input.bulk);
        if (note) ((didSomething = true), notes.push(note));
        continue;
      }
      const targets = input.bulk && ONCE_PER_RUN.includes(action.kind) ? [rows[0] ?? null] : rows;
      for (const original of targets) {
        const row = original ? ((await itemById(c, original.id)) ?? original) : null;
        const note = await act(c, action, row, x);
        if (note.changed) {
          didSomething = true;
          if (row) touched.add(keyOf(note.row ?? row));
        }
        if (note.message) notes.push(note.message);
      }
    }
  } catch (e) {
    status = "error";
    notes.push(e instanceof Error ? e.message : "Something went wrong");
  }
  if (alerts.length) await raise(env, alerts).catch(() => undefined);
  if (posts.length) {
    const delivery = await readDelivery(db);
    if (delivery.teams) for (const p of posts) await postToTeams(env, delivery, p).catch(() => undefined);
  }
  const message = notes.filter(Boolean).join("; ") || (rows.length ? `Ran on ${rows.length} item${rows.length === 1 ? "" : "s"}` : input.bulk ? "Nothing matched" : "Ran");
  await logRun(db, rule, {
    trigger: input.trigger,
    itemKey: !input.bulk && rows[0] ? keyOf(rows[0]) : undefined,
    status,
    message,
    touched: [...touched],
    depth: input.depth,
    detail: { ...(input.conditions ? { conditions: input.conditions } : {}), actions: notes.filter(Boolean).slice(0, 30), ...(input.attempt && input.attempt > 1 ? { attempt: input.attempt } : {}) },
  });
  // What the actions set off, one level deeper.
  for (const e of events) await runEvent(env, e, input.depth + 1);
  return { status, retryable: status === "error" && !didSomething, message };
}

/**
 * One action on one item (or, with no item, on its own: a scheduled or webhook rule creating an item or calling a
 * webhook). Returns whether it changed anything, and a note for the run log. With `x.dry`, changes nothing and
 * says what it would do.
 * @param {ItemContext} c
 * @param {AutomationAction} a
 * @param {ItemRow | null} row
 * @param {ActContext} x
 * @returns {Promise<{ changed: boolean; row?: ItemRow; message?: string }>}
 */
async function act(c, a, row, x) {
  const tpl = /** @param {string} t @param {"text" | "html" | "json"} [mode] */ (t, mode = "text") => renderTemplate(t, smartValues(x.env, x.info, row, x.names, x.by, x.payload), mode);
  const would = /** @param {string} m */ (m) => ({ changed: false, message: `Would ${m}` });
  const needItem = () => {
    if (!row) throw new Error(`"${ACTIONS[a.kind]}" needs a work item; this rule ran without one`);
    return row;
  };
  /** Applies a change to the item, as a person would. @param {Record<string, unknown>} patch @param {string} what */
  const change = async (patch, what) => {
    const it = needItem();
    if (x.dry) return would(`${what} on ${keyOf(it)}`);
    const res = await applyChange(c, it, patch);
    if (!res.changed.length) return { changed: false };
    await c.audit("work_item_updated", it.system_id, { name: it.project_name, key: keyOf(it), summary: it.summary, fields: res.changed, ...res.diff });
    await afterChange(c, res);
    return { changed: true, row: res.after };
  };
  switch (a.kind) {
    case "transition": {
      const it = needItem();
      const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, it.system_id, it.item_type));
      const statuses = new Map((await statusCatalogue(c.db)).map((s) => [s.id, s]));
      const want = String(a.value ?? "");
      const hit = /** @param {string} to */ (to) => {
        const s = statuses.get(to);
        if (!s) return false;
        if (want.startsWith("category:")) return s.category === want.slice(9).toUpperCase();
        return s.id === want.toUpperCase() || s.name.toLowerCase() === want.toLowerCase();
      };
      if (hit(it.status)) return { changed: false, message: `${keyOf(it)} was already ${it.status_name}` };
      const t = transitionsFrom(wf, it.status).find((y) => hit(y.to));
      if (!t) return { changed: false, message: `${keyOf(it)}: the ${wf.name} workflow has no move from ${it.status_name} to ${want.replace("category:", "")}` };
      const check = checkTransition(
        t,
        { status: it.status, assignee: it.assignee, reporter: it.reporter, description: it.description, dueDate: it.due_date, startDate: it.start_date, storyPoints: it.story_points, originalEstimate: it.original_estimate, component: it.component, labels: it.labels ? it.labels.split(",") : [] },
        c.me,
        { comment: "x" },
      );
      if (check.needs.assignee || check.needs.fields.length) return { changed: false, message: `${keyOf(it)}: "${t.name}" needs ${check.needs.assignee ? "an assignee" : check.needs.fields.join(", ")} first` };
      if (x.dry) return would(`move ${keyOf(it)} from ${it.status_name} to ${statuses.get(t.to)?.name ?? t.to}`);
      const needsComment = t.rules.some((y) => y.kind === "validator" && y.rule === "comment_required");
      const res = await transitionItem(c, it, { transitionId: t.id, ...(needsComment ? { comment: `Moved by the automation rule "${c.me.name.replace(/^Automation: /, "")}".` } : {}) });
      return { changed: true, row: res.after };
    }
    case "assign": {
      const it = needItem();
      const v = String(a.value ?? "");
      /** @type {string | null} */ let to = null;
      let how = "";
      if (v === "nobody") to = null;
      else if (v === "reporter") to = it.reporter;
      else if (v === "lead") to = (/** @type {{ l: string | null } | null} */ (await c.db.prepare("SELECT (data::json ->> 'lead') AS l FROM systems WHERE id = ?").bind(it.system_id).first()))?.l ?? null;
      else if (v.startsWith("role:")) to = await personWithRole(c, v.slice(5), it.system_id);
      else if (v.startsWith("round_robin:") || v.startsWith("least_loaded:")) {
        const pick = await pickFromTeam(c, x, v, !x.dry);
        to = pick.id;
        how = pick.how;
      } else to = v;
      if (v !== "nobody" && !to) return { changed: false, message: `${keyOf(it)}: nobody to assign (${v})` };
      return change({ assignee: to }, `assign it to ${to ? (x.names.get(to) ?? to) : "nobody"}${how ? ` (${how})` : ""}`);
    }
    case "set_field": {
      const it = needItem();
      const f = String(a.field ?? "");
      const v = String(a.value ?? "");
      const today = localTime(Date.now(), x.info.timeZone).day;
      const due = () => {
        // +2wd: two working days ahead, by the organisation's working days; +3d, +1w: calendar time.
        const wd = v.match(/^\+?(\d{1,3})wd$/i);
        if (wd) return addWorkingDays(today, Number(wd[1]), x.info.workDays);
        if (/^[+-]?\d+[dwmy]$/i.test(v)) return relativeDate(v.startsWith("+") || v.startsWith("-") ? v.toLowerCase() : `+${v.toLowerCase()}`, Date.now()).slice(0, 10);
        return v || null;
      };
      /** @type {Record<string, unknown>} */ const patch =
        f === "priority"
          ? { priority: v.toUpperCase() }
          : f === "component"
            ? { component: tpl(v) }
            : f === "storyPoints"
              ? { storyPoints: v === "" ? null : Number(v) }
              : f === "dueDate"
                ? { dueDate: due() }
                : f === "labels"
                  ? { labels: [...new Set([...(it.labels ? it.labels.split(",") : []), cleanLabel(tpl(v))])] }
                  : f === "onHold"
                    ? { onHold: /^(yes|true|1|on)$/i.test(v) }
                    : {};
      if (!Object.keys(patch).length) return { changed: false, message: `Unknown field ${f}` };
      return change(patch, `set ${SETTABLE_FIELDS[f]?.split(" (")[0].toLowerCase() ?? f} to ${JSON.stringify(Object.values(patch)[0])}`);
    }
    case "add_label": {
      const it = needItem();
      const label = cleanLabel(tpl(String(a.value ?? "")));
      if (!label) return { changed: false, message: "No label to add" };
      return change({ labels: [...new Set([...(it.labels ? it.labels.split(",") : []), label])] }, `add the label ${label}`);
    }
    case "clear_field": {
      const patch = CLEARABLE[String(a.field ?? "")];
      if (!patch) return { changed: false, message: `Unknown field ${a.field}` };
      return change(patch, `clear ${String(a.field)}`);
    }
    case "comment": {
      const it = needItem();
      const text = tpl(String(a.value ?? ""));
      if (x.dry) return would(`comment on ${keyOf(it)}: "${text.slice(0, 120)}"`);
      await addComment(c, it, text);
      return { changed: true };
    }
    case "create_subtask": {
      const it = needItem();
      if (!["STORY", "TASK", "BUG"].includes(it.type)) return { changed: false, message: `${keyOf(it)} is ${it.type.toLowerCase()}: sub-tasks go under stories, tasks and bugs` };
      const summary = tpl(String(a.value ?? "Follow-up"));
      if (x.dry) return would(`create the sub-task "${summary}" under ${keyOf(it)}`);
      const sub = await createItem(c, { systemId: it.system_id, type: "SUBTASK", parent: it.id, summary, assignee: it.assignee }, "internal");
      await c.audit("work_item_created", it.system_id, { name: it.project_name, key: keyOf(sub), summary: sub.summary, type: "SUBTASK", parent: keyOf(it) });
      return { changed: true, message: `Created ${keyOf(sub)}` };
    }
    case "create_item":
      return createElsewhere(c, a, row, x, tpl);
    case "link": {
      const it = needItem();
      const target = await itemByKey(c, String(a.value ?? "").toUpperCase()).catch(() => null);
      if (!target) return { changed: false, message: `${a.value} doesn't exist` };
      if (target.id === it.id) return { changed: false };
      if (x.dry) return would(`link ${keyOf(it)} to ${keyOf(target)}`);
      const done = await c.db
        .prepare("INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(newToken().slice(0, 16), it.id, target.id, String(a.field ?? "RELATES"), c.me.id, c.now)
        .run();
      if (done.meta.changes) await c.audit("link_added", it.system_id, { name: it.project_name, key: keyOf(it), summary: it.summary, link: `${keyOf(it)} ${String(a.field).toLowerCase()} ${keyOf(target)}` });
      return { changed: !!done.meta.changes };
    }
    case "email": {
      const cfg = config(a);
      const to = await emailRecipients(c, row, String(cfg.to ?? ""));
      const subject = tpl(String(cfg.subject ?? "{{item.key}} {{item.title}}")).slice(0, 200);
      if (!to.length) return { changed: false, message: "No one to email (no addresses)" };
      if (x.dry) return would(`email ${to.length} ${to.length === 1 ? "person" : "people"}: "${subject}"`);
      const delivery = await readDelivery(c.db);
      if (!delivery.resendKey) return { changed: false, message: "Email isn't set up, so nothing was sent" };
      const text = tpl(String(cfg.body ?? ""));
      const link = row ? smartValues(x.env, x.info, row, x.names, x.by)["item.url"] : "";
      // Every value put into the email is escaped, so an item's title can't add markup or links.
      const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14.5px;line-height:1.5;color:#1c2b45">${tpl(String(cfg.body ?? ""), "html").replace(/\n/g, "<br>")}${row ? `<p><a href="${renderTemplate("{{u}}", { u: link }, "html")}">Open ${renderTemplate("{{k}}", { k: keyOf(row) }, "html")} in Pulse</a></p>` : ""}</div>`;
      for (const addr of to) await sendEmail(x.env, delivery, addr, subject, html, `${text}${link ? `\n\n${link}` : ""}`);
      return { changed: true, message: `Emailed ${to.length} ${to.length === 1 ? "person" : "people"}` };
    }
    case "message": {
      const cfg = config(a);
      const channel = /** @type {"whatsapp" | "sms"} */ (MESSAGE_CHANNELS.includes(/** @type {any} */ (cfg.channel)) ? cfg.channel : "sms");
      const who = String(cfg.to ?? "assignee");
      /** @type {string | null} */ let phone = null;
      if (who.startsWith("phone:")) phone = who.slice(6);
      else {
        const id = who === "reporter" ? row?.reporter : row?.assignee;
        phone = id ? ((/** @type {{ phone: string | null } | null} */ (await c.db.prepare("SELECT phone FROM users WHERE id = ?").bind(id).first()))?.phone ?? null) : null;
      }
      const text = tpl(String(cfg.text ?? "{{item.key}} {{item.title}}"));
      if (x.dry) return would(`send a ${channel === "whatsapp" ? "WhatsApp" : "SMS"} to ${phone ?? "nobody (no phone number)"}: "${text.slice(0, 80)}"`);
      const r = await sendMessage(x.env, channel, phone ?? "", text);
      return { changed: r.sent, message: r.note };
    }
    case "webhook":
      return callWebhook(c, a, x, tpl);
    case "escalate": {
      const it = needItem();
      const managers = /** @type {{ id: string; name: string }[]} */ ((await c.db.prepare("SELECT id, name FROM users WHERE role = 'manager' ORDER BY name").all()).results);
      const to = managers.length ? managers : /** @type {{ id: string; name: string }[]} */ ((await c.db.prepare("SELECT id, name FROM users WHERE role = 'admin' ORDER BY name").all()).results);
      if (!to.length) return { changed: false, message: "No managers or administrators to escalate to" };
      const message = tpl(String(config(a).message ?? "{{item.key}} needs attention: {{item.title}}"));
      if (x.dry) return would(`escalate ${keyOf(it)} to ${to.map((p) => p.name).join(", ")}`);
      c.alert(to.map((p) => ({ userId: p.id, kind: /** @type {const} */ ("automation"), title: `Escalated: ${message}`.slice(0, 200), body: `${keyOf(it)} ${it.summary}`.slice(0, 500), link: `#/projects/${it.system_id}/items/${keyOf(it)}` })));
      await addComment(c, it, `Escalated to ${to.map((p) => p.name).join(", ")}: ${message}`);
      return { changed: true, message: `Escalated to ${to.length} ${to.length === 1 ? "person" : "people"}` };
    }
    default:
      return { changed: false };
  }
}
/** An action's settings, kept as JSON in its value. @param {AutomationAction} a @returns {Record<string, unknown>} */
function config(a) {
  try {
    return a.value ? JSON.parse(a.value) : {};
  } catch {
    return {};
  }
}

/**
 * Round-robin or least loaded: among the people with a role in the workspace (or named people), whose turn it is,
 * or who has the fewest open items.
 * @param {ItemContext} c
 * @param {ActContext} x
 * @param {string} v  round_robin:role:<role> | round_robin:people:<id,id> | least_loaded:…
 * @param {boolean} advance  move the round-robin on (not in a dry run)
 * @returns {Promise<{ id: string | null; how: string }>}
 */
async function pickFromTeam(c, x, v, advance) {
  const [how, kind, list] = v.split(":");
  const people =
    kind === "role"
      ? /** @type {{ id: string; role: Role }[]} */ ((await c.db.prepare("SELECT id, role FROM users WHERE role = ? AND deactivated_at IS NULL ORDER BY id").bind(list).all()).results)
      : /** @type {{ id: string; role: Role }[]} */ (
          (
            await c.db
              .prepare(`SELECT id, role FROM users WHERE id IN (${(list ?? "").split(",").map(() => "?").join(", ")}) AND deactivated_at IS NULL ORDER BY id`)
              .bind(...(list ?? "").split(","))
              .all()
          ).results
        );
  const team = people.filter((p) => assignable(p.role)).map((p) => p.id);
  if (!team.length) return { id: null, how: "" };
  if (how === "round_robin") {
    const turn = Number(x.rule.rr_cursor ?? 0) % team.length;
    if (advance) {
      await c.db.prepare("UPDATE automation_rules SET rr_cursor = rr_cursor + 1 WHERE id = ?").bind(x.rule.id).run();
      x.rule.rr_cursor = Number(x.rule.rr_cursor ?? 0) + 1;
    }
    return { id: team[turn], how: "round-robin" };
  }
  const load = /** @type {{ assignee: string; n: number }[]} */ (
    (
      await c.db
        .prepare(`SELECT w.assignee, COUNT(*) AS n FROM work_items w JOIN work_statuses st ON st.id = w.status WHERE st.category <> 'DONE' AND w.assignee IN (${team.map(() => "?").join(", ")}) GROUP BY w.assignee`)
        .bind(...team)
        .all()
    ).results
  );
  const open = new Map(load.map((l) => [l.assignee, Number(l.n)]));
  const best = [...team].sort((p, q) => (open.get(p) ?? 0) - (open.get(q) ?? 0))[0];
  return { id: best, how: `least loaded: ${open.get(best) ?? 0} open` };
}

/**
 * Email addresses: the item's assignee, reporter or watchers, everyone with a role, or addresses given.
 * @param {ItemContext} c
 * @param {ItemRow | null} row
 * @param {string} to  assignee | reporter | watchers | role:<role> | emails:<a,b>
 * @returns {Promise<string[]>}
 */
async function emailRecipients(c, row, to) {
  if (to.startsWith("emails:")) {
    return to
      .slice(7)
      .split(",")
      .map((e) => e.trim())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .slice(0, 20);
  }
  /** @type {string[]} */ let ids = [];
  if (to === "assignee" && row?.assignee) ids = [row.assignee];
  else if (to === "reporter" && row) ids = [row.reporter];
  else if (to === "watchers" && row) ids = /** @type {{ user_id: string }[]} */ ((await c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(row.id).all()).results).map((r) => r.user_id);
  else if (to.startsWith("role:")) ids = /** @type {{ id: string }[]} */ ((await c.db.prepare("SELECT id FROM users WHERE role = ?").bind(to.slice(5)).all()).results).map((r) => r.id);
  if (!ids.length) return [];
  const rows = /** @type {{ email: string | null }[]} */ (
    (
      await c.db
        .prepare(`SELECT email FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) AND deactivated_at IS NULL`)
        .bind(...ids)
        .all()
    ).results
  );
  return [...new Set(rows.map((r) => r.email).filter(/** @returns {e is string} */ (e) => !!e))];
}

/**
 * Creates a work item, in this workspace or another of the organisation's (with that workspace's own handle). In
 * another workspace the rule's owner must be a member allowed to create work items there; the two items get a
 * comment naming each other.
 * @param {ItemContext} c
 * @param {AutomationAction} a
 * @param {ItemRow | null} row
 * @param {ActContext} x
 * @param {(t: string) => string} tpl
 * @returns {Promise<{ changed: boolean; message?: string }>}
 */
async function createElsewhere(c, a, row, x, tpl) {
  const cfg = config(a);
  const summary = tpl(String(cfg.summary ?? "Follow-up for {{item.key}}")).slice(0, 255);
  const target = String(cfg.workspaceId ?? "") || x.info.workspaceId;
  const elsewhere = target !== x.info.workspaceId;
  /** @type {ItemContext} */ let tc = c;
  if (elsewhere) {
    await checkOwnerCanCreate(x.env, x.info.orgId, target, x.rule.owner_id ?? x.rule.created_by);
    tc = ruleContext({ ...x.env, DB: x.env.ROOT.withScope({ orgId: x.info.orgId, workspaceId: target }) }, x.rule, [], []);
  }
  const systemId = String(cfg.systemId ?? "") || (!elsewhere && row ? row.system_id : "");
  if (!systemId) throw new Error("Choose the project the new item goes in");
  const where = /** @type {{ name: string } | null} */ (await tc.db.prepare("SELECT (data::json ->> 'name') AS name FROM systems WHERE id = ?").bind(systemId).first());
  if (!where) throw new Error("The project for new items no longer exists there");
  if (x.dry) return { changed: false, message: `Would create "${summary}" in ${where.name}${elsewhere ? " (another workspace)" : ""}` };
  const made = await createItem(tc, { systemId, ...(cfg.itemType ? { itemType: String(cfg.itemType) } : { type: "TASK" }), summary, description: tpl(String(cfg.description ?? "")) }, "internal");
  await tc.audit("work_item_created", systemId, { name: where.name, key: keyOf(made), summary: made.summary, ...(row ? { from: keyOf(row) } : {}) });
  if (row && elsewhere) {
    await addComment(tc, made, `Created by automation from ${keyOf(row)} (${x.info.workspaceName}).`);
    await addComment(c, row, `Automation created ${keyOf(made)} in another workspace.`);
  }
  return { changed: true, message: `Created ${keyOf(made)}${elsewhere ? " in another workspace" : ""}` };
}
/**
 * A rule may create items in another workspace only if its owner could: a member there whose role may create work
 * items. Checked when the rule is saved and again when it runs.
 * @param {Env} env
 * @param {string} orgId
 * @param {string} workspaceId
 * @param {string} ownerId
 */
async function checkOwnerCanCreate(env, orgId, workspaceId, ownerId) {
  const wdb = env.ROOT.withScope({ orgId, workspaceId });
  const m = /** @type {{ role: Role } | null} */ (await wdb.prepare("SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id AND w.status = 'active' WHERE m.workspace_id = ? AND m.user_id = ?").bind(workspaceId, ownerId).first());
  if (!m) throw new HttpError(403, "The rule's owner isn't in the workspace the item would be created in");
  if (!permissionsFor(m.role, await roleMatrix(wdb)).includes("create_work_items")) throw new HttpError(403, "The rule's owner can't create work items in that workspace");
}

/**
 * Calls a webhook: the payload template with smart values (escaped for JSON), signed with the action's secret
 * (X-Pulse-Signature: sha256=<hex HMAC of the body>). A failure (no answer, or not 2xx) throws, so the job is tried
 * again.
 * @param {ItemContext} c
 * @param {AutomationAction} a
 * @param {ActContext} x
 * @param {(t: string, mode?: "text" | "html" | "json") => string} tpl
 * @returns {Promise<{ changed: boolean; message?: string }>}
 */
async function callWebhook(c, a, x, tpl) {
  const cfg = config(a);
  const url = String(cfg.url ?? "");
  const payload = tpl(String(cfg.payload ?? '{"key": "{{item.key}}", "title": "{{item.title}}", "status": "{{item.status}}"}'), "json");
  try {
    JSON.parse(payload);
  } catch {
    throw new Error("The webhook payload isn't valid JSON once filled in");
  }
  if (x.dry) return { changed: false, message: `Would POST to ${url}: ${payload.slice(0, 200)}` };
  const sealed = x.actionRows.find((r) => r.id === a.id)?.secret_sealed;
  if (!sealed || !x.env.MFA_KEY) throw new Error("The webhook has no signing secret; save the rule again");
  const secret = await openSecret(sealed, x.env.MFA_KEY);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Pulse-Automation", "x-pulse-signature": `sha256=${sig}`, "x-pulse-rule": x.rule.id },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`The webhook answered ${res.status}`);
  void c;
  return { changed: true, message: `Webhook answered ${res.status}` };
}

/**
 * Notifies the chosen people about the items: the bell (and email, per each person's settings, once email is
 * connected), and/or the Teams channel. In bulk, one message per person lists their items. People hear only about
 * items they may see.
 * @param {Env} env
 * @param {ItemContext} c
 * @param {AutomationAction} a
 * @param {ItemRow[]} rows
 * @param {ActContext} x
 * @param {boolean} bulk
 * @returns {Promise<string>}
 */
async function notify(env, c, a, rows, x, bulk) {
  if (!rows.length) return "";
  const db = env.DB;
  const who = String(a.field ?? "watchers");
  const channels = String(a.value2 ?? "bell")
    .split(",")
    .map((y) => y.trim());
  const message = String(a.value ?? "{{item.key}} {{item.title}}");
  const fill = /** @param {ItemRow} r */ (r) => renderTemplate(message, smartValues(env, x.info, r, x.names, x.by, x.payload));
  const link = /** @param {ItemRow} r */ (r) => `#/projects/${r.system_id}/items/${keyOf(r)}`;
  // The Teams channel is seen by the whole team, so items with a security level never go there.
  const open = rows.filter((r) => !r.security_level);
  if (who === "teams" || channels.includes("teams")) {
    const delivery = await readDelivery(db);
    if (x.dry) return `Would post ${open.length} item${open.length === 1 ? "" : "s"} to Teams`;
    if (!open.length) {
      if (who === "teams") return "Nothing posted to Teams: the items have a security level";
    } else if (delivery.teams) {
      const first = open[0];
      await postToTeams(env, delivery, {
        title: bulk && open.length > 1 ? `${message} (${open.length} items)` : fill(first),
        body: open
          .slice(0, 15)
          .map((r) => `${keyOf(r)} ${r.summary}`)
          .join("\n"),
        link: link(first),
      }).catch(() => undefined);
    } else if (who === "teams") return "Teams isn't connected yet, so nothing was posted";
    if (who === "teams") return "Posted to Teams";
  }
  if (!channels.includes("bell") && !channels.includes("email")) return "";
  const roles = new Map((/** @type {D1Result<{ id: string; role: Role; }>} */ (await db.prepare("SELECT id, role FROM users").all())).results.map((u) => [u.id, u.role]));
  const viewers = await viewersOf(db, [...roles.keys()]);
  const recipients = /** @param {ItemRow} r @returns {Promise<string[]>} */ async (r) => {
    if (who === "assignee") return r.assignee ? [r.assignee] : [];
    if (who === "reporter") return [r.reporter];
    if (who.startsWith("person:")) return [who.slice(7)];
    if (who.startsWith("role:")) return [...roles].filter(([, role]) => role === who.slice(5)).map(([id]) => id);
    return (/** @type {D1Result<{ user_id: string; }>} */ (await db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(r.id).all())).results.map((y) => y.user_id);
  };
  const byPerson = /** @type {Map<string, ItemRow[]>} */ (new Map());
  for (const r of rows) {
    for (const id of await recipients(r)) {
      const v = viewers.get(id);
      // Only about items they may see: their own-items rule and the item's security level.
      if (!v || !(await canSeeItem(db, v, r))) continue;
      byPerson.set(id, [...(byPerson.get(id) ?? []), r]);
    }
  }
  if (x.dry) return `Would notify ${[...byPerson.keys()].map((id) => x.names.get(id) ?? id).join(", ") || "nobody"}`;
  /** @type {Alert[]} */ const alerts = [...byPerson].map(([userId, items]) =>
    bulk && items.length > 1
      ? {
          userId,
          kind: /** @type {const} */ ("automation"),
          title: `${renderTemplate(message, smartValues(env, x.info, null, x.names, x.by))}: ${items.length} work items`.slice(0, 200),
          body: items
            .slice(0, 5)
            .map((r) => `${keyOf(r)} ${r.summary}`)
            .join("; ")
            .slice(0, 500),
          link: link(items[0]),
          digest: {
            title: message,
            period: c.now.slice(0, 13),
            writtenAt: c.now,
            summary: `${items.length} work items, from the automation rule "${c.me.name.replace(/^Automation: /, "")}".`,
            aiWritten: false,
            sections: [{ title: message, items: items.slice(0, 50).map((r) => ({ text: `${keyOf(r)} ${r.summary}${r.due_date ? ` · due ${r.due_date}` : ""} · ${r.status_name}`, link: link(r) })) }],
          },
        }
      : { userId, kind: /** @type {const} */ ("automation"), title: fill(items[0]).slice(0, 200), body: `${keyOf(items[0])} ${items[0].summary}`.slice(0, 500), link: link(items[0]) },
  );
  if (alerts.length) await raise(env, alerts).catch(() => undefined);
  return `Notified ${alerts.length} ${alerts.length === 1 ? "person" : "people"}`;
}

/**
 * Why a rule mustn't run now, or null: its runs-a-minute limit, its runs on this item in the last hour (loop
 * protection), or the organisation's runs in the last minute.
 * @param {Env} env
 * @param {RuleRow} rule
 * @param {string | undefined} itemKey
 * @returns {Promise<string | null>}
 */
async function overLimit(env, rule, itemKey) {
  const db = env.DB;
  const minute = new Date(Date.now() - 60_000).toISOString();
  const n = /** @type {{ n: number } | null} */ (await db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_id = ? AND status <> 'skipped' AND at > ?").bind(rule.id, minute).first());
  if (Number(n?.n ?? 0) >= Number(rule.max_per_minute)) return `Over its limit of ${rule.max_per_minute} runs a minute`;
  if (itemKey) {
    const h = /** @type {{ n: number } | null} */ (
      await db
        .prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_id = ? AND item_key = ? AND status <> 'skipped' AND at > ?")
        .bind(rule.id, itemKey, new Date(Date.now() - 3_600_000).toISOString())
        .first()
    );
    if (Number(h?.n ?? 0) >= MAX_PER_ITEM_HOUR) return `Not run: it already ran ${MAX_PER_ITEM_HOUR} times on ${itemKey} this hour (a loop?)`;
  }
  const orgId = /** @type {Scope} */ (/** @type {TenantDatabase} */ (/** @type {unknown} */ (db)).scope).orgId;
  const o = /** @type {{ n: number } | null} */ (await env.ROOT.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE organization_id = ? AND status <> 'skipped' AND at > ?").bind(orgId, minute).first());
  if (Number(o?.n ?? 0) >= ORG_RUNS_PER_MINUTE) return `Not run: your organisation's rules ran ${ORG_RUNS_PER_MINUTE} times in the last minute`;
  return null;
}

/**
 * Handles one event: every switched-on rule for it, in scope, whose conditions the item meets.
 * @param {Env} env
 * @param {ItemEvent} e
 * @param {number} [depth=0]
 * @returns {Promise<void>}
 */
export async function runEvent(env, e, depth = 0) {
  // Outbound webhooks hear about every event, whoever (or whatever rule) caused it.
  const hooks = dispatchWebhooks(env, e).catch((err) => console.error("webhook dispatch failed", err));
  try {
    await runRules(env, e, depth);
  } finally {
    await hooks;
  }
}
/**
 * @param {Env} env
 * @param {ItemEvent} e
 * @param {number} depth
 */
async function runRules(env, e, depth) {
  const db = env.DB;
  // A change of assignee is also "a work item is assigned".
  const types = [e.type, ...(e.type === "field_changed" && e.fields.includes("assignee") ? ["item_assigned"] : [])];
  const rules = await loadRules(db, `enabled = 1 AND trigger IN (${types.map(() => "?").join(", ")})`, types);
  if (!rules.length) return;
  if (depth >= MAX_AUTOMATION_DEPTH) {
    for (const l of rules) await logRun(db, l.row, { trigger: e.type, status: "skipped", message: `Not run: set off by other rules ${depth} levels deep (the limit is ${MAX_AUTOMATION_DEPTH})`, touched: [], depth });
    return;
  }
  const nonce = newToken().slice(0, 12);
  for (const l of rules) {
    const rule = l.row;
    try {
      if (e.type === "sprint_started" || e.type === "sprint_completed") {
        if (!(await inScope(db, rule, e.systemId))) continue;
        const limited = await overLimit(env, rule, undefined);
        if (limited) {
          await logRun(db, rule, { trigger: e.type, status: "skipped", message: limited, touched: [], depth });
          continue;
        }
        const rows = await matchingItems(db, rule, Date.now(), " AND (w.sprint_id = ? OR EXISTS (SELECT 1 FROM sprint_items si WHERE si.item_id = w.id AND si.sprint_id = ?))", [e.sprintId, e.sprintId]);
        await runJob(env, l, rows, { trigger: e.type, depth, bulk: true, by: e.by }, `${e.type}:${e.sprintId}:${nonce}`, null);
        continue;
      }
      const row = /** @type {ItemRow | null} */ (await db.prepare(`${SELECT} WHERE w.id = ?`).bind(/** @type {{ itemId: string }} */ (e).itemId).first());
      if (!row) continue;
      if (rule.trigger === "item_assigned" && !row.assignee) continue;
      if (e.type === "item_transitioned" && rule.trigger === "item_transitioned" && rule.trigger_value) {
        const to = /** @type {{ name: string } | null} */ (await db.prepare("SELECT name FROM work_statuses WHERE id = ?").bind(e.to).first());
        if (rule.trigger_value.toUpperCase() !== e.to && rule.trigger_value.toLowerCase() !== (to?.name ?? "").toLowerCase()) continue;
      }
      if (e.type === "field_changed" && rule.trigger === "field_changed" && rule.trigger_value && !e.fields.includes(rule.trigger_value)) continue;
      await consider(env, l, row, { trigger: rule.trigger === "item_assigned" ? "item_assigned" : e.type, depth, bulk: false, by: e.by }, `${rule.trigger}:${row.id}:${nonce}`);
    } catch (err) {
      await logRun(db, rule, { trigger: e.type, status: "error", message: err instanceof Error ? err.message : "Something went wrong", touched: [], depth }).catch(() => undefined);
    }
  }
}
/**
 * A rule and one item: in scope, the PQL condition and the condition groups hold, within the limits? Then run it.
 * Returns why not, or null when it ran.
 * @param {Env} env
 * @param {Loaded} l
 * @param {ItemRow} row
 * @param {RunInput} input
 * @param {string} idem
 * @returns {Promise<string | null>}
 */
async function consider(env, l, row, input, idem) {
  const db = env.DB;
  const rule = l.row;
  if (!(await inScope(db, rule, row.system_id))) return "out of scope";
  if (rule.condition_pql.trim()) {
    const f = await filterSql(db, rule.condition_pql, AUTOMATION_VIEWER, Date.now());
    const hit = await db
      .prepare(`SELECT 1 FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE (${f.where}) AND w.id = ?`)
      .bind(...f.params, row.id)
      .first();
    if (!hit) return "the PQL condition doesn't match";
  }
  const info = await orgInfo(db);
  const evaluated = evaluateConditions(l.rule.conditions, await evalItemOf(db, row), { now: Date.now(), today: localTime(Date.now(), info.timeZone).day });
  if (!evaluated.result) return "the conditions don't hold";
  const limited = await overLimit(env, rule, keyOf(row));
  if (limited) {
    await logRun(db, rule, { trigger: input.trigger, itemKey: keyOf(row), status: "skipped", message: limited, touched: [], depth: input.depth });
    return limited;
  }
  await runJob(env, l, [row], { ...input, conditions: evaluated.details }, idem, row.id);
  return null;
}

/**
 * Runs a piece of work as a job: recorded once (by its idempotency key), tried now, and if it fails before changing
 * anything, again later (worker/index.js scheduled → retryAutomationJobs).
 * @param {Env} env
 * @param {Loaded} l
 * @param {ItemRow[]} rows
 * @param {RunInput} input
 * @param {string} idem
 * @param {string | null} itemId
 */
async function runJob(env, l, rows, input, idem, itemId) {
  const db = env.DB;
  const now = new Date().toISOString();
  const job = /** @type {{ id: number } | null} */ (
    await db
      .prepare("INSERT INTO automation_jobs (rule_id, item_id, trigger_event, depth, idem_key, status, attempts, run_after, created_at) VALUES (?, ?, ?, ?, ?, 'running', 1, ?, ?) ON CONFLICT (workspace_id, idem_key) DO NOTHING RETURNING id")
      .bind(l.row.id, itemId, input.trigger, input.depth, idem.slice(0, 200), now, now)
      .first()
  );
  if (!job) return; // already done (or under way)
  const r = await execute(env, l, rows, { ...input, attempt: 1 });
  await finishJob(env, l, Number(job.id), r, 1);
}
/**
 * @param {Env} env
 * @param {Loaded} l
 * @param {number} jobId
 * @param {{ status: AutomationRun["status"]; retryable: boolean; message: string }} r
 * @param {number} attempts
 */
async function finishJob(env, l, jobId, r, attempts) {
  const db = env.DB;
  if (r.status !== "error") {
    await db.prepare("UPDATE automation_jobs SET status = 'done' WHERE id = ?").bind(jobId).run();
    return;
  }
  if (r.retryable && attempts < MAX_ATTEMPTS) {
    // 1, 2, 4, 8 minutes.
    const after = new Date(Date.now() + 2 ** (attempts - 1) * 60_000).toISOString();
    await db.prepare("UPDATE automation_jobs SET status = 'waiting', run_after = ?, last_error = ? WHERE id = ?").bind(after, r.message.slice(0, 500), jobId).run();
    return;
  }
  await db.prepare("UPDATE automation_jobs SET status = 'failed', last_error = ? WHERE id = ?").bind(r.message.slice(0, 500), jobId).run();
  // Its owner hears about it, once a day at most.
  const day = new Date().toISOString().slice(0, 10);
  if ((l.row.failure_alerted_at ?? "").slice(0, 10) === day) return;
  await db.prepare("UPDATE automation_rules SET failure_alerted_at = ? WHERE id = ?").bind(new Date().toISOString(), l.row.id).run();
  await raise(env, [
    {
      userId: l.row.owner_id ?? l.row.created_by,
      kind: "automation",
      title: `The automation rule "${l.row.name}" failed`.slice(0, 200),
      body: r.message.slice(0, 500),
      link: "settings:automation",
      dedupe: `autofail:${l.row.id}:${day}`,
    },
  ]).catch(() => undefined);
}
/**
 * Jobs waiting to be tried again whose time has come (the cron, per workspace).
 * @param {Env} env
 * @returns {Promise<number>}
 */
export async function retryAutomationJobs(env) {
  const db = env.DB;
  const due = /** @type {{ id: number; rule_id: string; item_id: string | null; trigger_event: string; depth: number; attempts: number }[]} */ (
    (await db.prepare("SELECT id, rule_id, item_id, trigger_event, depth, attempts FROM automation_jobs WHERE status = 'waiting' AND run_after <= ? ORDER BY id LIMIT 50").bind(new Date().toISOString()).all()).results
  );
  for (const j of due) {
    const claimed = await db.prepare("UPDATE automation_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'waiting'").bind(j.id).run();
    if (!claimed.meta.changes) continue;
    const [l] = await loadRules(db, "id = ? AND enabled = 1", [j.rule_id]);
    if (!l) {
      await db.prepare("UPDATE automation_jobs SET status = 'failed', last_error = 'The rule was switched off or deleted' WHERE id = ?").bind(j.id).run();
      continue;
    }
    const row = j.item_id ? /** @type {ItemRow | null} */ (await db.prepare(`${SELECT} WHERE w.id = ?`).bind(j.item_id).first()) : null;
    const rows = row ? [row] : BULK_TRIGGERS.includes(/** @type {Trigger} */ (j.trigger_event)) ? await matchingItems(db, l.row, Date.now()) : [];
    const r = await execute(env, l, rows, { trigger: j.trigger_event, depth: j.depth, bulk: !row, attempt: j.attempts + 1 });
    await finishJob(env, l, j.id, r, j.attempts + 1);
  }
  return due.length;
}

/**
 * Time-based triggers (the cron, every few minutes, per workspace): schedules due today in the organisation's time
 * zone, items whose due date is near, and items whose due date has passed. Each fires once per occasion.
 * @param {Env} env
 * @param {number} [now=Date.now()]
 * @returns {Promise<number>}  how many rules ran
 */
export async function runTimeTriggers(env, now = Date.now()) {
  const db = env.DB;
  const rules = await loadRules(db, "enabled = 1 AND trigger IN ('schedule', 'due_soon', 'due_passed')");
  if (!rules.length) return 0;
  const info = await orgInfo(db);
  const today = localTime(now, info.timeZone).day;
  /** Records an occasion; false if it was already recorded. @param {string} ruleId @param {string} itemId @param {string} occasion */
  const once = async (ruleId, itemId, occasion) =>
    !!(await db.prepare("INSERT INTO automation_fired (rule_id, item_id, occasion, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING rule_id").bind(ruleId, itemId, occasion, new Date(now).toISOString()).first());
  let ran = 0;
  for (const l of rules) {
    try {
      if (l.row.trigger === "schedule") {
        const occasion = scheduleOccasion(l.rule.triggerConfig ?? {}, now, info.timeZone);
        if (!occasion || !(await once(l.row.id, "", `schedule:${occasion}`))) continue;
        const rows = await matchingItems(db, l.row, now);
        await runJob(env, l, rows, { trigger: "schedule", depth: 0, bulk: true }, `schedule:${occasion}`, null);
        ran += 1;
        continue;
      }
      // Due soon: the due date falls within the next N hours (by the organisation's calendar); passed: before today.
      const hours = Math.max(1, Math.min(24 * 30, Number(l.rule.triggerConfig?.hours ?? 24)));
      const horizon = localTime(now + hours * 3_600_000, info.timeZone).day;
      const where = l.row.trigger === "due_soon" ? " AND w.due_date IS NOT NULL AND w.due_date >= ? AND w.due_date <= ?" : " AND w.due_date IS NOT NULL AND w.due_date < ?";
      const args = l.row.trigger === "due_soon" ? [today, horizon] : [today];
      const rows = await matchingItems(db, l.row, now, where, args, 200);
      for (const row of rows) {
        // A changed due date is a new occasion.
        if (!(await once(l.row.id, row.id, `${l.row.trigger}:${row.due_date}`))) continue;
        await consider(env, l, row, { trigger: l.row.trigger, depth: 0, bulk: false }, `${l.row.trigger}:${row.id}:${row.due_date}`);
        ran += 1;
      }
    } catch (e) {
      await logRun(db, l.row, { trigger: l.row.trigger, status: "error", message: e instanceof Error ? e.message : "Something went wrong", touched: [], depth: 0 }).catch(() => undefined);
    }
  }
  return ran;
}
/** Kept for older callers: scheduled rules are part of the time-based triggers now. @param {Env} env @param {number} [now] */
export const runScheduledRules = (env, now) => runTimeTriggers(env, now);

/**
 * Another system calling a rule's webhook (/api/hooks/automation/<secret>). The secret finds the rule (stored as a
 * hash); the rule runs in its own workspace. With { "itemKey": "DEV-12" } it runs on that item (its conditions
 * apply); otherwise on everything its conditions pick. The body's top-level values are smart values
 * ({{webhook.<name>}}). Every refusal is the same 404.
 * @param {Env} env  the root environment
 * @param {Request} req
 * @param {string} token
 * @returns {Promise<Response>}
 */
export async function automationWebhook(env, req, token) {
  const gone = () => json({ error: "Not found" }, 404);
  if (!/^[a-f0-9]{64}$/.test(token)) return gone();
  const found = /** @type {{ id: string; organization_id: string; workspace_id: string } | null} */ (
    await env.ROOT.prepare(
      `SELECT r.id, r.organization_id, r.workspace_id FROM automation_rules r
       JOIN workspaces w ON w.id = r.workspace_id AND w.status = 'active' JOIN organizations o ON o.id = r.organization_id AND o.status = 'active'
       WHERE r.webhook_token_hash = ? AND r.enabled = 1 AND r.trigger = 'webhook'`,
    )
      .bind(await tokenHash(token))
      .first()
  );
  if (!found) return gone();
  const text = await req.text();
  if (text.length > 65_536) return json({ error: "The body is too large (64 KB at most)" }, 413);
  /** @type {Record<string, unknown>} */ let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Send JSON" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  const tenv = { ...env, DB: env.ROOT.withScope({ orgId: found.organization_id, workspaceId: found.workspace_id }) };
  const [l] = await loadRules(tenv.DB, "id = ?", [found.id]);
  if (!l) return gone();
  const nonce = newToken().slice(0, 12);
  const itemKey = typeof payload.itemKey === "string" ? payload.itemKey.toUpperCase().slice(0, 30) : "";
  if (itemKey) {
    const row = /** @type {ItemRow | null} */ (await tenv.DB.prepare(`${SELECT} WHERE (s.key || '-' || w.number) = ?`).bind(itemKey).first());
    if (!row) return json({ error: "No such work item" }, 404);
    const why = await consider(tenv, l, row, { trigger: "webhook", depth: 0, bulk: false, payload }, `webhook:${row.id}:${nonce}`);
    return json({ accepted: true, ran: !why, ...(why ? { reason: why } : {}) }, 202);
  }
  const limited = await overLimit(tenv, l.row, undefined);
  if (limited) return json({ accepted: false, reason: limited }, 429);
  const rows = await matchingItems(tenv.DB, l.row, Date.now());
  await runJob(tenv, l, rows, { trigger: "webhook", depth: 0, bulk: true, payload }, `webhook:${nonce}`, null);
  return json({ accepted: true, ran: true }, 202);
}

// ---------- Settings → This workspace → Automations ----------

/**
 * Checks a rule as sent and returns what to save, or throws an HttpError naming the problem.
 * @param {ItemContext} c
 * @param {Partial<AutomationRule> & { conditions?: unknown; triggerConfig?: unknown }} b
 */
async function checkRule(c, b) {
  const name = String(b.name ?? "")
    .trim()
    .slice(0, 80);
  if (!name) throw new HttpError(400, "A rule needs a name");
  const trigger = /** @type {Trigger} */ (b.trigger);
  if (!(trigger in TRIGGERS)) throw new HttpError(400, "Choose what sets the rule off");
  const scope = b.scope ?? "global";
  if (!["global", "workspace", "project"].includes(scope)) throw new HttpError(400, "Unknown scope");
  /** @type {string | null} */ let scopeValue = null;
  if (scope === "project") {
    if (
      !(await c.db
        .prepare("SELECT 1 FROM systems WHERE id = ?")
        .bind(String(b.scopeValue ?? ""))
        .first())
    )
      throw new HttpError(400, "Choose the project");
    scopeValue = String(b.scopeValue);
  }
  if (scope === "workspace") {
    const ws = /** @type {{ name: string }} */ (await c.db.prepare("SELECT name FROM workspaces WHERE id = ?").bind(/** @type {Scope} */ (c.scope).workspaceId).first());
    if (String(b.scopeValue ?? ws.name) !== ws.name) throw new HttpError(400, "Choose the workspace");
    scopeValue = ws.name;
  }
  // The trigger's settings.
  /** @type {TriggerConfig | null} */ let triggerConfig = null;
  const raw = /** @type {Record<string, unknown>} */ (b.triggerConfig && typeof b.triggerConfig === "object" ? b.triggerConfig : {});
  if (trigger === "schedule") {
    const every = String(raw.every ?? (b.scheduleWeekday != null ? "week" : "day"));
    if (!["day", "weekday", "week", "month"].includes(every)) throw new HttpError(400, "A schedule runs every day, working day, week or month");
    const time = String(raw.time ?? (b.scheduleHour != null ? `${String(b.scheduleHour).padStart(2, "0")}:00` : "08:00"));
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, "Choose the time it runs, such as 08:00");
    triggerConfig = { every: /** @type {TriggerConfig["every"]} */ (every), time };
    if (every === "week") {
      const weekday = Number(raw.weekday ?? b.scheduleWeekday ?? 1);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new HttpError(400, "Choose a day of the week");
      triggerConfig.weekday = weekday;
    }
    if (every === "month") {
      const day = Number(raw.day ?? 1);
      if (!Number.isInteger(day) || day < 1 || day > 28) throw new HttpError(400, "Choose a day of the month, 1 to 28");
      triggerConfig.day = day;
    }
  }
  if (trigger === "due_soon") {
    const hours = Number(raw.hours ?? 24);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new HttpError(400, "How long before the due date: 1 to 720 hours");
    triggerConfig = { hours };
  }
  const pql = String(b.conditionPql ?? "")
    .trim()
    .slice(0, 2000);
  try {
    if (pql) await filterSql(c.db, pql, AUTOMATION_VIEWER, Date.now());
  } catch (e) {
    throw new HttpError(400, `Condition: ${e instanceof Error ? e.message : "it doesn't parse"}`, "pql");
  }
  /** @type {ConditionGroup | null} */ let conditions;
  try {
    conditions = cleanConditions(b.conditions);
  } catch (e) {
    throw new HttpError(400, `Conditions: ${e instanceof Error ? e.message : "not valid"}`, "conditions");
  }
  const max = Math.round(Number(b.maxPerMinute ?? 10));
  if (!(max >= 1 && max <= 100)) throw new HttpError(400, "Runs a minute: 1 to 100");
  const ownerId = String(b.ownerId ?? c.me.id);
  if (!(await c.db.prepare("SELECT 1 FROM users WHERE id = ? AND deactivated_at IS NULL").bind(ownerId).first())) throw new HttpError(400, "The rule's owner must be someone in this workspace");
  const actions = Array.isArray(b.actions) ? b.actions : [];
  if (!actions.length) throw new HttpError(400, "A rule needs at least one action");
  if (actions.length > 10) throw new HttpError(400, "Up to 10 actions");
  const orgId = /** @type {Scope} */ (c.scope).orgId;
  /** @type {AutomationAction[]} */ const clean = [];
  for (const [i, a] of actions.entries()) {
    const kind = /** @type {ActionKind} */ (a.kind);
    if (!(kind in ACTIONS)) throw new HttpError(400, `Action ${i + 1}: unknown action`);
    const field = a.field ? String(a.field).slice(0, 60) : undefined;
    const value = a.value != null ? String(a.value).slice(0, 4000) : undefined;
    const value2 = a.value2 ? String(a.value2).slice(0, 60) : undefined;
    const need = /** @param {boolean} ok @param {string} msg */ (ok, msg) => {
      if (!ok) throw new HttpError(400, `Action ${i + 1}: ${msg}`);
    };
    /** @returns {Record<string, unknown>} */ const cfg = () => {
      try {
        const v = JSON.parse(value ?? "{}");
        need(!!v && typeof v === "object" && !Array.isArray(v), "its settings aren't valid");
        return v;
      } catch {
        throw new HttpError(400, `Action ${i + 1}: its settings aren't valid`);
      }
    };
    if (kind === "transition") need(!!value, "choose the status");
    if (kind === "assign") {
      need(!!value, "choose who to assign");
      const v = /** @type {string} */ (value);
      if (v.startsWith("role:")) need(ROLES.includes(/** @type {Role} */ (v.slice(5))), "unknown role");
      if (/^(round_robin|least_loaded):/.test(v)) need(/^(round_robin|least_loaded):(role:[a-z_]+|people:[a-z0-9._,-]+)$/.test(v), "choose a role or the people to share it between");
    }
    if (kind === "set_field") {
      need(!!field && field in SETTABLE_FIELDS, "choose the field");
      if (field === "priority") need(WORK_PRIORITIES.includes(/** @type {never} */ (String(value).toUpperCase())), "choose a priority");
      if (field === "dueDate") need(!value || /^\d{4}-\d{2}-\d{2}$/.test(value) || /^[+-]?\d+[dwmy]$/i.test(value) || /^\+?\d{1,3}wd$/i.test(value), "a date, +3d (days), +2wd (working days) or +1w");
    }
    if (kind === "add_label") need(!!value?.trim(), "write the label");
    if (kind === "clear_field") need(!!field && field in CLEARABLE, "choose the field to clear");
    if (kind === "comment") need(!!value?.trim(), "write the comment");
    if (kind === "create_subtask") need(!!value?.trim(), "write the sub-task's summary");
    if (kind === "link") need(!!field && LINK_TYPES.includes(/** @type {never} */ (field)) && /^[A-Z]{2,10}-\d+$/i.test(value ?? ""), "choose a link type and a work item key");
    if (kind === "notify") {
      need(!!field && (["watchers", "assignee", "reporter", "teams"].includes(field) || /^person:/.test(field) || (/^role:/.test(field) && ROLES.includes(/** @type {Role} */ (field.slice(5))))), "choose who to notify");
      need(!!value2 && value2.split(",").every((y) => ["bell", "email", "teams"].includes(y.trim())), "choose how: bell, email or Teams");
    }
    if (kind === "create_item") {
      const v = cfg();
      need(!!String(v.summary ?? "").trim(), "write the new item's summary");
      const ws = String(v.workspaceId ?? "");
      if (ws && ws !== /** @type {Scope} */ (c.scope).workspaceId) {
        const env = /** @type {Env} */ (c.env);
        if (!(await env.ROOT.prepare("SELECT 1 FROM workspaces WHERE organization_id = ? AND id = ? AND status = 'active'").bind(orgId, ws).first())) throw new HttpError(404, `Action ${i + 1}: workspace not found`);
        await checkOwnerCanCreate(env, orgId, ws, ownerId);
        if (v.systemId && !(await env.ROOT.withScope({ orgId, workspaceId: ws }).prepare("SELECT 1 FROM systems WHERE id = ?").bind(String(v.systemId)).first())) throw new HttpError(400, `Action ${i + 1}: that project isn't in that workspace`);
        need(!!v.systemId, "choose the project in the other workspace");
      } else if (v.systemId) need(!!(await c.db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(String(v.systemId)).first()), "choose a project in this workspace");
      if (BULK_TRIGGERS.includes(trigger) || trigger === "webhook") need(!!v.systemId, "choose the project the item goes in");
    }
    if (kind === "email") {
      const v = cfg();
      const to = String(v.to ?? "");
      need(["assignee", "reporter", "watchers"].includes(to) || (/^role:/.test(to) && ROLES.includes(/** @type {Role} */ (to.slice(5)))) || /^emails:[^\s]+@/.test(to), "choose who to email");
      need(!!String(v.subject ?? "").trim(), "write the subject");
    }
    if (kind === "message") {
      const v = cfg();
      need(MESSAGE_CHANNELS.includes(/** @type {any} */ (v.channel)), "choose WhatsApp or SMS");
      need(["assignee", "reporter"].includes(String(v.to)) || /^phone:\+\d{8,15}$/.test(String(v.to ?? "").replace(/[\s()-]/g, "")), "choose who to send it to");
      need(!!String(v.text ?? "").trim(), "write the message");
    }
    if (kind === "webhook") {
      const v = cfg();
      need(/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(String(v.url ?? "")), "the webhook address must start with https://");
      try {
        // With every smart value filled in, it must be JSON.
        JSON.parse(renderTemplate(String(v.payload ?? "{}"), {}, "json").replace(/\{\{[^}]*\}\}/g, "x"));
      } catch {
        throw new HttpError(400, `Action ${i + 1}: the payload must be JSON (smart values go inside quotes)`);
      }
    }
    clean.push({ kind, ...(field ? { field } : {}), ...(value !== undefined ? { value } : {}), ...(value2 ? { value2 } : {}) });
  }
  return {
    name,
    description: String(b.description ?? "")
      .trim()
      .slice(0, 300),
    enabled: b.enabled ? 1 : 0,
    scope,
    scopeValue,
    trigger,
    triggerValue: b.triggerValue ? String(b.triggerValue).slice(0, 60) : null,
    triggerConfig,
    conditions,
    pql,
    max,
    ownerId,
    actions: clean,
  };
}
/** @typedef {Awaited<ReturnType<typeof checkRule>>} CheckedRule */
const summary =
  /** @param {AutomationRule} r */
  (r) => ({
    name: r.name,
    enabled: r.enabled,
    trigger: TRIGGERS[r.trigger].label,
    ...(r.triggerConfig && r.trigger === "schedule" ? { when: describeSchedule(r.triggerConfig) } : {}),
    scope: r.scope === "global" ? "everywhere" : `${r.scope} ${r.scopeValue}`,
    condition: r.conditionPql || "none",
    conditions: r.conditions ? JSON.stringify(r.conditions).slice(0, 300) : "none",
    actions: r.actions.map((a) => ACTIONS[a.kind]),
  });

/**
 * Saves a rule (new or changed) through a workspace's handle. Webhook actions keep their signing secret when their
 * address is unchanged; new ones get a new secret, returned once. A webhook trigger gets a secret address, returned
 * once (and again only when asked to make a new one).
 * @param {Env} env
 * @param {D1Database} db
 * @param {string} id
 * @param {CheckedRule} b
 * @param {{ isNew: boolean; by: string; now: string; sharedId?: string | null; sharedScope?: "organization" | "workspaces" | null; newWebhook?: boolean }} o
 * @returns {Promise<{ secrets: { action: number; secret: string }[]; webhookToken?: string }>}
 */
async function saveRule(env, db, id, b, o) {
  const before = o.isNew ? [] : /** @type {ActionRow[]} */ ((await db.prepare("SELECT * FROM automation_actions WHERE rule_id = ? ORDER BY position").bind(id).all()).results);
  /** @type {{ action: number; secret: string }[]} */ const secrets = [];
  /** @type {(string | null)[]} */ const sealedFor = [];
  for (const [i, a] of b.actions.entries()) {
    if (a.kind !== "webhook") {
      sealedFor.push(null);
      continue;
    }
    const url = config(a).url;
    const kept = before.find((p) => p.kind === "webhook" && config(/** @type {any} */ (p)).url === url && p.secret_sealed);
    if (kept) {
      sealedFor.push(kept.secret_sealed);
      continue;
    }
    if (!env.MFA_KEY) throw new HttpError(500, "Secrets can't be stored: MFA_KEY isn't set on the server");
    const secret = newToken();
    sealedFor.push(await sealSecret(secret, env.MFA_KEY));
    secrets.push({ action: i + 1, secret });
  }
  const hadToken = !o.isNew && !!(/** @type {{ t: string | null } | null} */ (await db.prepare("SELECT webhook_token_hash AS t FROM automation_rules WHERE id = ?").bind(id).first()))?.t;
  const token = b.trigger === "webhook" && (o.newWebhook || !hadToken) ? newToken() : null;
  const tokenSql = b.trigger !== "webhook" ? "NULL" : token ? "?" : "webhook_token_hash";
  const tokenArgs = token ? [await tokenHash(token)] : [];
  await db.batch([
    o.isNew
      ? db
          .prepare(
            `INSERT INTO automation_rules (id, name, description, enabled, scope, scope_value, trigger, trigger_value, trigger_config, conditions, condition_pql, max_per_minute, owner_id, shared_id, shared_scope, webhook_token_hash, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${token ? "?" : "NULL"}, ?, ?, ?)`,
          )
          .bind(id, b.name, b.description, b.enabled, b.scope, b.scopeValue, b.trigger, b.triggerValue, b.triggerConfig ? JSON.stringify(b.triggerConfig) : null, b.conditions ? JSON.stringify(b.conditions) : null, b.pql, b.max, b.ownerId, o.sharedId ?? null, o.sharedScope ?? null, ...tokenArgs, o.by, o.now, o.now)
      : db
          .prepare(
            `UPDATE automation_rules SET name = ?, description = ?, enabled = ?, scope = ?, scope_value = ?, trigger = ?, trigger_value = ?, trigger_config = ?, conditions = ?,
               schedule_weekday = NULL, schedule_hour = NULL, condition_pql = ?, max_per_minute = ?, owner_id = ?, webhook_token_hash = ${tokenSql}, updated_at = ? WHERE id = ?`,
          )
          .bind(b.name, b.description, b.enabled, b.scope, b.scopeValue, b.trigger, b.triggerValue, b.triggerConfig ? JSON.stringify(b.triggerConfig) : null, b.conditions ? JSON.stringify(b.conditions) : null, b.pql, b.max, b.ownerId, ...tokenArgs, o.now, id),
    db.prepare("DELETE FROM automation_actions WHERE rule_id = ?").bind(id),
    ...b.actions.map((a, i) =>
      db.prepare("INSERT INTO automation_actions (id, rule_id, position, kind, field, value, value2, secret_sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newToken().slice(0, 16), id, i + 1, a.kind, a.field ?? null, a.value ?? null, a.value2 ?? null, sealedFor[i]),
    ),
  ]);
  return { secrets, ...(token ? { webhookToken: token } : {}) };
}
/** The workspaces an organisation rule covers: all active ones, or those named. @param {Env} env @param {string} orgId @param {"organization" | "workspaces"} scope @param {unknown} list */
async function sharedTargets(env, orgId, scope, list) {
  const all = /** @type {{ id: string; name: string }[]} */ ((await env.ROOT.prepare("SELECT id, name FROM workspaces WHERE organization_id = ? AND status = 'active' ORDER BY position, name").bind(orgId).all()).results);
  if (scope === "organization") return all;
  const want = Array.isArray(list) ? list.map(String) : [];
  const picked = all.filter((w) => want.includes(w.id));
  if (!picked.length) throw new HttpError(400, "Choose the workspaces the rule is for");
  if (picked.length !== want.length) throw new HttpError(404, "Workspace not found");
  return picked;
}
/**
 * A new workspace joins the organisation's organisation-wide rules: each gets a copy there (worker/index.js calls
 * this when a workspace is made).
 * @param {Env} env
 * @param {string} orgId
 * @param {string} workspaceId
 */
export async function copyOrganisationRules(env, orgId, workspaceId) {
  const root = env.ROOT;
  const groups = /** @type {{ shared_id: string }[]} */ ((await root.prepare("SELECT DISTINCT shared_id FROM automation_rules WHERE organization_id = ? AND shared_scope = 'organization'").bind(orgId).all()).results);
  const target = /** @type {{ name: string }} */ (await root.prepare("SELECT name FROM workspaces WHERE organization_id = ? AND id = ?").bind(orgId, workspaceId).first());
  const db = root.withScope({ orgId, workspaceId });
  for (const g of groups) {
    const src = /** @type {RuleRow | null} */ (await root.prepare("SELECT * FROM automation_rules WHERE organization_id = ? AND shared_id = ? ORDER BY created_at LIMIT 1").bind(orgId, g.shared_id).first());
    if (!src) continue;
    const acts = /** @type {ActionRow[]} */ ((await root.prepare("SELECT * FROM automation_actions WHERE organization_id = ? AND rule_id = ? ORDER BY position").bind(orgId, src.id).all()).results);
    const id = newToken().slice(0, 16);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO automation_rules (id, name, description, enabled, scope, scope_value, trigger, trigger_value, trigger_config, conditions, condition_pql, max_per_minute, owner_id, shared_id, shared_scope, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'global', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'organization', ?, ?, ?)`,
        )
        .bind(id, src.name, src.description, src.enabled, src.trigger, src.trigger_value, src.trigger_config, src.conditions, src.condition_pql, src.max_per_minute, src.owner_id, g.shared_id, src.created_by, now, now),
      ...acts.map((a) => db.prepare("INSERT INTO automation_actions (id, rule_id, position, kind, field, value, value2, secret_sealed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newToken().slice(0, 16), id, a.position, a.kind, a.field, a.value, a.value2, a.secret_sealed)),
    ]);
    void target;
  }
}

/**
 * What a rule would do to an item, changing nothing: whether its trigger, scope and conditions let it run, and each
 * action's effect.
 * @param {ItemContext} c
 * @param {Env} env
 * @param {Loaded} l
 * @param {ItemRow | null} row
 */
async function dryRun(c, env, l, row) {
  const db = c.db;
  const info = await orgInfo(db);
  const names = new Map((/** @type {D1Result<{ id: string; name: string; }>} */ (await db.prepare("SELECT id, name FROM users").all())).results.map((u) => [u.id, u.name]));
  /** @type {{ label: string; result: boolean }[]} */ const checks = [];
  let pqlOk = true;
  if (row) {
    checks.push({ label: `In the rule's scope (${l.rule.scope === "global" ? "the whole workspace" : (l.rule.scopeValue ?? "")})`, result: await inScope(db, l.row, row.system_id) });
    if (l.row.condition_pql.trim()) {
      const f = await filterSql(db, l.row.condition_pql, AUTOMATION_VIEWER, Date.now());
      pqlOk = !!(await db
        .prepare(`SELECT 1 FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE (${f.where}) AND w.id = ?`)
        .bind(...f.params, row.id)
        .first());
      checks.push({ label: `PQL: ${l.row.condition_pql}`, result: pqlOk });
    }
  }
  const evaluated = row ? evaluateConditions(l.rule.conditions, await evalItemOf(db, row), { now: Date.now(), today: localTime(Date.now(), info.timeZone).day, userName: (id) => names.get(id) ?? id }) : { result: true, details: [] };
  const wouldRun = checks.every((x) => x.result) && evaluated.result;
  /** @type {string[]} */ const actions = [];
  const x = /** @type {ActContext} */ ({ env, info, names, rule: { ...l.row }, actionRows: l.actionRows, by: c.me.id, payload: {}, dry: true });
  const bulk = BULK_TRIGGERS.includes(l.rule.trigger);
  const rows = row ? [row] : bulk ? await matchingItems(db, l.row, Date.now(), "", [], 20) : [];
  for (const a of l.rule.actions) {
    try {
      if (a.kind === "notify") actions.push(await notify(env, c, a, rows, x, bulk));
      else {
        const targets = bulk && ONCE_PER_RUN.includes(a.kind) ? [rows[0] ?? null] : rows.length ? rows : [null];
        for (const r of targets.slice(0, 5)) actions.push((await act(c, a, r, x)).message ?? `Would ${ACTIONS[a.kind].toLowerCase()}`);
      }
    } catch (e) {
      actions.push(`Would fail: ${e instanceof Error ? e.message : "it can't run"}`);
    }
  }
  return { wouldRun, checks: [...checks, ...evaluated.details], conditionsHold: evaluated.result, ...(bulk && !row ? { items: rows.length } : {}), actions };
}

/**
 * Adds a preset as a switched-off rule in this workspace, matching its statuses, item types and custom fields by
 * name, and saying what didn't match (to fix before switching it on).
 * @param {ItemContext} c
 * @param {Env} env
 * @param {string} presetId
 */
async function addPreset(c, env, presetId) {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) throw new HttpError(404, "Preset not found");
  /** @type {string[]} */ const warnings = [];
  const statuses = await statusCatalogue(c.db);
  const statusByName = (/** @type {string} */ n) => statuses.find((s) => s.name.toLowerCase() === n.toLowerCase());
  const types = new Set((/** @type {{ id: string }[]} */ ((await c.db.prepare("SELECT id FROM item_types WHERE active = 1").all()).results)).map((t) => t.id));
  const fields = /** @type {{ id: string; name: string }[]} */ ((await c.db.prepare("SELECT id, name FROM custom_fields").all()).results);
  let triggerValue = p.triggerValue ?? null;
  if (triggerValue && p.trigger === "item_transitioned") {
    const s = statusByName(triggerValue);
    if (s) triggerValue = s.id;
    else warnings.push(`This workspace has no status called "${p.triggerValue}": choose the status that sets it off`);
  }
  /** @param {any} g */
  const fix = (g) => {
    if (!g) return g;
    return {
      op: g.op,
      items: g.items
        .map((/** @type {any} */ it) => {
          if (it.items) return fix(it);
          if (it.field === "type" && !types.has(String(it.value))) warnings.push(`This workspace has no "${it.value}" item type on: check the conditions`);
          if (it.field === "custom" && String(it.fieldId).startsWith("@")) {
            const f = fields.find((y) => y.name.toLowerCase() === String(it.fieldId).slice(1).toLowerCase());
            if (!f) {
              warnings.push(`This workspace has no "${String(it.fieldId).slice(1)}" field: that condition was left out`);
              return null;
            }
            return { ...it, fieldId: f.id };
          }
          return it;
        })
        .filter(Boolean),
    };
  };
  const conditions = fix(p.conditions);
  const actions = p.actions.map((a) => {
    if (a.kind === "transition" && a.value) {
      const s = statusByName(a.value);
      if (!s) warnings.push(`This workspace has no status called "${a.value}": choose where it moves`);
      return { ...a, value: s?.id ?? a.value };
    }
    if (a.kind === "create_item") warnings.push("Choose the project the new item goes in");
    return a;
  });
  const ws = /** @type {{ name: string }} */ (await c.db.prepare("SELECT name FROM workspaces WHERE id = ?").bind(/** @type {Scope} */ (c.scope).workspaceId).first());
  /** @type {CheckedRule} */ const b = {
    name: p.name.slice(0, 80),
    description: p.description.slice(0, 300),
    enabled: 0,
    scope: "global",
    scopeValue: null,
    trigger: p.trigger,
    triggerValue,
    triggerConfig: p.triggerConfig ?? null,
    conditions,
    pql: "",
    max: 10,
    ownerId: c.me.id,
    actions,
  };
  const id = newToken().slice(0, 16);
  await saveRule(env, c.db, id, b, { isNew: true, by: c.me.id, now: c.now });
  void ws;
  const [after] = (await loadRules(c.db, "id = ?", [id])).map((l) => l.rule);
  await c.audit("automation_rule_created", null, { ...summary(after), preset: p.id });
  return { rule: after, warnings };
}

/**
 * @param {ItemContext} c
 * @param {Env} env
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function automationApi(c, env, path, method) {
  if (!path.startsWith("/api/automation")) return null;
  const { db, req } = c;
  const scope = /** @type {Scope} */ (c.scope);
  // The buttons on a work item: anyone who can work on items there (not a view-only link; a Viewer is refused
  // earlier) may press one.
  if (path === "/api/automation/manual" && method === "GET") {
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const key = new URL(req.url).searchParams.get("item") ?? "";
    const row = await itemByKey(c, key.toUpperCase());
    const rules = await loadRules(db, "enabled = 1 AND trigger = 'manual'");
    /** @type {{ id: string; name: string; description: string }[]} */ const out = [];
    for (const l of rules) if (await inScope(db, l.row, row.system_id)) out.push({ id: l.rule.id, name: l.rule.name, description: l.rule.description });
    return json(out);
  }
  let m = path.match(/^\/api\/automation\/manual\/([a-z0-9-]{4,40})$/);
  if (m && method === "POST") {
    if (c.guest) throw new HttpError(403, "This link is view-only");
    const b = /** @type {{ itemKey?: unknown }} */ (await body(req));
    const row = await itemByKey(c, String(b.itemKey ?? "").toUpperCase());
    const [l] = await loadRules(db, "id = ? AND enabled = 1 AND trigger = 'manual'", [m[1]]);
    if (!l) throw new HttpError(404, "Rule not found");
    const why = await consider(env, l, row, { trigger: "manual", depth: 0, bulk: false, by: c.me.id }, `manual:${row.id}:${newToken().slice(0, 12)}`);
    if (why) return json({ ran: false, reason: why });
    const [run] = /** @type {{ status: string; message: string }[]} */ ((await db.prepare("SELECT status, message FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT 1").bind(l.rule.id).all()).results);
    return json({ ran: true, status: run?.status, message: run?.message });
  }
  if (c.guest || !c.can("manage_automation")) throw new HttpError(403, "You don't have permission to manage automation");
  if (path === "/api/automation/rules" && method === "GET") {
    const rules = (await loadRules(db)).map((l) => l.rule);
    // An organisation rule for some workspaces: which ones (from the owner, as the copies are each workspace's).
    const shared = [...new Set((await loadRules(db, "shared_scope = 'workspaces'")).map((l) => l.row.shared_id))];
    /** @type {Map<string, string[]>} */ const covers = new Map();
    for (const sid of shared) {
      const ws = /** @type {{ workspace_id: string }[]} */ ((await env.ROOT.prepare("SELECT workspace_id FROM automation_rules WHERE organization_id = ? AND shared_id = ?").bind(scope.orgId, sid).all()).results);
      covers.set(String(sid), ws.map((w) => w.workspace_id));
    }
    const rows = await loadRules(db);
    return json(rows.map((l, i) => ({ ...rules[i], ...(l.row.shared_scope === "workspaces" ? { sharedWorkspaces: covers.get(String(l.row.shared_id)) ?? [] } : {}) })));
  }
  // Where a "create a work item" action may put it: the workspaces of this organisation the person is in (as a role
  // that may create work items), with their projects. Read through each workspace's own handle.
  if (path === "/api/automation/targets" && method === "GET") {
    const mine = /** @type {{ id: string; name: string; role: Role }[]} */ (
      (
        await env.ROOT.prepare("SELECT w.id, w.name, m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id AND w.status = 'active' WHERE m.organization_id = ? AND m.user_id = ? ORDER BY w.position, w.name")
          .bind(scope.orgId, c.me.id)
          .all()
      ).results
    );
    const out = [];
    for (const w of mine) {
      const wdb = env.ROOT.withScope({ orgId: scope.orgId, workspaceId: w.id });
      if (!permissionsFor(w.role, await roleMatrix(wdb)).includes("create_work_items")) continue;
      const projects = /** @type {{ id: string; name: string; key: string }[]} */ ((await wdb.prepare("SELECT id, key, (data::json ->> 'name') AS name FROM systems ORDER BY sort, rowid").all()).results);
      out.push({ id: w.id, name: w.name, current: w.id === scope.workspaceId, projects });
    }
    return json(out);
  }
  if (path === "/api/automation/presets" && method === "GET") return json(PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, for: p.for, trigger: p.trigger })));
  m = path.match(/^\/api\/automation\/presets\/([a-z0-9-]{2,40})$/);
  if (m && method === "POST") return json(await addPreset(c, env, m[1]), 201);
  if (path === "/api/automation/test" && method === "POST") {
    // A rule not yet saved, tried on an item.
    const b = /** @type {{ rule?: unknown; itemKey?: unknown }} */ (await body(req));
    const checked = await checkRule(c, /** @type {any} */ (b.rule ?? {}));
    const row = b.itemKey ? await itemByKey(c, String(b.itemKey).toUpperCase()) : null;
    /** @type {Loaded} */ const l = {
      row: /** @type {RuleRow} */ ({ id: "draft", name: checked.name, description: "", enabled: 1, scope: checked.scope, scope_value: checked.scopeValue, trigger: checked.trigger, trigger_value: checked.triggerValue, trigger_config: null, conditions: null, condition_pql: checked.pql, max_per_minute: checked.max, created_by: c.me.id, owner_id: checked.ownerId, rr_cursor: 0, schedule_weekday: null, schedule_hour: null, last_run_at: null, webhook_token_hash: null, shared_id: null, shared_scope: null, failure_alerted_at: null }),
      actionRows: [],
      rule: /** @type {AutomationRule} */ ({ id: "draft", name: checked.name, description: "", enabled: true, scope: /** @type {any} */ (checked.scope), trigger: checked.trigger, conditionPql: checked.pql, conditions: checked.conditions, maxPerMinute: checked.max, actions: checked.actions, ...(checked.triggerConfig ? { triggerConfig: checked.triggerConfig } : {}) }),
    };
    return json(await dryRun(c, env, l, row));
  }
  const toSave = /** @param {unknown} raw */ async (raw) => checkRule(c, /** @type {any} */ (raw));
  if (path === "/api/automation/rules" && method === "POST") {
    const raw = /** @type {Record<string, unknown>} */ (await body(req));
    const b = await toSave(raw);
    const sharedScope = raw.sharedScope === "organization" || raw.sharedScope === "workspaces" ? raw.sharedScope : null;
    if (sharedScope) {
      // An organisation rule: a copy in each workspace it covers, made through that workspace's own handle.
      if (!c.orgAdmin) throw new HttpError(403, "Only your organisation's administrators make rules for several workspaces", "org_admin_only");
      if (b.actions.some((a) => a.kind === "create_item" && config(a).systemId)) throw new HttpError(400, "A rule for several workspaces can't name one workspace's project");
      const targets = await sharedTargets(env, scope.orgId, sharedScope, raw.sharedWorkspaces);
      const sharedId = newToken().slice(0, 16);
      /** @type {Awaited<ReturnType<typeof saveRule>>} */ let made = { secrets: [] };
      let here = "";
      for (const w of targets) {
        const id = newToken().slice(0, 16);
        const r = await saveRule(env, env.ROOT.withScope({ orgId: scope.orgId, workspaceId: w.id }), id, { ...b, scope: "global", scopeValue: null }, { isNew: true, by: c.me.id, now: c.now, sharedId, sharedScope });
        if (!made.secrets.length) made = r;
        if (w.id === scope.workspaceId) here = id;
      }
      await c.audit("automation_rule_created", null, { name: b.name, sharedScope, workspaces: targets.map((w) => w.name) });
      const [after] = here ? (await loadRules(db, "id = ?", [here])).map((l) => l.rule) : [null];
      return json({ ...(after ?? { name: b.name }), workspaces: targets.length, ...(made.secrets.length ? { secrets: made.secrets } : {}) }, 201);
    }
    const id = newToken().slice(0, 16);
    const saved = await saveRule(env, db, id, b, { isNew: true, by: c.me.id, now: c.now });
    const [after] = (await loadRules(db, "id = ?", [id])).map((l) => l.rule);
    await c.audit("automation_rule_created", null, summary(after));
    return json({ ...after, ...saved, ...(saved.webhookToken ? { webhookUrl: `${env.PUBLIC_URL ?? new URL(req.url).origin}/api/hooks/automation/${saved.webhookToken}` } : {}) }, 201);
  }
  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const [before] = await loadRules(db, "id = ?", [m[1]]);
    if (!before) throw new HttpError(404, "Rule not found");
    const shared = before.row.shared_id;
    if (shared && !c.orgAdmin) throw new HttpError(403, "This is one of your organisation's rules: only its administrators change it", "org_admin_only");
    // An organisation rule changes (or goes) in every workspace it covers.
    const copies = shared
      ? /** @type {{ id: string; workspace_id: string }[]} */ ((await env.ROOT.prepare("SELECT id, workspace_id FROM automation_rules WHERE organization_id = ? AND shared_id = ?").bind(scope.orgId, shared).all()).results)
      : [{ id: before.rule.id, workspace_id: scope.workspaceId }];
    if (method === "DELETE") {
      for (const cp of copies) await env.ROOT.withScope({ orgId: scope.orgId, workspaceId: cp.workspace_id }).prepare("DELETE FROM automation_rules WHERE id = ?").bind(cp.id).run();
      await c.audit("automation_rule_deleted", null, { ...summary(before.rule), ...(shared ? { copies: copies.length } : {}) });
      return json({ ok: true });
    }
    const raw = /** @type {Record<string, unknown>} */ (await body(req));
    const b = await toSave(raw);
    /** @type {Awaited<ReturnType<typeof saveRule>>} */ let saved = { secrets: [] };
    for (const cp of copies) {
      const r = await saveRule(env, cp.workspace_id === scope.workspaceId ? db : env.ROOT.withScope({ orgId: scope.orgId, workspaceId: cp.workspace_id }), cp.id, shared ? { ...b, scope: "global", scopeValue: null } : b, {
        isNew: false,
        by: c.me.id,
        now: c.now,
        newWebhook: !!raw.newWebhookAddress,
      });
      if (cp.id === before.rule.id) saved = r;
    }
    const [after] = (await loadRules(db, "id = ?", [before.rule.id])).map((l) => l.rule);
    await c.audit("automation_rule_updated", null, { name: after.name, from: summary(before.rule), to: summary(after) });
    return json({ ...after, ...saved, ...(saved.webhookToken ? { webhookUrl: `${env.PUBLIC_URL ?? new URL(req.url).origin}/api/hooks/automation/${saved.webhookToken}` } : {}) });
  }
  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})\/runs$/);
  if (m && method === "GET") {
    const q = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 50));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const rows = /** @type {D1Result<{ id: number; at: string; trigger_event: string; item_key: string | null; status: AutomationRun["status"]; message: string; touched: string; depth: number; detail: string | null }>} */ (
      await db.prepare("SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").bind(m[1], limit, offset).all()
    );
    const waiting = /** @type {{ n: number } | null} */ (await db.prepare("SELECT COUNT(*) AS n FROM automation_jobs WHERE rule_id = ? AND status = 'waiting'").bind(m[1]).first());
    return json(
      rows.results.map(
        /** @returns {AutomationRun & { retrying?: number }} */ (r, i) => ({
          id: Number(r.id),
          at: r.at,
          triggerEvent: r.trigger_event,
          ...(r.item_key ? { itemKey: r.item_key } : {}),
          status: r.status,
          message: r.message,
          touched: r.touched ? r.touched.split(",") : [],
          depth: Number(r.depth),
          ...(r.detail ? { detail: JSON.parse(r.detail) } : {}),
          ...(i === 0 && Number(waiting?.n) ? { retrying: Number(waiting?.n) } : {}),
        }),
      ),
    );
  }
  // The test: what the rule would do to an item, changing nothing.
  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})\/test$/);
  if (m && method === "POST") {
    const [l] = await loadRules(db, "id = ?", [m[1]]);
    if (!l) throw new HttpError(404, "Rule not found");
    const b = /** @type {{ itemKey?: unknown }} */ (await body(req).catch(() => ({})));
    if (!b.itemKey && !BULK_TRIGGERS.includes(l.rule.trigger) && l.rule.trigger !== "webhook") throw new HttpError(400, "Choose a work item to test it on");
    const row = b.itemKey ? await itemByKey(c, String(b.itemKey).toUpperCase()) : null;
    return json(await dryRun(c, env, l, row));
  }
  // Runs a rule now: a scheduled, sprint or webhook rule on everything its conditions pick, any other on one item.
  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})\/run$/);
  if (m && method === "POST") {
    const [l] = await loadRules(db, "id = ?", [m[1]]);
    if (!l) throw new HttpError(404, "Rule not found");
    const b = /** @type {{ itemKey?: unknown }} */ (await body(req).catch(() => ({})));
    const bulk = BULK_TRIGGERS.includes(l.rule.trigger) || (l.rule.trigger === "webhook" && !b.itemKey);
    if (!bulk && !b.itemKey) throw new HttpError(400, "Say which work item to run it on");
    const idem = `hand:${newToken().slice(0, 12)}`;
    if (bulk) await runJob(env, l, await matchingItems(db, l.row, Date.now()), { trigger: "run by hand", depth: 0, bulk: true, by: c.me.id }, idem, null);
    else {
      const row = await itemByKey(c, String(b.itemKey).toUpperCase());
      await runJob(env, l, [row], { trigger: "run by hand", depth: 0, bulk: false, by: c.me.id }, idem, row.id);
    }
    await c.audit("automation_rule_run", null, { name: l.rule.name, ...(b.itemKey ? { key: String(b.itemKey).toUpperCase() } : {}) });
    const [run] = /** @type {{ status: string; message: string; touched: string }[]} */ ((await db.prepare("SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT 1").bind(l.rule.id).all()).results);
    return json({ status: run?.status, message: run?.message, touched: run?.touched ? run.touched.split(",") : [] });
  }
  throw new HttpError(404, "Not found");
}
/**
 * Ask Pulse, for people who manage automation: each rule and how it last went.
 * @param {D1Database} db
 * @returns {Promise<string[]>}
 */
export async function askAutomationLines(db) {
  const rules = await loadRules(db);
  if (!rules.length) return [];
  return [
    "",
    "AUTOMATION RULES (name | on or off | when | condition | actions | last run)",
    ...rules.map(({ rule: r }) =>
      [r.name, r.enabled ? "on" : "off", TRIGGERS[r.trigger].label, r.conditionPql || (r.conditions ? "conditions" : "-"), r.actions.map((a) => ACTIONS[a.kind]).join(", "), r.lastRunAt ? `${r.lastRunAt.slice(0, 16)} (${r.lastStatus ?? "?"})` : "never"]
        .map((y) => String(y).replace(/\|/g, "/"))
        .join(" | "),
    ),
  ];
}
/** @typedef {Awaited<ReturnType<typeof loadRules>>[number]} Loaded */
/**
 * @typedef {Object} OrgInfo
 * @property {string} orgId
 * @property {string} workspaceId
 * @property {string} orgName
 * @property {string} workspaceName
 * @property {string} timeZone
 * @property {number[]} workDays
 *
 * @typedef {Object} RunInput
 * @property {string} trigger
 * @property {number} depth
 * @property {boolean} bulk
 * @property {string} [by]   who set it off (a user id, or "automation")
 * @property {Record<string, unknown>} [payload]  a webhook trigger's body
 * @property {{ label: string; result: boolean }[]} [conditions]
 * @property {number} [attempt]
 *
 * @typedef {Object} ActContext
 * @property {Env} env
 * @property {OrgInfo} info
 * @property {Map<string, string>} names
 * @property {RuleRow} rule
 * @property {ActionRow[]} actionRows
 * @property {string} [by]
 * @property {Record<string, unknown>} payload
 * @property {boolean} dry   say what would happen, change nothing
 *
 * @typedef {Object} RuleRow
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} enabled
 * @property {AutomationRule["scope"]} scope
 * @property {string | null} scope_value
 * @property {Trigger} trigger
 * @property {string | null} trigger_value
 * @property {string | null} trigger_config
 * @property {string | null} conditions
 * @property {number | null} schedule_weekday
 * @property {number | null} schedule_hour
 * @property {string} condition_pql
 * @property {number} max_per_minute
 * @property {string} created_by
 * @property {string | null} owner_id
 * @property {number} rr_cursor
 * @property {string | null} last_run_at
 * @property {string | null} webhook_token_hash
 * @property {string | null} shared_id
 * @property {"organization" | "workspaces" | null} shared_scope
 * @property {string | null} failure_alerted_at
 *
 * @typedef {Object} ActionRow
 * @property {string} id
 * @property {string} rule_id
 * @property {number} position
 * @property {ActionKind} kind
 * @property {string | null} field
 * @property {string | null} value
 * @property {string | null} value2
 * @property {string | null} secret_sealed
 */
