// Custom fields per workspace: text, number, date, single select, multi select and person. Values are
// rows in custom_field_values (one per option for a multi select), so they can be searched (PQL),
// filtered, exported and shown on boards. Administrators with "manage_schemes" define them under
// Settings → Administration → Custom fields, and choose where each appears and whether it's required.

import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import type { ItemContext } from "./workitems";
import { CUSTOM_FIELD_KINDS, MAX_CUSTOM_FIELDS, MAX_FIELD_OPTIONS, type CustomField, type CustomFieldKind, type CustomFieldValue, type CustomValue } from "../src/data/admin";

interface FieldRow {
  id: string;
  workspace: string;
  name: string;
  kind: CustomFieldKind;
  description: string;
  required: number;
  on_create: number;
  on_edit: number;
  on_view: number;
  on_board: number;
  position: number;
}

export async function loadFields(db: D1Database, where = "TRUE", args: unknown[] = []): Promise<CustomField[]> {
  const [fields, options] = await Promise.all([
    db.prepare(`SELECT * FROM custom_fields WHERE ${where} ORDER BY workspace, position, lower(name)`).bind(...args).all<FieldRow>(),
    db.prepare("SELECT id, field_id, label FROM custom_field_options ORDER BY position, lower(label)").all<{ id: string; field_id: string; label: string }>(),
  ]);
  return fields.results.map((f) => ({
    id: f.id,
    workspace: f.workspace,
    name: f.name,
    kind: f.kind,
    description: f.description,
    required: !!f.required,
    onCreate: !!f.on_create,
    onEdit: !!f.on_edit,
    onView: !!f.on_view,
    onBoard: !!f.on_board,
    options: options.results.filter((o) => o.field_id === f.id).map((o) => ({ id: o.id, label: o.label })),
  }));
}

/** The custom fields of a project's workspace. */
export async function fieldsForSystem(db: D1Database, systemId: string): Promise<CustomField[]> {
  return loadFields(db, "workspace = (SELECT COALESCE(data::json ->> 'workspace', 'Projects') FROM systems WHERE id = ?)", [systemId]);
}

interface ValueRow {
  item_id: string;
  field_id: string;
  value_text: string | null;
  value_number: string | number | null;
  value_date: string | null;
  value_user: string | null;
  option_id: string | null;
}

/** Each item's custom field values, with display text. `onlyBoard`: just the fields shown on cards. */
export async function customValuesFor(db: D1Database, itemIds: string[], onlyBoard = false): Promise<Map<string, CustomFieldValue[]>> {
  const out = new Map<string, CustomFieldValue[]>();
  if (!itemIds.length) return out;
  const marks = itemIds.map(() => "?").join(", ");
  // Most items have no custom values: then one query is enough.
  const rows = await db.prepare(`SELECT v.* FROM custom_field_values v WHERE v.item_id IN (${marks}) ORDER BY v.id`).bind(...itemIds).all<ValueRow>();
  if (!rows.results.length) return out;
  const [fields, people] = await Promise.all([
    loadFields(db, onlyBoard ? "on_board = 1" : "TRUE"),
    rows.results.some((r) => r.value_user)
      ? db.prepare("SELECT id, name FROM users").all<{ id: string; name: string }>()
      : Promise.resolve({ results: [] as { id: string; name: string }[] }),
  ]);
  const fieldBy = new Map(fields.map((f) => [f.id, f]));
  const nameOf = new Map(people.results.map((p) => [p.id, p.name]));
  const grouped = new Map<string, Map<string, ValueRow[]>>();
  for (const r of rows.results) {
    if (!fieldBy.has(r.field_id)) continue;
    const byField = grouped.get(r.item_id) ?? new Map<string, ValueRow[]>();
    byField.set(r.field_id, [...(byField.get(r.field_id) ?? []), r]);
    grouped.set(r.item_id, byField);
  }
  for (const [itemId, byField] of grouped) {
    const values: CustomFieldValue[] = [];
    for (const f of fields) {
      const vs = byField.get(f.id);
      if (!vs?.length) continue;
      const v = vs[0];
      let value: CustomValue = null;
      let display = "";
      if (f.kind === "text") (value = v.value_text), (display = v.value_text ?? "");
      if (f.kind === "number") (value = v.value_number == null ? null : Number(v.value_number)), (display = value == null ? "" : String(value));
      if (f.kind === "date") (value = v.value_date), (display = v.value_date ?? "");
      if (f.kind === "user") (value = v.value_user), (display = v.value_user ? (nameOf.get(v.value_user) ?? "Former user") : "");
      if (f.kind === "select" || f.kind === "multiselect") {
        const ids = vs.map((x) => x.option_id).filter((x): x is string => !!x);
        value = f.kind === "select" ? (ids[0] ?? null) : ids;
        display = ids.map((id) => f.options.find((o) => o.id === id)?.label ?? "").filter(Boolean).join(", ");
      }
      values.push({ fieldId: f.id, name: f.name, kind: f.kind, value, display });
    }
    out.set(itemId, values);
  }
  return out;
}

