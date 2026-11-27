// PMS Query Language (PQL): a safe, JQL-style filter for work items. This file turns text into a
// syntax tree (tokenizer → parser) and is shared by the Worker, which turns the tree into parameterised
// SQL (worker/pql.ts), and the Search page, which uses the field list and the tokenizer to suggest what
// comes next. Nothing here ever builds SQL from text.
//
//   project = INFRA AND status != Done AND assignee = currentUser()
//   priority = High AND due < now() AND resolution IS EMPTY
//   sprint IN openSprints() AND type = Bug
//   updated >= -7d ORDER BY priority DESC
/** @extends Error */
export class PqlError extends Error {
  /**
   * @param {string} message
   * @param {number} start
   * @param {number} end
   */
  constructor(message, start, end) {
    super(message);
    this.start = start;
    this.end = end;
  }
}
/** @type {Op[]} */ const EQ = ["=", "!=", "IN", "NOT IN"];
/** @type {Op[]} */ const CMP = ["=", "!=", ">", "<", ">=", "<=", "IN", "NOT IN"];
/** @type {FieldDef[]} */ export const FIELDS = [
  { name: "project", kind: "key", description: "Project key, such as INFRA", ops: EQ, empty: false, sortable: true },
  { name: "key", kind: "key", description: "Work item key, such as INFRA-12", ops: EQ, empty: false, sortable: true },
  { name: "type", kind: "enum", description: "Epic, Story, Task, Bug or Sub-task", ops: EQ, empty: false, sortable: true },
  { name: "status", kind: "enum", description: "Status name, such as Done", ops: EQ, empty: false, sortable: true },
  { name: "statusCategory", kind: "enum", description: '"To Do", "In Progress" or Done', ops: EQ, empty: false, sortable: false },
  { name: "priority", kind: "enum", description: "Highest, High, Medium, Low or Lowest; < and > compare", ops: CMP, empty: false, sortable: true },
  { name: "assignee", kind: "user", description: "Username, or currentUser()", ops: EQ, empty: true, sortable: true },
  { name: "reporter", kind: "user", description: "Username, or currentUser()", ops: EQ, empty: false, sortable: true },
  { name: "labels", kind: "labels", description: "A label; ~ matches part of one", ops: ["=", "!=", "IN", "NOT IN", "~"], empty: true, sortable: false },
  { name: "component", kind: "text", description: "Component; ~ matches part of it", ops: ["=", "!=", "IN", "NOT IN", "~"], empty: true, sortable: true },
  { name: "sprint", kind: "sprint", description: "Sprint name, openSprints() or closedSprints()", ops: EQ, empty: true, sortable: false },
  { name: "epic", kind: "epic", description: "The epic's key (its items and their sub-tasks)", ops: EQ, empty: true, sortable: false },
  { name: "created", kind: "date", description: "When it was created", ops: CMP.filter((o) => o !== "IN" && o !== "NOT IN"), empty: false, sortable: true },
  { name: "updated", kind: "date", description: "When it last changed", ops: CMP.filter((o) => o !== "IN" && o !== "NOT IN"), empty: false, sortable: true },
  { name: "due", kind: "date", description: "Its due date", ops: CMP.filter((o) => o !== "IN" && o !== "NOT IN"), empty: true, sortable: true },
  { name: "resolved", kind: "date", description: "When it was resolved", ops: CMP.filter((o) => o !== "IN" && o !== "NOT IN"), empty: true, sortable: true },
  { name: "resolution", kind: "enum", description: 'Done or "Won\'t do"', ops: EQ, empty: true, sortable: false },
  { name: "storyPoints", kind: "number", description: "Story points", ops: CMP, empty: true, sortable: true },
  { name: "source", kind: "enum", description: '"client request", "service desk" or internal', ops: EQ, empty: false, sortable: false },
  { name: "workspace", kind: "enum", description: "The project's workspace", ops: EQ, empty: false, sortable: false },
  { name: "text", kind: "text", description: "Summary, description and comments; use ~", ops: ["~"], empty: false, sortable: false },
  { name: "summary", kind: "text", description: "The summary; use ~", ops: ["~"], empty: false, sortable: true },
  { name: "description", kind: "text", description: "The description; use ~", ops: ["~"], empty: true, sortable: false },
];
export const FIELD_BY_NAME = new Map(FIELDS.map((f) => [f.name.toLowerCase(), f]));
/**
 * Custom fields as PQL fields. A name with spaces is written in quotes: "Customer tier" = Gold.
 * @param {{ name: string; kind: NonNullable<FieldDef["custom"]>["kind"]; ids: string[] }[]} list
 * @returns {FieldDef[]}
 */
