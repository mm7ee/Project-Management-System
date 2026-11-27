/** @import { AutomationAction, Trigger } from './search' */
// The automation rule builder's parts, shared by the Worker (which evaluates and runs rules) and the screens (which
// build them, and preview smart values): condition groups, smart values ({{item.key}} …), schedules in the
// organisation's time zone, working days, and the preset rules. Everything here is pure, so it's unit tested
// (tests/automationEval.test.js).

/**
 * @typedef {{ field: ConditionField; op: ConditionOp; value?: string | number | null }} Condition
 * @typedef {{ op: "and" | "or"; items: (Condition | ConditionGroup)[] }} ConditionGroup
 * @typedef {"type" | "priority" | "status" | "statusCategory" | "assignee" | "assigneeRole" | "reporter" | "label" | "summary" | "description" | "component" | "dueDate" | "storyPoints" | "custom"} ConditionField
 * @typedef {"is" | "isNot" | "contains" | "notContains" | "isEmpty" | "isNotEmpty" | "within" | "before" | "after" | "gt" | "lt"} ConditionOp
 *
 * @typedef {Object} TriggerConfig
 * @property {number} [hours]     due_soon: this many hours before the due date
 * @property {"day" | "weekday" | "week" | "month"} [every]  schedule
 * @property {number} [weekday]   schedule, every week: 1 Monday … 7 Sunday
 * @property {number} [day]       schedule, every month: day 1 … 28
 * @property {string} [time]      schedule: "08:00", in the organisation's time zone
 *
 * @typedef {Object} EvalItem  what conditions look at
 * @property {string} type          the item type's id (CAMPAIGN, or a kind)
 * @property {string} kind          EPIC, STORY …
 * @property {string} priority
 * @property {string} status        a status id
 * @property {string} statusName
 * @property {string} statusCategory
 * @property {string | null} assignee
 * @property {string | null} assigneeRole
 * @property {string} reporter
 * @property {string[]} labels
 * @property {string} summary
 * @property {string} description
 * @property {string | null} component
 * @property {string | null} dueDate   YYYY-MM-DD
 * @property {number | null} storyPoints
 * @property {Record<string, string | number | boolean | string[] | null>} custom  by field id: values; select: labels
 */

/** The fields a condition can test, with the operators each allows and what its value is. */
/** @type {Record<ConditionField, { label: string; ops: ConditionOp[]; value: "type" | "priority" | "status" | "category" | "user" | "role" | "text" | "date" | "number" | "custom" }>} */
export const CONDITION_FIELDS = {
  type: { label: "Item type", ops: ["is", "isNot"], value: "type" },
  priority: { label: "Priority", ops: ["is", "isNot"], value: "priority" },
  status: { label: "Status", ops: ["is", "isNot"], value: "status" },
  statusCategory: { label: "Status category", ops: ["is", "isNot"], value: "category" },
  assignee: { label: "Assignee", ops: ["is", "isNot", "isEmpty", "isNotEmpty"], value: "user" },
  assigneeRole: { label: "Assignee's role", ops: ["is", "isNot"], value: "role" },
  reporter: { label: "Reporter", ops: ["is", "isNot"], value: "user" },
  label: { label: "Label", ops: ["contains", "notContains", "isEmpty", "isNotEmpty"], value: "text" },
  summary: { label: "Summary", ops: ["contains", "notContains"], value: "text" },
  description: { label: "Description", ops: ["contains", "notContains", "isEmpty", "isNotEmpty"], value: "text" },
  component: { label: "Component", ops: ["is", "isNot", "isEmpty", "isNotEmpty"], value: "text" },
  dueDate: { label: "Due date", ops: ["isEmpty", "isNotEmpty", "within", "before", "after"], value: "date" },
  storyPoints: { label: "Story points", ops: ["isEmpty", "isNotEmpty", "gt", "lt", "is"], value: "number" },
  custom: { label: "A custom field", ops: ["is", "isNot", "contains", "isEmpty", "isNotEmpty", "gt", "lt"], value: "custom" },
};
/** @type {Record<ConditionOp, string>} */ export const CONDITION_OPS = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  isEmpty: "is empty",
  isNotEmpty: "isn't empty",
  within: "is within (days)",
  before: "is before",
  after: "is after",
  gt: "is more than",
  lt: "is less than",
};
const NO_VALUE = /** @type {ConditionOp[]} */ (["isEmpty", "isNotEmpty"]);
export const MAX_CONDITIONS = 25;
export const MAX_GROUP_DEPTH = 3;