/** One field's value from the API, checked, as the rows to store. Empty: no rows. */
async function rowsFor(c: ItemContext, f: CustomField, raw: unknown): Promise<Omit<ValueRow, "item_id" | "field_id">[]> {
  const empty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && !raw.length);
  if (empty) return [];
  const base = { value_text: null, value_number: null, value_date: null, value_user: null, option_id: null };
  switch (f.kind) {
    case "text": {
      const t = String(raw).trim();
      if (t.length > 500) throw new HttpError(400, `${f.name}: up to 500 characters`);
      return t ? [{ ...base, value_text: t }] : [];
    }
    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e12) throw new HttpError(400, `${f.name} must be a number`);
      return [{ ...base, value_number: Math.round(n * 100) / 100 }];
    }
    case "date": {
      const d = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw new HttpError(400, `${f.name} must be a date (YYYY-MM-DD)`);
      return [{ ...base, value_date: d }];
    }
    case "user": {
      const u = await c.db.prepare("SELECT id FROM users WHERE id = ?").bind(String(raw)).first<{ id: string }>();
      if (!u) throw new HttpError(400, `${f.name}: choose someone in Pulse`);
      return [{ ...base, value_user: u.id }];
    }
    case "select":
    case "multiselect": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map(String);
      if (f.kind === "select" && ids.length > 1) throw new HttpError(400, `${f.name}: choose one`);
      const bad = ids.find((id) => !f.options.some((o) => o.id === id));
      if (bad) throw new HttpError(400, `${f.name}: that isn't one of its choices`);
      return [...new Set(ids)].map((id) => ({ ...base, option_id: id }));
    }
  }
}

const display = (f: CustomField, rows: Omit<ValueRow, "item_id" | "field_id">[], names: Map<string, string>): string | null => {
  if (!rows.length) return null;
  const r = rows[0];
  if (f.kind === "text") return r.value_text;
  if (f.kind === "number") return r.value_number == null ? null : String(Number(r.value_number));
  if (f.kind === "date") return r.value_date;
  if (f.kind === "user") return r.value_user ? (names.get(r.value_user) ?? "Former user") : null;
  return rows.map((x) => f.options.find((o) => o.id === x.option_id)?.label ?? "").join(", ");
};

/**
 * The statements that store an item's custom fields, and the changes for the activity log (as
 * "field:<name>"). On create, every required field shown on the create form must be filled; on edit,
 * a required field can't be emptied, and fields not editable there can't be changed.
 */