export function customFieldDefs(list) {
  return list
    .filter((c) => !FIELD_BY_NAME.has(c.name.toLowerCase()))
    .map(
      /** @returns {FieldDef} */ (c) => {
        const base = { name: c.name, empty: true, sortable: false, custom: { ids: c.ids, kind: c.kind } };
        if (c.kind === "number" || c.kind === "currency") return { ...base, kind: "number", ops: CMP, description: c.kind === "currency" ? "A custom money field (the amount)" : "A custom number field" };
        if (c.kind === "checkbox") return { ...base, kind: "text", ops: ["=", "!="], description: "A custom checkbox: yes or no" };
        if (c.kind === "textarea" || c.kind === "url") return { ...base, kind: "text", ops: ["=", "!=", "~"], description: c.kind === "url" ? "A custom link field; ~ matches part of it" : "A custom long text field; ~ matches part of it" };
        if (c.kind === "date") return { ...base, kind: "date", ops: CMP.filter((o) => o !== "IN" && o !== "NOT IN"), description: "A custom date field" };
        if (c.kind === "user") return { ...base, kind: "user", ops: EQ, description: "A custom person field: a username, or currentUser()" };
        if (c.kind === "text") return { ...base, kind: "text", ops: ["=", "!=", "~"], description: "A custom text field; ~ matches part of it" };
        return { ...base, kind: "enum", ops: EQ, description: c.kind === "multiselect" ? "A custom multi-select field: any chosen value matches" : "A custom select field" };
      },
    );
}
/** @type {{ name: string; description: string; kinds: FieldKind[]; list?: boolean }[]} */ export const FUNCTIONS = [
  { name: "currentUser", description: "You", kinds: ["user"] },
  { name: "openSprints", description: "Sprints running or planned", kinds: ["sprint"], list: true },
  { name: "closedSprints", description: "Finished sprints", kinds: ["sprint"], list: true },
  { name: "now", description: "This moment", kinds: ["date"] },
  { name: "startOfWeek", description: "Monday, 00:00", kinds: ["date"] },
  { name: "endOfWeek", description: "Sunday, 23:59", kinds: ["date"] },
];
const FUNCTION_BY_NAME = new Map(FUNCTIONS.map((f) => [f.name.toLowerCase(), f]));
export const KEYWORDS = ["AND", "OR", "NOT", "IN", "IS", "EMPTY", "NULL", "ORDER", "BY", "ASC", "DESC"];
/**
 * Splits PQL into tokens, with their positions so errors can point at them.
 * @param {string} text
 * @returns {Token[]}
 */
