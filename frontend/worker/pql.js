/** @import { FieldDef, Node, Op, Query, Value } from '../src/data/pql' */
/** @import { StatusCategory } from '../src/data/workitems' */
// PQL → parameterised SQL. The syntax tree (src/data/pql.ts) is turned into SQL from a fixed set of
// fragments, one per field and operator; every value a person typed goes in as a `?` parameter, never
// into the SQL text. Values are checked against what exists (statuses, people, projects, sprints,
// epics) so a typo is reported where it is, with a suggestion. The caller adds the visibility rule.
//
// Tables are aliased as in worker/workitems.ts: w = work_items, st = work_statuses, s = systems.
import { PqlError, didYouMean, relativeDate, weekBounds } from "../src/data/pql";
import { TYPE_META, WORK_PRIORITIES } from "../src/data/workitems";
import { workspacesRow } from "./settings";
const PRIORITY_RANK = `(CASE w.priority WHEN 'HIGHEST' THEN 5 WHEN 'HIGH' THEN 4 WHEN 'MEDIUM' THEN 3 WHEN 'LOW' THEN 2 ELSE 1 END)`;
/** @type {Record<string, number>} */ const RANK = { HIGHEST: 5, HIGH: 4, MEDIUM: 3, LOW: 2, LOWEST: 1 };
/** @type {Record<string, string>} */ const TYPE_ALIASES = { epic: "EPIC", story: "STORY", task: "TASK", bug: "BUG", "sub-task": "SUBTASK", subtask: "SUBTASK" };
/** @type {Record<string, StatusCategory>} */ const CATEGORY_ALIASES = { "to do": "TODO", todo: "TODO", "in progress": "IN_PROGRESS", inprogress: "IN_PROGRESS", in_progress: "IN_PROGRESS", done: "DONE" };
/** @type {Record<string, string>} */ const RESOLUTION_ALIASES = { done: "DONE", "won't do": "WONT_DO", "wont do": "WONT_DO", wont_do: "WONT_DO", "won't_do": "WONT_DO" };
/** @type {Record<string, string>} */ const SOURCE_ALIASES = {
  "client request": "client_request",
  client_request: "client_request",
  client: "client_request",
  internal: "internal",
  "service desk": "service_desk",
  service_desk: "service_desk",
};
/** @type {Record<Op, string>} */ const SQL_OP = { "=": "=", "!=": "<>", ">": ">", "<": "<", ">=": ">=", "<=": "<=", "~": "ILIKE", IN: "IN", "NOT IN": "NOT IN" };
/** @type {Record<string, { col: string; dateOnly: boolean }>} */ const DATE_COLUMN = {
  created: { col: "w.created_at", dateOnly: false },
  updated: { col: "w.updated_at", dateOnly: false },
  due: { col: "w.due_date", dateOnly: true },
  resolved: { col: "w.resolved_at", dateOnly: false },
};
/** @type {Record<string, string>} */ const ORDER = {
  project: "s.key",
  key: "s.key, w.number",
  type: "CASE w.type WHEN 'EPIC' THEN 0 WHEN 'STORY' THEN 1 WHEN 'TASK' THEN 2 WHEN 'BUG' THEN 3 ELSE 4 END",
  status: "CASE st.category WHEN 'TODO' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, st.position",
  priority: PRIORITY_RANK,
  assignee: "(SELECT u.name FROM users u WHERE u.id = w.assignee)",
  reporter: "(SELECT u.name FROM users u WHERE u.id = w.reporter)",
  component: "lower(w.component)",
  summary: "lower(w.summary)",
  created: "w.created_at",
  updated: "w.updated_at",
  due: "w.due_date",
  resolved: "w.resolved_at",
  storyPoints: "w.story_points",
};
const like =
  /** @param {string} v
   * @returns {string}
   */ (v) => `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const fail =
  /**
   * @param {string} msg
   * @param {{ start: number; end: number }} v
   * @returns {never}
   */ (msg, v) => {
    throw new PqlError(msg, v.start, v.end);
  };
const hint =
  /** @param {string} word
   * @param {string[]} options
   * @returns {string}
   */ (word, options) => {
    const m = didYouMean(word, options);
    return m ? ` — did you mean '${m}'?` : "";
  };
const textOf =
  /**
   * @param {Value} v
   * @param {FieldDef} field
   * @returns {string}
   */ (v, field) => (v.type === "text" ? v.value : v.type === "number" ? String(v.value) : fail(`${field.name} needs a value here, not ${v.type === "func" ? `${v.name}()` : v.value}`, v));
/**
 * Turns a parsed query into SQL and its parameters. Throws PqlError for values that don't exist.
 * @param {Query} q
 * @param {Lookup} lk
 * @returns {Compiled}
 */
export function compile(q, lk) {
  /** @type {unknown[]} */ const params = [];
  const p = /** @param {unknown} v */ (v) => {
    params.push(v);
    return "?";
  };
  const list = /** @param {unknown[]} vals */ (vals) => `(${vals.map(p).join(", ")})`;
  /** A comparison of one column with one or more already-resolved values. */
  const cmp = /** @param {string} col @param {Op} op @param {unknown[]} vals */ (col, op, vals) => (op === "IN" || op === "NOT IN" ? `${col} ${SQL_OP[op]} ${list(vals)}` : `${col} ${SQL_OP[op]} ${p(vals[0])}`);
  const resolve = /** @param {FieldDef} field @param {Value} v @returns {unknown} */ (field, v) => {
    switch (field.name) {
      case "project": {
        const key = textOf(v, field).toUpperCase();
        if (!lk.projectKeys.includes(key)) fail(`Unknown project '${textOf(v, field)}'${hint(key, lk.projectKeys)}`, v);
        return key;
      }
      case "key":
        return textOf(v, field).toUpperCase();
      case "type": {
        const t = TYPE_ALIASES[textOf(v, field).toLowerCase()] ?? (textOf(v, field).toUpperCase() in TYPE_META ? textOf(v, field).toUpperCase() : null);
        if (!t)
          fail(
            `Unknown type '${textOf(v, field)}'${hint(
              textOf(v, field),
              Object.values(TYPE_META).map((m) => m.label),
            )}`,
            v,
          );
        return t;
      }
      case "status": {
        const name = textOf(v, field);
        const s = lk.statuses.find((x) => x.name.toLowerCase() === name.toLowerCase() || x.id === name.toUpperCase());
        if (!s)
          fail(
            `Unknown status '${name}'${hint(
              name,
              lk.statuses.map((x) => x.name),
            )}`,
            v,
          );
        return /** @type {NonNullable<typeof s>} */ (s).id;
      }
      case "statusCategory": {
        const c = CATEGORY_ALIASES[textOf(v, field).toLowerCase()];
        if (!c) fail(`Unknown status category '${textOf(v, field)}': use "To Do", "In Progress" or Done`, v);
        return c;
      }
      case "priority": {
        const pr = textOf(v, field).toUpperCase();
        if (!WORK_PRIORITIES.includes(/** @type {never} */ (pr))) fail(`Unknown priority '${textOf(v, field)}'${hint(pr, ["Highest", "High", "Medium", "Low", "Lowest"])}`, v);
        return pr;
      }
      case "assignee":
      case "reporter": {
        if (v.type === "func") return lk.meId;
        const name = textOf(v, field).toLowerCase();
        const u = lk.users.find((x) => x.username.toLowerCase() === name || x.id.toLowerCase() === name || x.name.toLowerCase() === name);
        if (!u)
          fail(
            `Unknown person '${textOf(v, field)}'${hint(
              name,
              lk.users.map((x) => x.username),
            )}`,
            v,
          );
        return /** @type {NonNullable<typeof u>} */ (u).id;
      }
      case "resolution": {
        const r = RESOLUTION_ALIASES[textOf(v, field).toLowerCase()];
        if (!r) fail(`Unknown resolution '${textOf(v, field)}': use Done or "Won't do"`, v);
        return r;
      }
      case "source": {
        const s = SOURCE_ALIASES[textOf(v, field).toLowerCase()];
        if (!s) fail(`Unknown source '${textOf(v, field)}': use "client request", "service desk" or internal`, v);
        return s;
      }
      case "workspace": {
        const w = lk.workspaces.find((x) => x.toLowerCase() === textOf(v, field).toLowerCase());
        if (!w) fail(`Unknown workspace '${textOf(v, field)}'${hint(textOf(v, field), lk.workspaces)}`, v);
        return w;
      }
      case "storyPoints":
        return v.type === "number" ? v.value : fail("storyPoints needs a number", v);
      default:
        return textOf(v, field);
    }
  };
  /** A date value as the column compares it: a timestamp, or a date for date-only columns and plain dates. */
  const dateValue = /** @param {Value} v @param {boolean} dateOnly @returns {{ value: string; day: boolean }} */ (v, dateOnly) => {
    if (v.type === "reldate") {
      const iso = relativeDate(v.value, lk.now);
      return dateOnly ? { value: iso.slice(0, 10), day: true } : { value: iso, day: false };
    }
    if (v.type === "func") {
      const iso = v.name === "now" ? new Date(lk.now).toISOString() : v.name === "startOfWeek" ? weekBounds(lk.now).start : weekBounds(lk.now).end;
      return dateOnly ? { value: iso.slice(0, 10), day: true } : { value: iso, day: false };
    }
    const t = v.type === "text" ? v.value : String(v.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) fail(`'${t}' isn't a date: use 2026-11-01, -7d, 2w or now()`, v);
    return { value: t, day: true };
  };
  /** A custom field: a match among its value rows. "!=" and NOT IN, as elsewhere, don't match empty. */
  const customClause = /** @param {Extract<Node, { type: "clause" }>} n @returns {string} */ (n) => {
    const f = n.field;
    const cf = /** @type {NonNullable<typeof f.custom>} */ (f.custom);
    const neg = n.op === "!=" || n.op === "NOT IN";
    /** @type {Op} */ const op = n.op === "!=" ? "=" : n.op === "NOT IN" ? "IN" : n.op;
    // Built in reading order, so the parameters line up with their placeholders.
    const cond = /** @returns {string} */ () => {
      switch (cf.kind) {
        case "text":
        case "textarea":
        case "url":
          return op === "~" ? `v.value_text ILIKE ${p(like(textOf(n.values[0], f)))}` : `lower(v.value_text) = lower(${p(textOf(n.values[0], f))})`;
        case "checkbox": {
          const t = textOf(n.values[0], f).toLowerCase();
          if (!/^(yes|no|true|false)$/.test(t)) fail(`${f.name} is yes or no`, n.values[0]);
          return `v.value_number = ${p(t === "yes" || t === "true" ? 1 : 0)}`;
        }
        case "currency":
        case "number":
          return cmp(
            "v.value_number",
            op,
            n.values.map((v) => (v.type === "number" ? v.value : fail(`${f.name} needs a number`, v))),
          );
        case "date":
          return `v.value_date ${SQL_OP[op]} ${p(dateValue(n.values[0], true).value)}`;
        case "user":
          return cmp(
            "v.value_user",
            op,
            n.values.map((v) => resolve({ ...f, name: "assignee" }, v)),
          );
        default:
          return `v.option_id IN (SELECT o.id FROM custom_field_options o WHERE o.field_id IN ${list(cf.ids)} AND lower(o.label) IN ${list(n.values.map((v) => textOf(v, f).toLowerCase()))})`;
      }
    };
    const matches = () => `EXISTS (SELECT 1 FROM custom_field_values v WHERE v.item_id = w.id AND v.field_id IN ${list(cf.ids)} AND ${cond()})`;
    if (!neg) return matches();
    const any = `EXISTS (SELECT 1 FROM custom_field_values v WHERE v.item_id = w.id AND v.field_id IN ${list(cf.ids)})`;
    return `(${any} AND NOT ${matches()})`;
  };
  const clause = /** @param {Extract<Node, { type: "clause" }>} n @returns {string} */ (n) => {
    if (n.field.custom) return customClause(n);
    const f = n.field;
    const op = n.op;
    const neg = op === "!=" || op === "NOT IN";
    switch (f.kind) {
      case "date": {
        const { col, dateOnly } = DATE_COLUMN[f.name];
        const d = dateValue(n.values[0], dateOnly);
        // A plain date compares by day; a moment (-7d, now()) compares exactly.
        const left = d.day && !dateOnly ? `substr(${col}, 1, 10)` : col;
        return `${left} ${SQL_OP[op]} ${p(d.value)}`;
      }
      case "labels": {
        if (op === "~") return `EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label ILIKE ${p(like(textOf(n.values[0], f).toLowerCase()))})`;
        const vals = n.values.map((v) => textOf(v, f).toLowerCase());
        return `${neg ? "NOT " : ""}EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id AND l.label IN ${list(vals)})`;
      }
      case "sprint": {
        const v0 = n.values[0];
        if (v0.type === "func") {
          const sql = v0.name === "openSprints" ? "w.sprint_id IN (SELECT sp.id FROM sprints sp WHERE sp.state IN ('ACTIVE', 'FUTURE'))" : "EXISTS (SELECT 1 FROM sprint_items si JOIN sprints sp ON sp.id = si.sprint_id WHERE si.item_id = w.id AND sp.state = 'CLOSED')";
          return neg ? `NOT (${sql})` : sql;
        }
        const ids = n.values.flatMap((v) => {
          const name = textOf(v, f).toLowerCase();
          const found = lk.sprints.filter((s) => s.name.toLowerCase() === name);
          if (!found.length)
            fail(
              `Unknown sprint '${textOf(v, f)}'${hint(
                name,
                lk.sprints.map((s) => s.name),
              )}`,
              v,
            );
          return found.map((s) => s.id);
        });
        const sql = `EXISTS (SELECT 1 FROM sprint_items si WHERE si.item_id = w.id AND si.sprint_id IN ${list(ids)}) OR w.sprint_id IN ${list(ids)}`;
        return neg ? `NOT (${sql})` : `(${sql})`;
      }
      case "epic": {
        const ids = n.values.map((v) => {
          const key = textOf(v, f).toUpperCase();
          const id = lk.epics.get(key);
          if (!id) fail(`'${key}' isn't an epic`, v);
          return id;
        });
        const sql = `(w.parent_id IN ${list(ids)} OR w.parent_id IN (SELECT c.id FROM work_items c WHERE c.parent_id IN ${list(ids)}))`;
        return neg ? `NOT ${sql}` : sql;
      }
      case "number":
        return cmp(
          "w.story_points",
          op,
          n.values.map((v) => resolve(f, v)),
        );
      case "text": {
        if (f.name === "text") {
          const t = like(textOf(n.values[0], f));
          return `(w.summary ILIKE ${p(t)} OR w.description ILIKE ${p(t)} OR EXISTS (SELECT 1 FROM work_item_comments cm WHERE cm.item_id = w.id AND cm.body ILIKE ${p(t)}))`;
        }
        if (f.name === "summary" || f.name === "description") return `w.${f.name} ILIKE ${p(like(textOf(n.values[0], f)))}`;
        // component
        if (op === "~") return `w.component ILIKE ${p(like(textOf(n.values[0], f)))}`;
        return cmp(
          "lower(w.component)",
          op,
          n.values.map((v) => textOf(v, f).toLowerCase()),
        );
      }
      default: {
        const vals = n.values.map((v) => resolve(f, v));
        if (f.name === "priority" && [">", "<", ">=", "<="].includes(op)) return `${PRIORITY_RANK} ${SQL_OP[op]} ${p(RANK[/** @type {string} */ (vals[0])])}`;
        /** @type {Record<string, string>} */ const col = {
          project: "s.key",
          key: "(s.key || '-' || w.number)",
          type: "w.type",
          status: "w.status",
          statusCategory: "st.category",
          priority: "w.priority",
          assignee: "w.assignee",
          reporter: "w.reporter",
          resolution: "w.resolution",
          source: "w.source",
          workspace: "(s.data::json ->> 'workspace')",
        };
        return cmp(col[f.name], op, vals);
      }
    }
  };
  const empty = /** @param {Extract<Node, { type: "empty" }>} n @returns {string} */ (n) => {
    if (n.field.custom) {
      const has = `EXISTS (SELECT 1 FROM custom_field_values v WHERE v.item_id = w.id AND v.field_id IN ${list(n.field.custom.ids)})`;
      return n.negated ? has : `NOT ${has}`;
    }
    const f = n.field.name;
    /** @type {Record<string, string>} */ const sql = {
      assignee: "w.assignee IS NULL",
      labels: "NOT EXISTS (SELECT 1 FROM work_item_labels l WHERE l.item_id = w.id)",
      component: "(w.component IS NULL OR w.component = '')",
      description: "(w.description IS NULL OR w.description = '')",
      sprint: "w.sprint_id IS NULL",
      epic: "NOT EXISTS (SELECT 1 FROM work_items pe WHERE pe.id = w.parent_id AND (pe.type = 'EPIC' OR EXISTS (SELECT 1 FROM work_items ge WHERE ge.id = pe.parent_id AND ge.type = 'EPIC')))",
      due: "w.due_date IS NULL",
      resolved: "w.resolved_at IS NULL",
      resolution: "w.resolution IS NULL",
      storyPoints: "w.story_points IS NULL",
    };
    return n.negated ? `NOT (${sql[f]})` : sql[f];
  };
  const walk = /** @param {Node} n @returns {string} */ (n) => {
    if (n.type === "and" || n.type === "or") return `(${walk(n.left)} ${n.type.toUpperCase()} ${walk(n.right)})`;
    if (n.type === "not") return `NOT (${walk(n.expr)})`;
    if (n.type === "empty") return empty(n);
    return clause(/** @type {Extract<Node, { type: "clause" }>} */ (n));
  };
  const where = q.where ? walk(q.where) : "TRUE";
  const orderBy = q.orderBy.length
    ? q.orderBy
        .map((o) =>
          ORDER[o.field.name]
            .split(", ")
            .map((part) => `${part} ${o.dir} NULLS LAST`)
            .join(", "),
        )
        .join(", ")
    : "w.updated_at DESC";
  return { where, params, orderBy: `${orderBy}, s.key, w.number` };
}
/**
 * The epic keys a query mentions, so only those need looking up.
 * @param {Query} q
 * @returns {string[]}
 */