export async function planCustomValues(c: ItemContext, itemId: string, systemId: string, input: unknown, mode: "create" | "edit") {
  const given = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const fields = await fieldsForSystem(c.db, systemId);
  const stmts: D1PreparedStatement[] = [];
  const changes: [string, unknown, unknown][] = [];
  if (!fields.length && !Object.keys(given).length) return { stmts, changes };
  const unknownId = Object.keys(given).find((id) => !fields.some((f) => f.id === id));
  if (unknownId) throw new HttpError(400, "That custom field isn't used in this project's workspace");
  const current = mode === "edit" ? await c.db.prepare("SELECT * FROM custom_field_values WHERE item_id = ?").bind(itemId).all<ValueRow>() : { results: [] as ValueRow[] };
  const names = fields.some((f) => f.kind === "user")
    ? new Map((await c.db.prepare("SELECT id, name FROM users").all<{ id: string; name: string }>()).results.map((u) => [u.id, u.name]))
    : new Map<string, string>();
  for (const f of fields) {
    const shown = mode === "create" ? f.onCreate : f.onEdit;
    const has = Object.prototype.hasOwnProperty.call(given, f.id);
    if (has && !shown) throw new HttpError(400, `${f.name} can't be set here`);
    if (mode === "create" && f.required && f.onCreate && !has) throw new HttpError(400, `${f.name} is required`);
    if (!has) continue;
    const next = await rowsFor(c, f, given[f.id]);
    if (f.required && !next.length) throw new HttpError(400, `${f.name} is required`);
    const before = current.results.filter((r) => r.field_id === f.id);
    const from = display(f, before, names);
    const to = display(f, next, names);
    if (from === to) continue;
    stmts.push(c.db.prepare("DELETE FROM custom_field_values WHERE item_id = ? AND field_id = ?").bind(itemId, f.id));
    for (const r of next) {
      stmts.push(
        c.db
          .prepare("INSERT INTO custom_field_values (item_id, field_id, value_text, value_number, value_date, value_user, option_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(itemId, f.id, r.value_text, r.value_number, r.value_date, r.value_user, r.option_id),
      );
    }
    changes.push([`field:${f.name}`, from, to]);
  }
  return { stmts, changes };
}

export async function saveCustomValues(c: ItemContext, itemId: string, systemId: string, input: unknown, mode: "create" | "edit") {
  const plan = await planCustomValues(c, itemId, systemId, input, mode);
  if (plan.stmts.length) await c.db.batch(plan.stmts);
  return plan.changes;
}

// ---------- administration ----------

function checkField(b: Record<string, unknown>) {
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "A custom field needs a name");
  const kind = String(b.kind) as CustomFieldKind;
  if (!(kind in CUSTOM_FIELD_KINDS)) throw new HttpError(400, "Choose the kind of field");
  const options = Array.isArray(b.options)
    ? b.options.map((o): { id?: unknown; label?: unknown } => (typeof o === "object" && o ? (o as { id?: unknown; label?: unknown }) : { label: o })).map((o) => ({ id: o.id ? String(o.id) : null, label: String(o.label ?? "").trim().slice(0, 60) }))
    : [];
  if (kind === "select" || kind === "multiselect") {
    if (!options.filter((o) => o.label).length) throw new HttpError(400, "A select field needs at least one choice");
    if (options.length > MAX_FIELD_OPTIONS) throw new HttpError(400, `Up to ${MAX_FIELD_OPTIONS} choices`);
    const labels = options.map((o) => o.label.toLowerCase()).filter(Boolean);
    if (new Set(labels).size !== labels.length) throw new HttpError(400, "Each choice must be different");
  }
  return {
    name,
    kind,
    description: String(b.description ?? "").trim().slice(0, 200),
    required: b.required ? 1 : 0,
    onCreate: b.onCreate === false ? 0 : 1,
    onEdit: b.onEdit === false ? 0 : 1,
    onView: b.onView === false ? 0 : 1,
    onBoard: b.onBoard ? 1 : 0,
    options: kind === "select" || kind === "multiselect" ? options.filter((o) => o.label) : [],
  };
}