export function tokenize(text) {
  /** @type {Token[]} */ const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    if (ch === '"' || ch === "'") {
      let value = "";
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        value += text[i++];
      }
      if (i >= text.length) throw new PqlError("This text isn't closed: add a matching quote", start, text.length);
      i++;
      out.push({ type: "string", value, start, end: i });
      continue;
    }
    if (ch === "(") {
      out.push({ type: "lparen", value: "(", start, end: ++i });
      continue;
    }
    if (ch === ")") {
      out.push({ type: "rparen", value: ")", start, end: ++i });
      continue;
    }
    if (ch === ",") {
      out.push({ type: "comma", value: ",", start, end: ++i });
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "!=" || two === ">=" || two === "<=") {
      i += 2;
      out.push({ type: "op", value: two, start, end: i });
      continue;
    }
    if (ch === "=" || ch === ">" || ch === "<" || ch === "~") {
      out.push({ type: "op", value: ch, start, end: ++i });
      continue;
    }
    // Relative dates (-7d, 2w, +1m) and numbers (3, 2.5).
    const rel = /^[-+]?\d+(?:\.\d+)?[dwmyh]\b/i.exec(text.slice(i));
    if (rel) {
      i += rel[0].length;
      out.push({ type: "reldate", value: rel[0].toLowerCase(), start, end: i });
      continue;
    }
    const num = /^-?\d+(?:\.\d+)?(?![\w-])/.exec(text.slice(i));
    if (num) {
      i += num[0].length;
      out.push({ type: "number", value: num[0], start, end: i });
      continue;
    }
    // Words: field names, keywords, unquoted values (INFRA, High, INFRA-12, 2026-11-01, qa.dev).
    const word = /^[A-Za-z0-9_][A-Za-z0-9_.\-@]*/.exec(text.slice(i));
    if (word) {
      i += word[0].length;
      out.push({ type: "word", value: word[0], start, end: i });
      continue;
    }
    throw new PqlError(`"${ch}" isn't understood here`, start, start + 1);
  }
  return out;
}
/**
 * Edit distance, for "did you mean".
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/**
 * The closest of `options` to `word`, if it's close enough to be a likely typo.
 * @param {string} word
 * @param {string[]} options
 * @returns {string | null}
 */
export function didYouMean(word, options) {
  const w = word.toLowerCase();
  /** @type {string | null} */ let best = null;
  let score = Infinity;
  for (const o of options) {
    const d = distance(w, o.toLowerCase());
    if (d < score) {
      score = d;
      best = o;
    }
  }
  return best !== null && score <= Math.max(2, Math.floor(w.length / 3)) ? best : null;
}
const suggest =
  /** @param {string} word
   * @param {string[]} options
   * @returns {string}
   */ (word, options) => {
    const m = didYouMean(word, options);
    return m ? ` — did you mean '${m}'?` : "";
  };
/**
 * Parses PQL into a syntax tree. Throws PqlError with the position of the problem.
 * @param {string} text
 * @param {FieldDef[]} [custom=[]]
 * @returns {Query}
 */
