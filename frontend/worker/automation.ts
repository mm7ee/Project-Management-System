// Automation: rules that react to work item and sprint events, or run on a schedule (the hourly cron),
// check a PQL condition, and act: move, assign, set a field, comment, notify, create a sub-task, link.
//
// Rules act as "Automation: <rule name>" with full rights, through the same code people use, so
// workflow moves, the activity log, history and alerts all behave as usual. Events caused by a rule's
// actions may set off other rules, but only MAX_AUTOMATION_DEPTH levels deep, and each rule runs at
// most max_per_minute times a minute. Every run is logged in automation_runs.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { postToTeams, raise, readDelivery, type Alert, type ChannelPost } from "./notify";
import { filterSql, harare } from "./search";
import {
  SELECT,
  addComment,
  afterChange,
  applyChange,
  createItem,
  itemById,
  itemByKey,
  keyOf,
  personWithRole,
  transitionItem,
  type ItemContext,
  type ItemEvent,
  type ItemRow,
} from "./workitems";
import { loadWorkflow, statusCatalogue, workflowIdFor } from "./workflowData";
import { relativeDate } from "../src/data/pql";
import { ROLES, type Role } from "../src/data/roles";
import { canSeeItem, viewersOf, type Viewer } from "./access";
import { dispatchWebhooks } from "./integrations";
import { ACTIONS, MAX_AUTOMATION_DEPTH, SETTABLE_FIELDS, TRIGGERS, type ActionKind, type AutomationAction, type AutomationRule, type AutomationRun, type Trigger } from "../src/data/search";
import { LINK_TYPES, WORK_PRIORITIES, cleanLabel } from "../src/data/workitems";
import { checkTransition, transitionsFrom } from "../src/data/workflows";

interface RuleRow {
  id: string;
  name: string;
  description: string;
  enabled: number;
  scope: AutomationRule["scope"];
  scope_value: string | null;
  trigger: Trigger;
  trigger_value: string | null;
  schedule_weekday: number | null;
  schedule_hour: number | null;
  condition_pql: string;
  max_per_minute: number;
  last_run_at: string | null;
}

const AUTOMATION_VIEWER: Viewer = { id: "automation", role: "admin" as Role, ownOnly: false, all: true };

async function loadRules(db: D1Database, where = "TRUE", args: unknown[] = []) {
  const rules = await db.prepare(`SELECT * FROM automation_rules WHERE ${where} ORDER BY name`).bind(...args).all<RuleRow>();
  if (!rules.results.length) return [];
  const ids = rules.results.map((r) => r.id);
  const actions = await db
    .prepare(`SELECT * FROM automation_actions WHERE rule_id IN (${ids.map(() => "?").join(", ")}) ORDER BY position`)
    .bind(...ids)
    .all<{ id: string; rule_id: string; kind: ActionKind; field: string | null; value: string | null; value2: string | null }>();
  const last = await db
    .prepare(`SELECT DISTINCT ON (rule_id) rule_id, status FROM automation_runs WHERE rule_id IN (${ids.map(() => "?").join(", ")}) ORDER BY rule_id, id DESC`)
    .bind(...ids)
    .all<{ rule_id: string; status: AutomationRun["status"] }>();
  return rules.results.map((r) => ({
    row: r,
    rule: {
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
      conditionPql: r.condition_pql,
      maxPerMinute: Number(r.max_per_minute),
      actions: actions.results
        .filter((a) => a.rule_id === r.id)
        .map((a): AutomationAction => ({ id: a.id, kind: a.kind, ...(a.field ? { field: a.field } : {}), ...(a.value ? { value: a.value } : {}), ...(a.value2 ? { value2: a.value2 } : {}) })),
      ...(r.last_run_at ? { lastRunAt: r.last_run_at } : {}),
      ...(last.results.find((l) => l.rule_id === r.id) ? { lastStatus: last.results.find((l) => l.rule_id === r.id)!.status } : {}),
    } satisfies AutomationRule,
  }));
}
type Loaded = Awaited<ReturnType<typeof loadRules>>[number];