/**
 * Checks a condition group's shape (as sent by a client): known fields and operators, values where needed, at most
 * MAX_CONDITIONS conditions and MAX_GROUP_DEPTH levels. Returns the cleaned group, or throws a message.
 * @param {unknown} raw
 * @returns {ConditionGroup | null}
 */
export function cleanConditions(raw) {
  if (raw === null || raw === undefined) return null;
  let count = 0;
  /** @param {unknown} g @param {number} depth @returns {ConditionGroup} */
  const group = (g, depth) => {
    const x = /** @type {Record<string, unknown>} */ (g && typeof g === "object" ? g : {});
    if (x.op !== "and" && x.op !== "or") throw new Error("A condition group is AND or OR");
    if (!Array.isArray(x.items)) throw new Error("A condition group needs its conditions");
    if (depth > MAX_GROUP_DEPTH) throw new Error(`Groups go ${MAX_GROUP_DEPTH} levels deep at most`);
    return {
      op: x.op,
      items: x.items.map((it) => {
        const c = /** @type {Record<string, unknown>} */ (it && typeof it === "object" ? it : {});
        if ("items" in c) return group(c, depth + 1);
        count += 1;
        if (count > MAX_CONDITIONS) throw new Error(`Up to ${MAX_CONDITIONS} conditions`);
        const field = /** @type {ConditionField} */ (c.field);
        const def = CONDITION_FIELDS[field];
        if (!def) throw new Error(`Unknown condition field "${String(c.field)}"`);
        const op = /** @type {ConditionOp} */ (c.op);
        if (!def.ops.includes(op)) throw new Error(`"${CONDITION_OPS[op] ?? c.op}" doesn't apply to ${def.label.toLowerCase()}`);
        const needsValue = !NO_VALUE.includes(op);
        const value = c.value === undefined || c.value === null || c.value === "" ? null : typeof c.value === "number" ? c.value : String(c.value).slice(0, 200);
        if (needsValue && value === null) throw new Error(`${def.label} ${CONDITION_OPS[op]}: give a value`);
        if ((op === "within" || op === "gt" || op === "lt") && !Number.isFinite(Number(value))) throw new Error(`${def.label} ${CONDITION_OPS[op]}: give a number`);
        if (field === "custom" && !c.fieldId) throw new Error("Choose the custom field");
        return /** @type {Condition} */ ({ field, op, ...(needsValue ? { value } : {}), ...(field === "custom" ? { fieldId: String(c.fieldId).slice(0, 40) } : {}) });
      }),
    };
  };
  return group(raw, 1);
}

/**
 * Evaluates conditions against an item. Returns whether the group holds, and each condition's result in reading
 * order (for the run log and the test dialog).
 * @param {ConditionGroup | null | undefined} g
 * @param {EvalItem} item
 * @param {{ now: number; today: string; userName?: (id: string) => string; me?: string }} ctx  today: YYYY-MM-DD in the organisation's time zone
 * @returns {{ result: boolean; details: { label: string; result: boolean }[] }}
 */