export function parse(text, custom = []) {
  const tokens = tokenize(text);
  const byName = custom.length ? new Map([...FIELD_BY_NAME, ...custom.map(/** @returns {[string, FieldDef]} */ (f) => [f.name.toLowerCase(), f])]) : FIELD_BY_NAME;
  const names = [...FIELDS, ...custom].map((f) => f.name);
  let pos = 0;
  const peek = () => tokens[pos];
  const isWord = /** @param {Token | undefined} t @param {string} w */ (t, w) => !!t && t.type === "word" && t.value.toUpperCase() === w;
  const end = () => (tokens.length ? tokens[tokens.length - 1].end : 0);
  const expectWord = /** @param {string} w */ (w) => {
    const t = peek();
    if (!isWord(t, w)) throw new PqlError(`Expected ${w} here`, t?.start ?? end(), t?.end ?? end() + 1);
    pos++;
  };
  const value = /** @param {FieldDef} field @returns {Value} */ (field) => {
    const t = peek();
    if (!t) throw new PqlError(`A value is needed after ${field.name}`, end(), end() + 1);
    if (t.type === "string") {
      pos++;
      return { type: "text", value: t.value, start: t.start, end: t.end };
    }
    if (t.type === "number") {
      pos++;
      return { type: "number", value: Number(t.value), start: t.start, end: t.end };
    }
    if (t.type === "reldate") {
      pos++;
      if (field.kind !== "date") throw new PqlError(`${t.value} is a relative date; ${field.name} isn't a date`, t.start, t.end);
      return { type: "reldate", value: t.value, start: t.start, end: t.end };
    }
    if (t.type === "word") {
      if (KEYWORDS.includes(t.value.toUpperCase()) && !["NULL"].includes(t.value.toUpperCase())) {
        throw new PqlError(`A value is needed here, not ${t.value.toUpperCase()}`, t.start, t.end);
      }
      pos++;
      if (peek()?.type === "lparen") {
        pos++;
        const close = peek();
        if (close?.type !== "rparen") throw new PqlError(`${t.value}() takes nothing between its brackets`, close?.start ?? t.end, close?.end ?? t.end + 1);
        pos++;
        const fn = FUNCTION_BY_NAME.get(t.value.toLowerCase());
        if (!fn)
          throw new PqlError(
            `Unknown function '${t.value}()'${suggest(
              t.value,
              FUNCTIONS.map((f) => f.name),
            )}`,
            t.start,
            close.end,
          );
        if (!fn.kinds.includes(field.kind)) throw new PqlError(`${fn.name}() can't be used with ${field.name}`, t.start, close.end);
        return { type: "func", name: fn.name, start: t.start, end: close.end };
      }
      return { type: "text", value: t.value, start: t.start, end: t.end };
    }
    throw new PqlError(`A value is needed here`, t.start, t.end);
  };
  const clause = /** @returns {Node} */ () => {
    const t = peek();
    if (!t) throw new PqlError("A condition is needed here, such as status = Done", end(), end() + 1);
    if (t.type !== "word" && t.type !== "string") throw new PqlError("A field name is needed here, such as status or assignee", t.start, t.end);
    const field = byName.get(t.value.toLowerCase());
    if (!field) throw new PqlError(`Unknown field '${t.value}'${suggest(t.value, names)}`, t.start, t.end);
    pos++;
    const o = peek();
    if (!o) throw new PqlError(`An operator is needed after ${field.name}, such as = or IN`, end(), end() + 1);
    // IS [NOT] EMPTY
    if (isWord(o, "IS")) {
      pos++;
      const negated = isWord(peek(), "NOT");
      if (negated) pos++;
      const e = peek();
      if (!isWord(e, "EMPTY") && !isWord(e, "NULL")) throw new PqlError("Expected EMPTY here", e?.start ?? end(), e?.end ?? end() + 1);
      pos++;
      if (!field.empty) throw new PqlError(`${field.name} always has a value, so it can't be EMPTY`, t.start, /** @type {NonNullable<typeof e>} */ (e).end);
      return { type: "empty", field, negated, start: t.start, end: /** @type {NonNullable<typeof e>} */ (e).end };
    }
    /** @type {Op} */ let op;
    if (isWord(o, "NOT") && isWord(tokens[pos + 1], "IN")) {
      pos += 2;
      op = "NOT IN";
    } else if (isWord(o, "IN")) {
      pos++;
      op = "IN";
    } else if (o.type === "op") {
      pos++;
      op = /** @type {Op} */ (o.value);
    } else {
      throw new PqlError(`Expected an operator after ${field.name}, such as = != IN or ~`, o.start, o.end);
    }
    if (!field.ops.includes(op)) {
      throw new PqlError(`${field.name} can't use ${op}. It takes ${field.ops.join(" ")}${field.empty ? " and IS EMPTY" : ""}`, o.start, o.end);
    }
    /** @type {Value[]} */ const values = [];
    if (op === "IN" || op === "NOT IN") {
      const open = peek();
      // sprint IN openSprints() needs no brackets of its own.
      if (open?.type === "word" && field.kind === "sprint") {
        values.push(value(field));
      } else {
        if (open?.type !== "lparen") throw new PqlError(`${op} needs a list in brackets, such as (High, Highest)`, open?.start ?? end(), open?.end ?? end() + 1);
        pos++;
        for (;;) {
          values.push(value(field));
          const sep = peek();
          if (sep?.type === "comma") {
            pos++;
            continue;
          }
          if (sep?.type === "rparen") {
            pos++;
            break;
          }
          throw new PqlError("Expected , or ) here", sep?.start ?? end(), sep?.end ?? end() + 1);
        }
      }
    } else {
      values.push(value(field));
      if (op === "~" && values[0].type !== "text") throw new PqlError("~ needs some text to look for", values[0].start, values[0].end);
    }
    return { type: "clause", field, op, values, start: t.start, end: values[values.length - 1].end };
  };
  const primary = /** @returns {Node} */ () => {
    const t = peek();
    if (t?.type === "lparen") {
      pos++;
      const inner = or();
      const close = peek();
      if (close?.type !== "rparen") throw new PqlError("This bracket isn't closed: add a )", t.start, t.end);
      pos++;
      return inner;
    }
    if (isWord(t, "NOT")) {
      pos++;
      return { type: "not", expr: primary() };
    }
    return clause();
  };
  const and = /** @returns {Node} */ () => {
    let left = primary();
    while (isWord(peek(), "AND")) {
      pos++;
      left = { type: "and", left, right: primary() };
    }
    return left;
  };
  const or = /** @returns {Node} */ () => {
    let left = and();
    while (isWord(peek(), "OR")) {
      pos++;
      left = { type: "or", left, right: and() };
    }
    return left;
  };
  /** @type {Node | null} */ let where = null;
  if (tokens.length && !isWord(peek(), "ORDER")) where = or();
  /** @type {OrderBy[]} */ const orderBy = [];
  if (isWord(peek(), "ORDER")) {
    pos++;
    expectWord("BY");
    for (;;) {
      const t = peek();
      if (!t || t.type !== "word") throw new PqlError("A field to sort by is needed here", t?.start ?? end(), t?.end ?? end() + 1);
      const field = FIELD_BY_NAME.get(t.value.toLowerCase());
      if (!field)
        throw new PqlError(
          `Unknown field '${t.value}'${suggest(
            t.value,
            FIELDS.filter((f) => f.sortable).map((f) => f.name),
          )}`,
          t.start,
          t.end,
        );
      if (!field.sortable) throw new PqlError(`Results can't be sorted by ${field.name}`, t.start, t.end);
      pos++;
      /** @type {"ASC" | "DESC"} */ let dir = "ASC";
      if (isWord(peek(), "ASC") || isWord(peek(), "DESC")) dir = /** @type {"ASC" | "DESC"} */ (/** @type {Token} */ (peek()).value.toUpperCase());
      if (isWord(peek(), "ASC") || isWord(peek(), "DESC")) pos++;
      orderBy.push({ field, dir });
      if (peek()?.type === "comma") {
        pos++;
        continue;
      }
      break;
    }
  }
  const extra = peek();
  if (extra) {
    const hint = extra.type === "word" && FIELD_BY_NAME.has(extra.value.toLowerCase()) ? " Join conditions with AND or OR." : "";
    throw new PqlError(`"${extra.value}" isn't expected here.${hint}`, extra.start, extra.end);
  }
  return { where, orderBy };
}
// ---------- dates ----------
/**
 * A relative date (-7d, 2w, +1m, -3h, 1y) from `now`, as an ISO timestamp.
 * @param {string} rel
 * @param {number} now
 * @returns {string}
 */