/** The context a rule acts in: full rights, logged as the rule, its alerts and events collected. */
function ruleContext(env: Env, rule: RuleRow, alerts: Alert[], events: ItemEvent[], posts: ChannelPost[] = []): ItemContext {
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
      await env.DB
        .prepare("INSERT INTO activity (at, user_id, actor, action, target, detail, ip, agent) VALUES (?, NULL, ?, ?, ?, ?, NULL, 'automation')")
        .bind(new Date().toISOString(), name, action, target, JSON.stringify({ ...detail, automation: rule.name }))
        .run()
        .catch(() => undefined);
    },
    alert: (a, channel) => {
      alerts.push(...a);
      if (channel) posts.push(channel);
    },
    emit: (e) => events.push(e),
  };
}

const fill = (template: string, r: ItemRow, names: Map<string, string>) =>
  template
    .replace(/\{key\}/g, keyOf(r))
    .replace(/\{summary\}/g, r.summary)
    .replace(/\{status\}/g, r.status_name)
    .replace(/\{priority\}/g, r.priority.charAt(0) + r.priority.slice(1).toLowerCase())
    .replace(/\{assignee\}/g, r.assignee ? (names.get(r.assignee) ?? "someone") : "nobody")
    .replace(/\{project\}/g, r.project_name);

async function inScope(db: D1Database, rule: RuleRow, systemId: string): Promise<boolean> {
  if (rule.scope === "global") return true;
  if (rule.scope === "project") return rule.scope_value === systemId;
  const ws = await db.prepare("SELECT (data::json ->> 'workspace') AS w FROM systems WHERE id = ?").bind(systemId).first<{ w: string | null }>();
  return (ws?.w ?? "") === rule.scope_value;
}

/** The items a rule's condition picks within its scope (all of them with no condition). */
async function matchingItems(db: D1Database, rule: RuleRow, now: number, extra = "", extraArgs: unknown[] = [], limit = 500): Promise<ItemRow[]> {
  const f = await filterSql(db, rule.condition_pql, AUTOMATION_VIEWER, now);
  const scope =
    rule.scope === "project" ? { sql: " AND w.system_id = ?", args: [rule.scope_value] } : rule.scope === "workspace" ? { sql: " AND (s.data::json ->> 'workspace') = ?", args: [rule.scope_value] } : { sql: "", args: [] };
  const rows = await db
    .prepare(`${SELECT} WHERE ${f.where}${scope.sql}${extra} ORDER BY ${f.orderBy} LIMIT ?`)
    .bind(...f.params, ...scope.args, ...extraArgs, limit)
    .all<ItemRow>();
  return rows.results;
}