export function evaluateConditions(g, item, ctx) {
  /** @type {{ label: string; result: boolean }[]} */ const details = [];
  if (!g || !g.items.length) return { result: true, details };
  /** @param {ConditionGroup} grp @returns {boolean} */
  const run = (grp) => {
    // Every condition is evaluated (no short cut), so the log shows each one.
    const results = grp.items.map((it) => ("items" in it ? run(it) : one(/** @type {Condition & { fieldId?: string }} */ (it))));
    return grp.op === "and" ? results.every(Boolean) : results.some(Boolean);
  };
  /** @param {Condition & { fieldId?: string }} c */
  const one = (c) => {
    const v = c.value;
    const name = (/** @type {string | null} */ id) => (id ? (ctx.userName?.(id) ?? id) : "nobody");
    /** @type {unknown} */ let actual;
    switch (c.field) {
      case "type":
        actual = item.type;
        break;
      case "priority":
        actual = item.priority;
        break;
      case "status":
        actual = [item.status, item.statusName];
        break;
      case "statusCategory":
        actual = item.statusCategory;
        break;
      case "assignee":
        actual = item.assignee;
        break;
      case "assigneeRole":
        actual = item.assigneeRole;
        break;
      case "reporter":
        actual = item.reporter;
        break;
      case "label":
        actual = item.labels;
        break;
      case "summary":
        actual = item.summary;
        break;
      case "description":
        actual = item.description;
        break;
      case "component":
        actual = item.component;
        break;
      case "dueDate":
        actual = item.dueDate;
        break;
      case "storyPoints":
        actual = item.storyPoints;
        break;
      case "custom":
        actual = item.custom[c.fieldId ?? ""] ?? null;
        break;
    }
    const empty = actual === null || actual === undefined || actual === "" || (Array.isArray(actual) && !actual.length);
    const lc = (/** @type {unknown} */ x) => String(x ?? "").toLowerCase();
    const want = v === "me" && ctx.me ? ctx.me : v;
    /** @type {boolean} */ let result;
    switch (c.op) {
      case "isEmpty":
        result = empty;
        break;
      case "isNotEmpty":
        result = !empty;
        break;
      case "is":
      case "isNot": {
        const hit = Array.isArray(actual) ? actual.some((a) => lc(a) === lc(want)) : typeof actual === "boolean" ? actual === /^(yes|true|1)$/i.test(String(want)) : typeof actual === "number" ? actual === Number(want) : lc(actual) === lc(want);
        result = c.op === "is" ? hit : !hit;
        break;
      }
      case "contains":
      case "notContains": {
        const hit = Array.isArray(actual) ? actual.some((a) => lc(a).includes(lc(want))) : lc(actual).includes(lc(want));
        result = c.op === "contains" ? hit : !hit;
        break;
      }
      case "within": {
        // Due within N days from today (today counts; already past also counts, so overdue items aren't missed).
        if (empty) result = false;
        else result = String(actual) <= addDays(ctx.today, Number(want));
        break;
      }
      case "before":
        result = !empty && String(actual) < String(want);
        break;
      case "after":
        result = !empty && String(actual) > String(want);
        break;
      case "gt":
        result = !empty && Number(actual) > Number(want);
        break;
      case "lt":
        result = !empty && Number(actual) < Number(want);
        break;
      default:
        result = false;
    }
    const shown = c.field === "assignee" || c.field === "reporter" ? name(/** @type {string | null} */ (want ?? null)) : (want ?? "");
    details.push({ label: `${c.field === "custom" ? "Custom field" : CONDITION_FIELDS[c.field].label} ${CONDITION_OPS[c.op]}${NO_VALUE.includes(c.op) ? "" : ` ${shown}`}`, result });
    return result;
  };
  return { result: run(g), details };
}

/**
 * A date a number of days after another (YYYY-MM-DD, calendar days).
 * @param {string} day
 * @param {number} n
 */
export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/**
 * N working days after a day, by the organisation's working days (ISO weekdays, 1 Monday).
 * @param {string} day  YYYY-MM-DD
 * @param {number} n
 * @param {number[]} workDays
 * @returns {string}
 */