export function relativeDate(rel, now) {
  const m = /** @type {RegExpExecArray} */ (/^([-+]?\d+(?:\.\d+)?)([dwmyh])$/.exec(rel));
  const n = Number(m[1]);
  const unit = m[2];
  const d = new Date(now);
  if (unit === "h") d.setTime(d.getTime() + n * 3600000);
  if (unit === "d") d.setTime(d.getTime() + n * 86400000);
  if (unit === "w") d.setTime(d.getTime() + n * 7 * 86400000);
  if (unit === "m") d.setUTCMonth(d.getUTCMonth() + n);
  if (unit === "y") d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString();
}
/**
 * Monday 00:00 and Sunday 23:59:59 of `now`'s week, in Harare time (UTC+2), as ISO timestamps.
 * @param {number} now
 * @returns {{ start: string; end: string }}
 */
export function weekBounds(now) {
  const local = new Date(now + 2 * 3600000);
  const weekday = (local.getUTCDay() + 6) % 7;
  const monday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - weekday) - 2 * 3600000;
  return { start: new Date(monday).toISOString(), end: new Date(monday + 7 * 86400000 - 1000).toISOString() };
}
/**
 * What could come next at `cursor`: fields, operators, values or keywords. `values` supplies the
 * known values per field (statuses, usernames, project keys…).
 * @param {string} text
 * @param {number} cursor
 * @param {Partial<Record<string, string[]>>} values
 * @param {FieldDef[]} [custom=[]]
 * @returns {{ from: number; to: number; items: Suggestion[] }}
 */