async function logRun(db: D1Database, rule: RuleRow, run: { trigger: string; itemKey?: string; status: AutomationRun["status"]; message: string; touched: string[]; depth: number }) {
  const at = new Date().toISOString();
  await db.batch([
    db
      .prepare("INSERT INTO automation_runs (rule_id, at, trigger_event, item_key, status, message, touched, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(rule.id, at, run.trigger, run.itemKey ?? null, run.status, run.message.slice(0, 1000), run.touched.join(",").slice(0, 2000), run.depth),
    ...(run.status !== "skipped" ? [db.prepare("UPDATE automation_rules SET last_run_at = ? WHERE id = ?").bind(at, rule.id)] : []),
  ]);
}

/** Runs a rule's actions on the items given. `bulk`: one notification per person, listing their items. */
async function execute(env: Env, loaded: Loaded, rows: ItemRow[], trigger: string, depth: number, bulk: boolean) {
  const db = env.DB;
  const { row: rule, rule: r } = loaded;
  const alerts: Alert[] = [];
  const events: ItemEvent[] = [];
  const posts: ChannelPost[] = [];
  const c = ruleContext(env, rule, alerts, events, posts);
  const touched = new Set<string>();
  const notes: string[] = [];
  const names = new Map((await db.prepare("SELECT id, name FROM users").all<{ id: string; name: string }>()).results.map((u) => [u.id, u.name]));
  let status: AutomationRun["status"] = "success";
  try {
    for (const action of r.actions) {
      if (action.kind === "notify") {
        notes.push(await notify(env, c, action, rows, names, bulk));
        continue;
      }
      for (const original of rows) {
        const row = (await itemById(c, original.id)) ?? original;
        const note = await act(c, action, row, names);
        if (note.changed) touched.add(keyOf(note.row ?? row));
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
  await logRun(db, rule, {
    trigger,
    itemKey: !bulk && rows[0] ? keyOf(rows[0]) : undefined,
    status,
    message: notes.filter(Boolean).join("; ") || (rows.length ? `Ran on ${rows.length} item${rows.length === 1 ? "" : "s"}` : "Nothing matched"),
    touched: [...touched],
    depth,
  });
  // What the actions set off, one level deeper.
  for (const e of events) await runEvent(env, e, depth + 1);
}

/** One action on one item. Returns whether it changed anything, and a note for the run log. */
async function act(c: ItemContext, a: AutomationAction, row: ItemRow, names: Map<string, string>): Promise<{ changed: boolean; row?: ItemRow; message?: string }> {
  switch (a.kind) {
    case "transition": {
      const wf = await loadWorkflow(c.db, await workflowIdFor(c.db, row.system_id));
      const statuses = new Map((await statusCatalogue(c.db)).map((s) => [s.id, s]));
      const want = String(a.value ?? "");
      const hit = (to: string) => {
        const s = statuses.get(to);
        if (!s) return false;
        if (want.startsWith("category:")) return s.category === want.slice(9).toUpperCase();
        return s.id === want.toUpperCase() || s.name.toLowerCase() === want.toLowerCase();
      };
      if (hit(row.status)) return { changed: false, message: `${keyOf(row)} was already ${row.status_name}` };
      const t = transitionsFrom(wf, row.status).find((x) => hit(x.to));
      if (!t) return { changed: false, message: `${keyOf(row)}: the ${wf.name} workflow has no move from ${row.status_name} to ${want.replace("category:", "")}` };
      const check = checkTransition(
        t,
        {
          status: row.status,
          assignee: row.assignee,
          reporter: row.reporter,
          description: row.description,
          dueDate: row.due_date,
          startDate: row.start_date,
          storyPoints: row.story_points,
          originalEstimate: row.original_estimate,
          component: row.component,
          labels: row.labels ? row.labels.split(",") : [],
        },
        c.me,
        { comment: "x" },
      );
      if (check.needs.assignee || check.needs.fields.length) return { changed: false, message: `${keyOf(row)}: "${t.name}" needs ${check.needs.assignee ? "an assignee" : check.needs.fields.join(", ")} first` };
      const needsComment = t.rules.some((x) => x.kind === "validator" && x.rule === "comment_required");
      const res = await transitionItem(c, row, { transitionId: t.id, ...(needsComment ? { comment: `Moved by the automation rule "${c.me.name.replace(/^Automation: /, "")}".` } : {}) });
      return { changed: true, row: res.after };
    }
    case "assign": {
      const v = String(a.value ?? "");
      let to: string | null = null;
      if (v === "nobody") to = null;
      else if (v === "reporter") to = row.reporter;
      else if (v === "lead") to = (await c.db.prepare("SELECT (data::json ->> 'lead') AS l FROM systems WHERE id = ?").bind(row.system_id).first<{ l: string | null }>())?.l ?? null;
      else if (v.startsWith("role:")) to = await personWithRole(c, v.slice(5), row.system_id);
      else to = v;
      if (v !== "nobody" && !to) return { changed: false, message: `${keyOf(row)}: nobody to assign (${v})` };
      const res = await applyChange(c, row, { assignee: to });
      if (!res.changed.length) return { changed: false };
      await c.audit("work_item_updated", row.system_id, { name: row.project_name, key: keyOf(row), summary: row.summary, fields: res.changed, ...res.diff });
      await afterChange(c, res);
      return { changed: true, row: res.after };
    }
    case "set_field": {
      const f = String(a.field ?? "");
      const v = String(a.value ?? "");
      const patch: Record<string, unknown> =
        f === "priority"
          ? { priority: v.toUpperCase() }
          : f === "component"
            ? { component: v }
            : f === "storyPoints"
              ? { storyPoints: v === "" ? null : Number(v) }
              : f === "dueDate"
                ? { dueDate: /^[+-]?\d+[dwmy]$/i.test(v) ? relativeDate(v.startsWith("+") || v.startsWith("-") ? v.toLowerCase() : `+${v.toLowerCase()}`, Date.now()).slice(0, 10) : v || null }
                : f === "labels"
                  ? { labels: [...new Set([...(row.labels ? row.labels.split(",") : []), cleanLabel(v)])] }
                  : f === "onHold"
                    ? { onHold: /^(yes|true|1|on)$/i.test(v) }
                    : {};
      if (!Object.keys(patch).length) return { changed: false, message: `Unknown field ${f}` };
      const res = await applyChange(c, row, patch);
      if (!res.changed.length) return { changed: false };
      await c.audit("work_item_updated", row.system_id, { name: row.project_name, key: keyOf(row), summary: row.summary, fields: res.changed, ...res.diff });
      await afterChange(c, res);
      return { changed: true, row: res.after };
    }
    case "comment":
      await addComment(c, row, fill(String(a.value ?? ""), row, names));
      return { changed: true };
    case "create_subtask": {
      if (!["STORY", "TASK", "BUG"].includes(row.type)) return { changed: false, message: `${keyOf(row)} is ${row.type.toLowerCase()}: sub-tasks go under stories, tasks and bugs` };
      const sub = await createItem(c, { systemId: row.system_id, type: "SUBTASK", parent: row.id, summary: fill(String(a.value ?? "Follow-up"), row, names), assignee: row.assignee }, "internal");
      await c.audit("work_item_created", row.system_id, { name: row.project_name, key: keyOf(sub), summary: sub.summary, type: "SUBTASK", parent: keyOf(row) });
      return { changed: true, message: `Created ${keyOf(sub)}` };
    }
    case "link": {
      const target = await itemByKey(c, String(a.value ?? "").toUpperCase()).catch(() => null);
      if (!target) return { changed: false, message: `${a.value} doesn't exist` };
      if (target.id === row.id) return { changed: false };
      const done = await c.db
        .prepare("INSERT INTO work_item_links (id, from_id, to_id, link_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .bind(newToken().slice(0, 16), row.id, target.id, String(a.field ?? "RELATES"), c.me.id, c.now)
        .run();
      if (done.meta.changes) await c.audit("link_added", row.system_id, { name: row.project_name, key: keyOf(row), summary: row.summary, link: `${keyOf(row)} ${String(a.field).toLowerCase()} ${keyOf(target)}` });
      return { changed: !!done.meta.changes };
    }
    default:
      return { changed: false };
  }
}

/**
 * Notifies the chosen people about the items: the bell (and email, per each person's settings, once
 * email is connected), and/or the Teams channel. In bulk, one message per person lists their items.
 * Developers who see only their own items hear only about those.
 */
async function notify(env: Env, c: ItemContext, a: AutomationAction, rows: ItemRow[], names: Map<string, string>, bulk: boolean): Promise<string> {
  if (!rows.length) return "";
  const db = env.DB;
  const who = String(a.field ?? "watchers");
  const channels = String(a.value2 ?? "bell").split(",").map((x) => x.trim());
  const message = String(a.value ?? "{key} {summary}");
  const link = (r: ItemRow) => `#/projects/${r.system_id}/items/${keyOf(r)}`;
  // The Teams channel is seen by the whole team, so items with a security level never go there.
  const open = rows.filter((r) => !r.security_level);
  if (who === "teams" || channels.includes("teams")) {
    const delivery = await readDelivery(db);
    if (!open.length) {
      if (who === "teams") return "Nothing posted to Teams: the items have a security level";
    } else if (delivery.teams) {
      const first = open[0];
      await postToTeams(env, delivery, {
        title: bulk && open.length > 1 ? `${message} (${open.length} items)` : fill(message, first, names),
        body: open.slice(0, 15).map((r) => `${keyOf(r)} ${r.summary}`).join("\n"),
        link: link(first),
      }).catch(() => undefined);
    } else if (who === "teams") return "Teams isn't connected yet, so nothing was posted";
    if (who === "teams") return "Posted to Teams";
  }
  if (!channels.includes("bell") && !channels.includes("email")) return "";
  const roles = new Map((await db.prepare("SELECT id, role FROM users").all<{ id: string; role: Role }>()).results.map((u) => [u.id, u.role]));
  const viewers = await viewersOf(db, [...roles.keys()]);
  const recipients = async (r: ItemRow): Promise<string[]> => {
    if (who === "assignee") return r.assignee ? [r.assignee] : [];
    if (who === "reporter") return [r.reporter];
    if (who.startsWith("person:")) return [who.slice(7)];
    if (who.startsWith("role:")) return [...roles].filter(([, role]) => role === who.slice(5)).map(([id]) => id);
    return (await db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(r.id).all<{ user_id: string }>()).results.map((x) => x.user_id);
  };
  const byPerson = new Map<string, ItemRow[]>();
  for (const r of rows) {
    for (const id of await recipients(r)) {
      const v = viewers.get(id);
      // Only about items they may see: their own-items rule and the item's security level.
      if (!v || !(await canSeeItem(db, v, r))) continue;
      byPerson.set(id, [...(byPerson.get(id) ?? []), r]);
    }
  }
  const alerts: Alert[] = [...byPerson].map(([userId, items]) =>
    bulk && items.length > 1
      ? {
          userId,
          kind: "automation" as const,
          title: `${message}: ${items.length} work items`.slice(0, 200),
          body: items.slice(0, 5).map((r) => `${keyOf(r)} ${r.summary}`).join("; ").slice(0, 500),
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
      : { userId, kind: "automation" as const, title: fill(message, items[0], names).slice(0, 200), body: `${keyOf(items[0])} ${items[0].summary}`.slice(0, 500), link: link(items[0]) },
  );
  if (alerts.length) await raise(env, alerts).catch(() => undefined);
  return `Notified ${alerts.length} ${alerts.length === 1 ? "person" : "people"}`;
}

/** Over its runs-a-minute limit? */
async function overLimit(db: D1Database, rule: RuleRow): Promise<boolean> {
  const n = await db
    .prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_id = ? AND status <> 'skipped' AND at > ?")
    .bind(rule.id, new Date(Date.now() - 60_000).toISOString())
    .first<{ n: number }>();
  return Number(n?.n ?? 0) >= Number(rule.max_per_minute);
}

/** Handles one event: every switched-on rule for it, in scope, whose condition the item meets. */
export async function runEvent(env: Env, e: ItemEvent, depth = 0): Promise<void> {
  // Outbound webhooks hear about every event, whoever (or whatever rule) caused it.
  const hooks = dispatchWebhooks(env, e).catch((err) => console.error("webhook dispatch failed", err));
  try {
    await runRules(env, e, depth);
  } finally {
    await hooks;
  }
}

async function runRules(env: Env, e: ItemEvent, depth: number): Promise<void> {
  const db = env.DB;
  const rules = await loadRules(db, "enabled = 1 AND trigger = ?", [e.type]);
  if (!rules.length) return;
  if (depth >= MAX_AUTOMATION_DEPTH) {
    for (const l of rules) await logRun(db, l.row, { trigger: e.type, status: "skipped", message: `Not run: set off by other rules ${depth} levels deep (the limit is ${MAX_AUTOMATION_DEPTH})`, touched: [], depth });
    return;
  }
  const now = Date.now();
  for (const l of rules) {
    const rule = l.row;
    try {
      if (e.type === "sprint_started" || e.type === "sprint_completed") {
        if (!(await inScope(db, rule, e.systemId))) continue;
        if (await overLimit(db, rule)) {
          await logRun(db, rule, { trigger: e.type, status: "skipped", message: `Over its limit of ${rule.max_per_minute} runs a minute`, touched: [], depth });
          continue;
        }
        const rows = await matchingItems(db, rule, now, " AND (w.sprint_id = ? OR EXISTS (SELECT 1 FROM sprint_items si WHERE si.item_id = w.id AND si.sprint_id = ?))", [e.sprintId, e.sprintId]);
        await execute(env, l, rows, e.type, depth, true);
        continue;
      }
      const row = await db.prepare(`${SELECT} WHERE w.id = ?`).bind((e as Extract<ItemEvent, { itemId: string }>).itemId).first<ItemRow>();
      if (!row || !(await inScope(db, rule, row.system_id))) continue;
      if (e.type === "item_transitioned" && rule.trigger_value) {
        const to = await db.prepare("SELECT name FROM work_statuses WHERE id = ?").bind(e.to).first<{ name: string }>();
        if (rule.trigger_value.toUpperCase() !== e.to && rule.trigger_value.toLowerCase() !== (to?.name ?? "").toLowerCase()) continue;
      }
      if (e.type === "field_changed" && rule.trigger_value && !e.fields.includes(rule.trigger_value)) continue;
      if (rule.condition_pql.trim()) {
        const f = await filterSql(db, rule.condition_pql, AUTOMATION_VIEWER, now);
        const hit = await db.prepare(`SELECT 1 FROM work_items w JOIN work_statuses st ON st.id = w.status JOIN systems s ON s.id = w.system_id WHERE (${f.where}) AND w.id = ?`).bind(...f.params, row.id).first();
        if (!hit) continue;
      }
      if (await overLimit(db, rule)) {
        await logRun(db, rule, { trigger: e.type, itemKey: keyOf(row), status: "skipped", message: `Over its limit of ${rule.max_per_minute} runs a minute`, touched: [], depth });
        continue;
      }
      await execute(env, l, [row], e.type, depth, false);
    } catch (err) {
      await logRun(db, rule, { trigger: e.type, status: "error", message: err instanceof Error ? err.message : "Something went wrong", touched: [], depth }).catch(() => undefined);
    }
  }
}

/** Scheduled rules due this hour (Harare time). Called by the hourly cron. */
export async function runScheduledRules(env: Env, now = Date.now()): Promise<number> {
  const h = harare(now);
  const rules = await loadRules(env.DB, "enabled = 1 AND trigger = 'schedule' AND schedule_hour = ? AND (schedule_weekday IS NULL OR schedule_weekday = ?) AND (last_run_at IS NULL OR last_run_at < ?)", [
    h.hour,
    h.weekday,
    new Date(now - 50 * 60_000).toISOString(),
  ]);
  for (const l of rules) await runNow(env, l, "schedule");
  return rules.length;
}

async function runNow(env: Env, l: Loaded, trigger: string, itemKey?: string) {
  try {
    if (itemKey) {
      const row = await env.DB.prepare(`${SELECT} WHERE (s.key || '-' || w.number) = ?`).bind(itemKey.toUpperCase()).first<ItemRow>();
      if (!row) throw new HttpError(404, "Work item not found");
      await execute(env, l, [row], trigger, 0, false);
    } else {
      await execute(env, l, await matchingItems(env.DB, l.row, Date.now()), trigger, 0, true);
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    await logRun(env.DB, l.row, { trigger, status: "error", message: e instanceof Error ? e.message : "Something went wrong", touched: [], depth: 0 });
  }
}

// ---------- Settings → Administration → Automation ----------

async function checkRule(c: ItemContext, b: Partial<AutomationRule>) {
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) throw new HttpError(400, "A rule needs a name");
  const trigger = b.trigger as Trigger;
  if (!(trigger in TRIGGERS)) throw new HttpError(400, "Choose what sets the rule off");
  const scope = b.scope ?? "global";
  if (!["global", "workspace", "project"].includes(scope)) throw new HttpError(400, "Unknown scope");
  let scopeValue: string | null = null;
  if (scope === "project") {
    if (!(await c.db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(String(b.scopeValue ?? "")).first())) throw new HttpError(400, "Choose the project");
    scopeValue = String(b.scopeValue);
  }
  if (scope === "workspace") {
    const ws = await c.db.prepare("SELECT value FROM settings WHERE key = 'workspaces'").first<{ value: string }>();
    if (!(ws ? (JSON.parse(ws.value) as string[]) : ["Projects", "HR"]).includes(String(b.scopeValue))) throw new HttpError(400, "Choose the workspace");
    scopeValue = String(b.scopeValue);
  }
  const weekday = trigger === "schedule" && b.scheduleWeekday != null ? Number(b.scheduleWeekday) : null;
  const hour = trigger === "schedule" ? Number(b.scheduleHour) : null;
  if (trigger === "schedule" && (!Number.isInteger(hour) || hour! < 0 || hour! > 23)) throw new HttpError(400, "Choose the hour it runs, 0 to 23 (Harare time)");
  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) throw new HttpError(400, "Choose a day of the week");
  const pql = String(b.conditionPql ?? "").trim().slice(0, 2000);
  try {
    if (pql) await filterSql(c.db, pql, AUTOMATION_VIEWER, Date.now());
  } catch (e) {
    throw new HttpError(400, `Condition: ${e instanceof Error ? e.message : "it doesn't parse"}`, "pql");
  }
  const max = Math.round(Number(b.maxPerMinute ?? 10));
  if (!(max >= 1 && max <= 100)) throw new HttpError(400, "Runs a minute: 1 to 100");
  const actions = Array.isArray(b.actions) ? b.actions : [];
  if (!actions.length) throw new HttpError(400, "A rule needs at least one action");
  if (actions.length > 10) throw new HttpError(400, "Up to 10 actions");
  const clean = actions.map((a, i): AutomationAction => {
    const kind = a.kind as ActionKind;
    if (!(kind in ACTIONS)) throw new HttpError(400, `Action ${i + 1}: unknown action`);
    const field = a.field ? String(a.field).slice(0, 60) : undefined;
    const value = a.value != null ? String(a.value).slice(0, 500) : undefined;
    const value2 = a.value2 ? String(a.value2).slice(0, 60) : undefined;
    const need = (ok: boolean, msg: string) => {
      if (!ok) throw new HttpError(400, `Action ${i + 1}: ${msg}`);
    };
    if (kind === "transition") need(!!value, "choose the status");
    if (kind === "assign") need(!!value && (!value.startsWith("role:") || ROLES.includes(value.slice(5) as Role)), "choose who to assign");
    if (kind === "set_field") {
      need(!!field && field in SETTABLE_FIELDS, "choose the field");
      if (field === "priority") need(WORK_PRIORITIES.includes(String(value).toUpperCase() as never), "choose a priority");
    }
    if (kind === "comment") need(!!value?.trim(), "write the comment");
    if (kind === "create_subtask") need(!!value?.trim(), "write the sub-task's summary");
    if (kind === "link") need(!!field && LINK_TYPES.includes(field as never) && /^[A-Z]{2,10}-\d+$/i.test(value ?? ""), "choose a link type and a work item key");
    if (kind === "notify") {
      need(!!field && (["watchers", "assignee", "reporter", "teams"].includes(field) || /^person:/.test(field) || (/^role:/.test(field) && ROLES.includes(field.slice(5) as Role))), "choose who to notify");
      need(!!value2 && value2.split(",").every((x) => ["bell", "email", "teams"].includes(x.trim())), "choose how: bell, email or Teams");
    }
    return { kind, ...(field ? { field } : {}), ...(value !== undefined ? { value } : {}), ...(value2 ? { value2 } : {}) };
  });
  return {
    name,
    description: String(b.description ?? "").trim().slice(0, 300),
    enabled: b.enabled ? 1 : 0,
    scope,
    scopeValue,
    trigger,
    triggerValue: b.triggerValue ? String(b.triggerValue).slice(0, 60) : null,
    weekday,
    hour,
    pql,
    max,
    actions: clean,
  };
}

const summary = (r: AutomationRule) => ({
  name: r.name,
  enabled: r.enabled,
  trigger: TRIGGERS[r.trigger].label,
  scope: r.scope === "global" ? "everywhere" : `${r.scope} ${r.scopeValue}`,
  condition: r.conditionPql || "none",
  actions: r.actions.map((a) => ACTIONS[a.kind]),
});

export async function automationApi(c: ItemContext, env: Env, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/automation")) return null;
  if (c.guest || !c.can("manage_automation")) throw new HttpError(403, "You don't have permission to manage automation");
  const { db, req } = c;
  if (path === "/api/automation/rules" && method === "GET") return json((await loadRules(db)).map((l) => l.rule));

  const save = async (id: string, b: Awaited<ReturnType<typeof checkRule>>, isNew: boolean) => {
    await db.batch([
      isNew
        ? db
            .prepare(
              `INSERT INTO automation_rules (id, name, description, enabled, scope, scope_value, trigger, trigger_value, schedule_weekday, schedule_hour, condition_pql, max_per_minute, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(id, b.name, b.description, b.enabled, b.scope, b.scopeValue, b.trigger, b.triggerValue, b.weekday, b.hour, b.pql, b.max, c.me.id, c.now, c.now)
        : db
            .prepare(
              `UPDATE automation_rules SET name = ?, description = ?, enabled = ?, scope = ?, scope_value = ?, trigger = ?, trigger_value = ?, schedule_weekday = ?, schedule_hour = ?,
                 condition_pql = ?, max_per_minute = ?, updated_at = ? WHERE id = ?`,
            )
            .bind(b.name, b.description, b.enabled, b.scope, b.scopeValue, b.trigger, b.triggerValue, b.weekday, b.hour, b.pql, b.max, c.now, id),
      db.prepare("DELETE FROM automation_actions WHERE rule_id = ?").bind(id),
      ...b.actions.map((a, i) =>
        db.prepare("INSERT INTO automation_actions (id, rule_id, position, kind, field, value, value2) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(newToken().slice(0, 16), id, i + 1, a.kind, a.field ?? null, a.value ?? null, a.value2 ?? null),
      ),
    ]);
  };

  if (path === "/api/automation/rules" && method === "POST") {
    const b = await checkRule(c, await body<Partial<AutomationRule>>(req));
    const id = newToken().slice(0, 16);
    await save(id, b, true);
    const [after] = (await loadRules(db, "id = ?", [id])).map((l) => l.rule);
    await c.audit("automation_rule_created", null, summary(after));
    return json(after, 201);
  }

  let m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const [before] = await loadRules(db, "id = ?", [m[1]]);
    if (!before) throw new HttpError(404, "Rule not found");
    if (method === "DELETE") {
      await db.prepare("DELETE FROM automation_rules WHERE id = ?").bind(before.rule.id).run();
      await c.audit("automation_rule_deleted", null, summary(before.rule));
      return json({ ok: true });
    }
    const b = await checkRule(c, await body<Partial<AutomationRule>>(req));
    await save(before.rule.id, b, false);
    const [after] = (await loadRules(db, "id = ?", [before.rule.id])).map((l) => l.rule);
    await c.audit("automation_rule_updated", null, { name: after.name, from: summary(before.rule), to: summary(after) });
    return json(after);
  }

  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})\/runs$/);
  if (m && method === "GET") {
    const q = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 50));
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const rows = await db
      .prepare("SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT ? OFFSET ?")
      .bind(m[1], limit, offset)
      .all<{ id: number; at: string; trigger_event: string; item_key: string | null; status: AutomationRun["status"]; message: string; touched: string; depth: number }>();
    return json(
      rows.results.map(
        (r): AutomationRun => ({
          id: Number(r.id),
          at: r.at,
          triggerEvent: r.trigger_event,
          ...(r.item_key ? { itemKey: r.item_key } : {}),
          status: r.status,
          message: r.message,
          touched: r.touched ? r.touched.split(",") : [],
          depth: Number(r.depth),
        }),
      ),
    );
  }

  // Runs a rule now: a scheduled or sprint rule on everything its condition picks, any other on one item.
  m = path.match(/^\/api\/automation\/rules\/([a-z0-9-]{4,40})\/run$/);
  if (m && method === "POST") {
    const [l] = await loadRules(db, "id = ?", [m[1]]);
    if (!l) throw new HttpError(404, "Rule not found");
    const b = await body<{ itemKey?: unknown }>(req).catch(() => ({}) as { itemKey?: unknown });
    const bulk = ["schedule", "sprint_started", "sprint_completed"].includes(l.rule.trigger);
    if (!bulk && !b.itemKey) throw new HttpError(400, "Say which work item to run it on");
    await runNow(env, l, "run by hand", bulk ? undefined : String(b.itemKey));
    await c.audit("automation_rule_run", null, { name: l.rule.name, ...(b.itemKey ? { key: String(b.itemKey).toUpperCase() } : {}) });
    const [run] = (await db.prepare("SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY id DESC LIMIT 1").bind(l.rule.id).all<{ status: string; message: string; touched: string }>()).results;
    return json({ status: run?.status, message: run?.message, touched: run?.touched ? run.touched.split(",") : [] });
  }

  throw new HttpError(404, "Not found");
}

/** Ask Pulse, for people who manage automation: each rule and how it last went. */
export async function askAutomationLines(db: D1Database): Promise<string[]> {
  const rules = await loadRules(db);
  if (!rules.length) return [];
  return [
    "",
    "AUTOMATION RULES (name | on or off | when | condition | actions | last run)",
    ...rules.map(({ rule: r }) =>
      [r.name, r.enabled ? "on" : "off", TRIGGERS[r.trigger].label, r.conditionPql || "-", r.actions.map((a) => ACTIONS[a.kind]).join(", "), r.lastRunAt ? `${r.lastRunAt.slice(0, 16)} (${r.lastStatus ?? "?"})` : "never"]
        .map((x) => String(x).replace(/\|/g, "/"))
        .join(" | "),
    ),
  ];
}