export function addWorkingDays(day, n, workDays) {
  const days = workDays.length ? workDays : [1, 2, 3, 4, 5];
  let d = day;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    const iso = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (days.includes(iso)) left -= 1;
  }
  return d;
}
/**
 * The local date and time in a time zone.
 * @param {number} at  milliseconds
 * @param {string} timeZone
 * @returns {{ day: string; time: string; weekday: number; date: number }}  weekday: 1 Monday … 7 Sunday
 */
export function localTime(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday, date: Number(parts.day) };
}
/**
 * Whether a schedule is due at `at`, and the occasion it's for (so it fires once). Due once its time has come that
 * day; the cron runs every few minutes, so a rule for 08:00 fires at the first run at or after 08:00.
 * @param {TriggerConfig} cfg
 * @param {number} at
 * @param {string} timeZone
 * @returns {string | null}  the occasion (the local day), or null if not due today
 */
export function scheduleOccasion(cfg, at, timeZone) {
  const t = localTime(at, timeZone);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(cfg.time ?? "") ? /** @type {string} */ (cfg.time) : "08:00";
  if (t.time < time) return null;
  const every = cfg.every ?? "day";
  if (every === "weekday" && t.weekday > 5) return null;
  if (every === "week" && t.weekday !== (cfg.weekday ?? 1)) return null;
  if (every === "month" && t.date !== (cfg.day ?? 1)) return null;
  return t.day;
}
/** In words: "Every Monday at 08:00". @param {TriggerConfig} cfg */
export function describeSchedule(cfg) {
  const time = cfg.time ?? "08:00";
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  if (cfg.every === "weekday") return `Every working day (Monday to Friday) at ${time}`;
  if (cfg.every === "week") return `Every ${days[(cfg.weekday ?? 1) - 1]} at ${time}`;
  if (cfg.every === "month") return `On day ${cfg.day ?? 1} of every month at ${time}`;
  return `Every day at ${time}`;
}

/**
 * Smart values: {{item.key}}, {{item.title}}, {{workspace.name}} … (and the older {key}, {summary} …). Unknown
 * placeholders are left as they are. `mode` escapes what's put in: plain text as it is; html for emails (so an item
 * title can't inject markup); json for webhook payloads (so it can't break the JSON).
 * @param {string} template
 * @param {Record<string, string | number | null | undefined>} values  by dotted name, such as "item.key"
 * @param {"text" | "html" | "json"} [mode="text"]
 * @returns {string}
 */
export function renderTemplate(template, values, mode = "text") {
  const esc = /** @param {string} s */ (s) =>
    mode === "html"
      ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
      : mode === "json"
        ? JSON.stringify(s).slice(1, -1)
        : s;
  const legacy = /** @type {Record<string, string>} */ ({ key: "item.key", summary: "item.title", status: "item.status", priority: "item.priority", assignee: "item.assignee.name", project: "project.name" });
  return String(template)
    .replace(/\{\{\s*([a-zA-Z][\w.]{0,60})\s*\}\}/g, (all, name) => (name in values ? esc(String(values[name] ?? "")) : all))
    .replace(/\{(key|summary|status|priority|assignee|project)\}/g, (all, name) => (legacy[name] in values ? esc(String(values[legacy[name]] ?? "")) : all));
}

/** The kinds of chat message a rule can send, through a provider adapter (worker/messaging.js). */
export const MESSAGE_CHANNELS = /** @type {const} */ (["whatsapp", "sms"]);

/**
 * Ready-made rules, editable once added (they're added switched off). Names of statuses and roles are matched in
 * the workspace when the preset is added; a status the workspace's workflow lacks is reported then.
 * @typedef {Object} Preset
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} for     which workspaces it suits
 * @property {Trigger} trigger
 * @property {string} [triggerValue]   a status name, or a field
 * @property {TriggerConfig} [triggerConfig]
 * @property {ConditionGroup | null} conditions
 * @property {(Omit<AutomationAction, "id">)[]} actions   transition values are status names
 */