export function suggestAt(text, cursor, values, custom = []) {
  const all = [...FIELDS, ...custom];
  const byName = new Map(all.map((f) => [f.name.toLowerCase(), f]));
  const before = text.slice(0, cursor);
  const partial = /** @type {RegExpExecArray} */ (/[A-Za-z0-9_.\-@"']*$/.exec(before))[0];
  const from = cursor - partial.length;
  /** @type {Token[]} */ let tokens = [];
  try {
    tokens = tokenize(text.slice(0, from));
  } catch {
    return { from, to: cursor, items: [] };
  }
  const word = partial.replace(/^["']/, "").toLowerCase();
  const quote = /** @param {string} v */ (v) => (/^[A-Za-z0-9_.\-@]+$/.test(v) && !KEYWORDS.includes(v.toUpperCase()) ? v : `"${v.replace(/"/g, '\\"')}"`);
  const matching = /** @param {Suggestion[]} items */ (items) => items.filter((s) => s.label.toLowerCase().startsWith(word) || (word.length > 1 && s.label.toLowerCase().includes(word))).slice(0, 12);
  const last = tokens[tokens.length - 1];
  const prev = tokens[tokens.length - 2];
  const fieldItems = () => all.map((f) => ({ label: f.name, insert: `${quote(f.name)} `, detail: f.description }));
  // After a field: its operators.
  if ((last?.type === "word" || last?.type === "string") && byName.has(last.value.toLowerCase()) && !(prev?.type === "op") && !(prev && /^(IN)$/i.test(prev.value))) {
    const f = /** @type {FieldDef} */ (byName.get(last.value.toLowerCase()));
    const ops = [
      ...f.ops.map((o) => ({ label: o, insert: `${o} ` })),
      ...(f.empty
        ? [
            { label: "IS EMPTY", insert: "IS EMPTY " },
            { label: "IS NOT EMPTY", insert: "IS NOT EMPTY " },
          ]
        : []),
    ];
    if (last.value.toLowerCase() !== "order") return { from, to: cursor, items: matching(ops) };
  }
  // After an operator (or inside an IN list): values for the field before it.
  let opIndex = -1;
  for (let k = tokens.length - 1; k >= 0; k--) {
    if (tokens[k].type === "op" || (tokens[k].type === "word" && /^IN$/i.test(tokens[k].value))) {
      opIndex = k;
      break;
    }
  }
  const inList = opIndex >= 0 && tokens.slice(opIndex + 1).every((t) => t.type !== "rparen") && tokens.slice(opIndex + 1).some((t) => t.type === "lparen");
  if (opIndex >= 0 && (opIndex === tokens.length - 1 || inList || (tokens[tokens.length - 1].type === "lparen" && opIndex === tokens.length - 2))) {
    let fi = opIndex - 1;
    if (/^NOT$/i.test(tokens[fi]?.value ?? "")) fi--;
    const field = byName.get((tokens[fi]?.value ?? "").toLowerCase());
    if (field) {
      const fns = FUNCTIONS.filter((fn) => fn.kinds.includes(field.kind)).map((fn) => ({ label: `${fn.name}()`, insert: `${fn.name}() `, detail: fn.description }));
      const known = (values[field.name] ?? []).map((v) => ({ label: v, insert: `${quote(v)} ` }));
      const rel =
        field.kind === "date"
          ? [
              { label: "-7d", insert: "-7d ", detail: "7 days ago" },
              { label: "-1w", insert: "-1w ", detail: "a week ago" },
              { label: "2w", insert: "2w ", detail: "in two weeks" },
            ]
          : [];
      return { from, to: cursor, items: matching([...fns, ...known, ...rel]) };
    }
  }
  // After a complete condition: joiners and ORDER BY.
  if (last && (last.type === "rparen" || last.type === "string" || last.type === "number" || last.type === "reldate" || (last.type === "word" && !byName.has(last.value.toLowerCase()) && !KEYWORDS.includes(last.value.toUpperCase())) || /^(EMPTY|NULL|ASC|DESC)$/i.test(last.value))) {
    if (tokens.some((t) => /^ORDER$/i.test(t.value)))
      return {
        from,
        to: cursor,
        items: matching([
          { label: "ASC", insert: "ASC" },
          { label: "DESC", insert: "DESC" },
          { label: ",", insert: ", " },
        ]),
      };
    return {
      from,
      to: cursor,
      items: matching([
        { label: "AND", insert: "AND " },
        { label: "OR", insert: "OR " },
        { label: "ORDER BY", insert: "ORDER BY " },
      ]),
    };
  }
  if (last && /^BY$/i.test(last.value)) return { from, to: cursor, items: matching(FIELDS.filter((f) => f.sortable).map((f) => ({ label: f.name, insert: `${f.name} ` }))) };
  return { from, to: cursor, items: matching([...fieldItems(), { label: "NOT", insert: "NOT " }, { label: "(", insert: "(" }]) };
}
/**
 * Builds PQL from the Search page's basic mode. Values are quoted where they need to be.
 * @param {{ projects?: string[]; types?: string[]; statuses?: string[]; priorities?: string[]; assignee?: string; text?: string; open?: boolean }} b
 * @returns {string}
 */
export function basicToPql(b) {
  const q = /** @param {string} v */ (v) => (/^[A-Za-z0-9_.\-@]+$/.test(v) && !KEYWORDS.includes(v.toUpperCase()) ? v : `"${v.replace(/"/g, '\\"')}"`);
  const list = /** @param {string} field @param {string[]} [vals] */ (field, vals) => (vals?.length ? (vals.length === 1 ? `${field} = ${q(vals[0])}` : `${field} IN (${vals.map(q).join(", ")})`) : "");
  const parts = [
    list("project", b.projects),
    list("type", b.types),
    list("status", b.statuses),
    list("priority", b.priorities),
    b.assignee === "me" ? "assignee = currentUser()" : b.assignee === "none" ? "assignee IS EMPTY" : b.assignee ? `assignee = ${q(b.assignee)}` : "",
    b.open ? "statusCategory != Done" : "",
    b.text?.trim() ? `text ~ ${q(b.text.trim())}` : "",
  ].filter(Boolean);
  return parts.join(" AND ");
}
/** @typedef {"key" | "enum" | "user" | "text" | "date" | "number" | "labels" | "sprint" | "epic"} FieldKind */
/** @typedef {"=" | "!=" | ">" | "<" | ">=" | "<=" | "~" | "IN" | "NOT IN"} Op */
/** @typedef {"word" | "string" | "op" | "lparen" | "rparen" | "comma" | "reldate" | "number"} TokenType */
/**
 * @typedef {| { type: "text"; value: string; start: number; end: number }
 *   | { type: "number"; value: number; start: number; end: number }
 *   | { type: "reldate"; value: string; start: number; end: number }
 *   | { type: "func"; name: string; start: number; end: number }} Value
 */
/**
 * @typedef {| { type: "and" | "or"; left: Node; right: Node }
 *   | { type: "not"; expr: Node }
 *   | { type: "clause"; field: FieldDef; op: Op; values: Value[]; start: number; end: number }
 *   | { type: "empty"; field: FieldDef; negated: boolean; start: number; end: number }} Node
 */
/**
 * @typedef {Object} FieldDef
 * @property {string} name
 * @property {FieldKind} kind
 * @property {string} description
 * @property {Op[]} ops Operators it takes, besides IS [NOT] EMPTY where `empty` is true.
 * @property {boolean} empty
 * @property {boolean} sortable
 * @property {{ ids: string[]; kind: import("./admin").CustomFieldKind }} [custom] A custom field (Phase 5): its ids (one per workspace using the name) and its kind.
 */
/**
 * @typedef {Object} Token
 * @property {TokenType} type
 * @property {string} value
 * @property {number} start
 * @property {number} end
 */
/**
 * @typedef {Object} OrderBy
 * @property {FieldDef} field
 * @property {"ASC" | "DESC"} dir
 */
/**
 * @typedef {Object} Query
 * @property {Node | null} where
 * @property {OrderBy[]} orderBy
 */
/**
 * @typedef {Object} Suggestion
 * @property {string} label
 * @property {string} insert
 * @property {string} [detail]
 */