export function epicKeys(q) {
  /** @type {string[]} */ const out = [];
  const walk = /** @param {Node | null} n */ (n) => {
    if (!n) return;
    if (n.type === "and" || n.type === "or") {
      walk(n.left);
      walk(n.right);
    } else if (n.type === "not") walk(n.expr);
    else if (n.type === "clause" && n.field.name === "epic") for (const v of n.values) if (v.type === "text") out.push(v.value.toUpperCase());
  };
  walk(q.where);
  return out;
}
/**
 * Everything a query's values are checked against.
 * @param {D1Database} db
 * @param {Query} q
 * @param {string} meId
 * @param {number} now
 * @returns {Promise<Lookup>}
 */
export async function loadLookup(db, q, meId, now) {
  const keys = epicKeys(q);
  const [statuses, users, projects, sprints, ws, epics] = await Promise.all([
    /** @type {Promise<D1Result<{ id: string; name: string; category: StatusCategory; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, category FROM work_statuses").all())),
    /** @type {Promise<D1Result<{ id: string; username: string; name: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, username, name FROM users").all())),
    /** @type {Promise<D1Result<{ key: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT key FROM systems").all())),
    /** @type {Promise<D1Result<{ id: string; name: string; state: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, state FROM sprints").all())),
    /** @type {Promise<{ value: string; } | null>} */ (/** @type {unknown} */ (workspacesRow(db))),
    keys.length
      ? /** @type {Promise<D1Result<{ id: string; k: string; }>>} */ (
          /** @type {unknown} */ (
            db
              .prepare(`SELECT w.id, s.key || '-' || w.number AS k FROM work_items w JOIN systems s ON s.id = w.system_id WHERE w.type = 'EPIC' AND (s.key || '-' || w.number) IN (${keys.map(() => "?").join(", ")})`)
              .bind(...keys)
              .all()
          )
        )
      : Promise.resolve({ results: /** @type {{ id: string; k: string }[]} */ ([]) }),
  ]);
  return {
    meId,
    now,
    statuses: statuses.results,
    users: users.results,
    projectKeys: projects.results.map((r) => r.key),
    sprints: sprints.results,
    workspaces: ws ? /** @type {string[]} */ (JSON.parse(ws.value)) : ["Projects", "HR"],
    epics: new Map(epics.results.map((e) => [e.k, e.id])),
  };
}
/**
 * What a query's values are checked against: loaded from the database by `loadLookup`, or given by tests.
 * @typedef {Object} Lookup
 * @property {string} meId
 * @property {number} now
 * @property {{ id: string; name: string; category: StatusCategory }[]} statuses
 * @property {{ id: string; username: string; name: string }[]} users
 * @property {string[]} projectKeys
 * @property {{ id: string; name: string; state: string }[]} sprints
 * @property {string[]} workspaces
 * @property {Map<string, string>} epics
 */
/**
 * @typedef {Object} Compiled
 * @property {string} where
 * @property {unknown[]} params
 * @property {string} orderBy
 */