/** @type {Preset[]} */ export const PRESETS = [
  {
    id: "critical-bug",
    name: "Critical bug: on-call developer, highest priority, tell the admins",
    description: 'When a bug is created with Severity "Critical", assign it to the next developer in turn, set its priority to Highest and notify the workspace\'s administrators.',
    for: "Software Development",
    trigger: "item_created",
    conditions: {
      op: "and",
      items: [
        { field: "type", op: "is", value: "BUG" },
        /** @type {Condition} */ ({ field: "custom", op: "is", value: "Critical", fieldId: "@Severity" }),
      ],
    },
    actions: [
      { kind: "assign", value: "round_robin:role:developer" },
      { kind: "set_field", field: "priority", value: "HIGHEST" },
      { kind: "notify", field: "role:admin", value: "Critical bug {{item.key}}: {{item.title}}", value2: "bell,email" },
    ],
  },
  {
    id: "subtasks-done-review",
    name: "All sub-tasks done: move the story to Code Review",
    description: "When the last sub-task of a story is done, the story moves to Code Review.",
    for: "Software Development",
    trigger: "subtasks_done",
    conditions: { op: "and", items: [{ field: "type", op: "is", value: "STORY" }] },
    actions: [{ kind: "transition", value: "Code Review" }],
  },
  {
    id: "content-review",
    name: "Content in Internal Review: Marketing Lead, due in 2 working days",
    description: "When a content piece moves to Internal Review, assign it to the team leader and set it due two working days later.",
    for: "Marketing",
    trigger: "item_transitioned",
    triggerValue: "Internal Review",
    conditions: { op: "and", items: [{ field: "type", op: "is", value: "CONTENT" }] },
    actions: [
      { kind: "assign", value: "role:team_lead" },
      { kind: "set_field", field: "dueDate", value: "+2wd" },
    ],
  },
  {
    id: "approved-scheduled",
    name: "Approved: schedule it and tell its owner",
    description: "When an item reaches Client/Manager Approval and is approved (moved on), move it to Scheduled and notify whoever reported it.",
    for: "Marketing",
    trigger: "item_transitioned",
    triggerValue: "Approved",
    conditions: null,
    actions: [
      { kind: "transition", value: "Scheduled" },
      { kind: "notify", field: "reporter", value: "{{item.title}} is approved and scheduled", value2: "bell,email" },
    ],
  },
  {
    id: "weekly-social",
    name: "Every Monday at 08:00: the weekly social media plan",
    description: 'Creates a "Weekly social media plan" task every Monday morning, in a project you choose.',
    for: "Marketing",
    trigger: "schedule",
    triggerConfig: { every: "week", weekday: 1, time: "08:00" },
    conditions: null,
    actions: [{ kind: "create_item", value: JSON.stringify({ itemType: "TASK", summary: "Weekly social media plan for the week of {{today}}" }) }],
  },
  {
    id: "due-tomorrow",
    name: "24 hours before the due date: remind the assignee",
    description: "A day before an item is due, if it isn't done, notify its assignee.",
    for: "All workspaces",
    trigger: "due_soon",
    triggerConfig: { hours: 24 },
    conditions: { op: "and", items: [{ field: "statusCategory", op: "isNot", value: "DONE" }] },
    actions: [{ kind: "notify", field: "assignee", value: "{{item.key}} is due {{item.dueDate}}: {{item.title}}", value2: "bell,email" }],
  },
  {
    id: "overdue-admin",
    name: "Due date passed: tell the workspace's administrators",
    description: "When an item's due date has passed and it isn't done, notify the workspace's administrators.",
    for: "All workspaces",
    trigger: "due_passed",
    conditions: { op: "and", items: [{ field: "statusCategory", op: "isNot", value: "DONE" }] },
    actions: [{ kind: "notify", field: "role:admin", value: "Overdue: {{item.key}} {{item.title}} (due {{item.dueDate}})", value2: "bell" }],
  },
];