export async function customFieldsApi(c: ItemContext, path: string, method: string): Promise<Response | null> {
  if (!path.startsWith("/api/custom-fields")) return null;
  const { db, req } = c;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  // Everyone signed in reads the definitions (forms and search need them); only "manage_schemes" changes them.
  if (path === "/api/custom-fields" && method === "GET") {
    const ws = new URL(req.url).searchParams.get("workspace");
    return json(ws ? await loadFields(db, "workspace = ?", [ws]) : await loadFields(db));
  }
  if (!c.can("manage_schemes")) throw new HttpError(403, "You don't have permission to manage custom fields");

  const saveOptions = (fieldId: string, options: { id: string | null; label: string }[], existing: string[]) => {
    const keep = new Set(options.map((o) => o.id).filter((x): x is string => !!x && existing.includes(x)));
    const stmts: D1PreparedStatement[] = existing.filter((id) => !keep.has(id)).map((id) => db.prepare("DELETE FROM custom_field_options WHERE id = ?").bind(id));
    options.forEach((o, i) => {
      if (o.id && keep.has(o.id)) stmts.push(db.prepare("UPDATE custom_field_options SET label = ?, position = ? WHERE id = ?").bind(o.label, i, o.id));
      else stmts.push(db.prepare("INSERT INTO custom_field_options (id, field_id, label, position) VALUES (?, ?, ?, ?)").bind(newToken().slice(0, 16), fieldId, o.label, i));
    });
    return stmts;
  };

  if (path === "/api/custom-fields" && method === "POST") {
    const b = await body<Record<string, unknown>>(req);
    const f = checkField(b);
    const workspace = String(b.workspace ?? "");
    const ws = await db.prepare("SELECT value FROM settings WHERE key = 'workspaces'").first<{ value: string }>();
    if (!(ws ? (JSON.parse(ws.value) as string[]) : ["Projects", "HR"]).includes(workspace)) throw new HttpError(400, "Choose the workspace");
    const count = await db.prepare("SELECT COUNT(*) AS n FROM custom_fields WHERE workspace = ?").bind(workspace).first<{ n: number }>();
    if (Number(count?.n ?? 0) >= MAX_CUSTOM_FIELDS) throw new HttpError(400, `Up to ${MAX_CUSTOM_FIELDS} custom fields per workspace`);
    if (await db.prepare("SELECT 1 FROM custom_fields WHERE workspace = ? AND lower(name) = lower(?)").bind(workspace, f.name).first()) {
      throw new HttpError(409, `${workspace} already has a field called ${f.name}`);
    }
    const id = newToken().slice(0, 16);
    await db.batch([
      db
        .prepare(
          `INSERT INTO custom_fields (id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM custom_fields WHERE workspace = ?), ?, ?)`,
        )
        .bind(id, workspace, f.name, f.kind, f.description, f.required, f.onCreate, f.onEdit, f.onView, f.onBoard, workspace, c.now, c.now),
      ...saveOptions(id, f.options, []),
    ]);
    await c.audit("custom_field_created", null, { field: f.name, workspace, kind: CUSTOM_FIELD_KINDS[f.kind], required: !!f.required, choices: f.options.map((o) => o.label) });
    return json((await loadFields(db, "id = ?", [id]))[0], 201);
  }

  const m = path.match(/^\/api\/custom-fields\/([a-z0-9-]{4,40})$/);
  if (m && (method === "PUT" || method === "DELETE")) {
    const [before] = await loadFields(db, "id = ?", [m[1]]);
    if (!before) throw new HttpError(404, "Custom field not found");
    if (method === "DELETE") {
      const used = await db.prepare("SELECT COUNT(DISTINCT item_id) AS n FROM custom_field_values WHERE field_id = ?").bind(before.id).first<{ n: number }>();
      await db.prepare("DELETE FROM custom_fields WHERE id = ?").bind(before.id).run();
      await c.audit("custom_field_deleted", null, { field: before.name, workspace: before.workspace, itemsWithValues: Number(used?.n ?? 0) });
      return json({ ok: true });
    }
    const f = checkField({ ...(await body<Record<string, unknown>>(req)) });
    if (f.kind !== before.kind) throw new HttpError(400, "A field's kind can't change; make a new field instead");
    if (f.name.toLowerCase() !== before.name.toLowerCase() && (await db.prepare("SELECT 1 FROM custom_fields WHERE workspace = ? AND lower(name) = lower(?)").bind(before.workspace, f.name).first())) {
      throw new HttpError(409, `${before.workspace} already has a field called ${f.name}`);
    }
    await db.batch([
      db
        .prepare("UPDATE custom_fields SET name = ?, description = ?, required = ?, on_create = ?, on_edit = ?, on_view = ?, on_board = ?, updated_at = ? WHERE id = ?")
        .bind(f.name, f.description, f.required, f.onCreate, f.onEdit, f.onView, f.onBoard, c.now, before.id),
      ...saveOptions(before.id, f.options, before.options.map((o) => o.id)),
    ]);
    const [after] = await loadFields(db, "id = ?", [before.id]);
    const summary = (x: CustomField) => ({ name: x.name, required: x.required, create: x.onCreate, edit: x.onEdit, view: x.onView, board: x.onBoard, choices: x.options.map((o) => o.label) });
    await c.audit("custom_field_updated", null, { field: after.name, workspace: after.workspace, from: summary(before), to: summary(after) });
    return json(after);
  }

  // Reordering within a workspace.
  if (path === "/api/custom-fields/order" && method === "PUT") {
    const ids = (await body<{ ids?: unknown }>(req)).ids;
    if (!Array.isArray(ids)) throw new HttpError(400, "Send the fields in order");
    await db.batch(ids.slice(0, 200).map((id, i) => db.prepare("UPDATE custom_fields SET position = ?, updated_at = ? WHERE id = ?").bind(i + 1, c.now, String(id))));
    return json({ ok: true });
  }

  throw new HttpError(404, "Not found");
}

/** For PQL: every custom field, by lower-case name (fields of the same name in several workspaces share it). */
export async function customFieldsByName(db: D1Database): Promise<Map<string, { ids: string[]; name: string; kind: CustomFieldKind }>> {
  const rows = await db.prepare("SELECT id, name, kind FROM custom_fields ORDER BY workspace, position").all<{ id: string; name: string; kind: CustomFieldKind }>();
  const out = new Map<string, { ids: string[]; name: string; kind: CustomFieldKind }>();
  for (const r of rows.results) {
    const k = r.name.toLowerCase();
    const prev = out.get(k);
    if (prev && prev.kind === r.kind) prev.ids.push(r.id);
    else if (!prev) out.set(k, { ids: [r.id], name: r.name, kind: r.kind });
  }
  return out;
}
