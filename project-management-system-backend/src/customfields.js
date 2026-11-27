/** @import { ItemContext } from './workitems' */
/** @import { CustomField, CustomFieldKind, CustomFieldValue, CustomValue } from '../../project-management-system-frontend/src/data/admin' */
// Custom fields per workspace: text, long text, number, money, date, single select, multi select, person, checkbox
// and link; a field can be for some item types only, and can have a default value. Values are
// rows in custom_field_values (one per option for a multi select), so they can be searched (PQL),
// filtered, exported and shown on boards. Administrators with "manage_schemes" define them under
// Settings → Administration → Custom fields, and choose where each appears and whether it's required.
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { CURRENCIES, CUSTOM_FIELD_KINDS, MAX_CUSTOM_FIELDS, MAX_FIELD_OPTIONS } from "../../project-management-system-frontend/src/data/admin";
import { workspacesRow } from "./settings";
/**
 * @param {D1Database} db
 * @param {string} [where="TRUE"]
 * @param {unknown[]} [args=[]]
 * @returns {Promise<CustomField[]>}
 */
export async function loadFields(db, where = "TRUE", args = []) {
  const [fields, options] = await Promise.all([
    /** @type {Promise<D1Result<FieldRow>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT * FROM custom_fields WHERE ${where} ORDER BY workspace, position, lower(name)`)
          .bind(...args)
          .all()
      )
    ),
    /** @type {Promise<D1Result<{ id: string; field_id: string; label: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, field_id, label FROM custom_field_options ORDER BY position, lower(label)").all())),
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
    defaultValue: f.default_value ?? null,
    itemTypes: f.item_types ? /** @type {string[]} */ (JSON.parse(f.item_types)) : null,
    ...(f.currency ? { currency: f.currency } : {}),
    options: options.results.filter((o) => o.field_id === f.id).map((o) => ({ id: o.id, label: o.label })),
  }));
}
/**
 * The custom fields of a project's workspace.
 * @param {D1Database} db
 * @param {string} systemId
 * @returns {Promise<CustomField[]>}
 */
export async function fieldsForSystem(db, systemId) {
  return loadFields(db, "workspace = (SELECT COALESCE(data::json ->> 'workspace', 'Projects') FROM systems WHERE id = ?)", [systemId]);
}
/**
 * Each item's custom field values, with display text. `onlyBoard`: just the fields shown on cards.
 * @param {D1Database} db
 * @param {string[]} itemIds
 * @param {boolean} [onlyBoard=false]
 * @returns {Promise<Map<string, CustomFieldValue[]>>}
 */
export async function customValuesFor(db, itemIds, onlyBoard = false) {
  const out = /** @type {Map<string, Array<CustomFieldValue>>} */ (/** @type {unknown} */ (new Map()));
  if (!itemIds.length) return out;
  const marks = itemIds.map(() => "?").join(", ");
  // Most items have no custom values: then one query is enough.
  const rows = await /** @type {Promise<D1Result<ValueRow>>} */ (
    /** @type {unknown} */ (
      db
        .prepare(`SELECT v.* FROM custom_field_values v WHERE v.item_id IN (${marks}) ORDER BY v.id`)
        .bind(...itemIds)
        .all()
    )
  );
  if (!rows.results.length) return out;
  const [fields, people] = await Promise.all([
    loadFields(db, onlyBoard ? "on_board = 1" : "TRUE"),
    rows.results.some((r) => r.value_user) ? /** @type {Promise<D1Result<{ id: string; name: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name FROM users").all())) : Promise.resolve({ results: /** @type {{ id: string; name: string }[]} */ ([]) }),
  ]);
  const fieldBy = new Map(fields.map((f) => [f.id, f]));
  const nameOf = new Map(people.results.map((p) => [p.id, p.name]));
  const grouped = /** @type {Map<string, Map<string, Array<ValueRow>>>} */ (/** @type {unknown} */ (new Map()));
  for (const r of rows.results) {
    if (!fieldBy.has(r.field_id)) continue;
    const byField = grouped.get(r.item_id) ?? /** @type {Map<string, Array<ValueRow>>} */ (/** @type {unknown} */ (new Map()));
    byField.set(r.field_id, [...(byField.get(r.field_id) ?? []), r]);
    grouped.set(r.item_id, byField);
  }
  for (const [itemId, byField] of grouped) {
    /** @type {CustomFieldValue[]} */ const values = [];
    for (const f of fields) {
      const vs = byField.get(f.id);
      if (!vs?.length) continue;
      const v = vs[0];
      /** @type {CustomValue} */ let value = null;
      let display = "";
      if (f.kind === "text" || f.kind === "textarea" || f.kind === "url") ((value = v.value_text), (display = v.value_text ?? ""));
      if (f.kind === "number") ((value = v.value_number == null ? null : Number(v.value_number)), (display = value == null ? "" : String(value)));
      if (f.kind === "currency") ((value = v.value_number == null ? null : Number(v.value_number)), (display = value == null ? "" : money(Number(value), f.currency)));
      if (f.kind === "checkbox") ((value = Number(v.value_number) === 1), (display = value ? "Yes" : "No"));
      if (f.kind === "date") ((value = v.value_date), (display = v.value_date ?? ""));
      if (f.kind === "user") ((value = v.value_user), (display = v.value_user ? (nameOf.get(v.value_user) ?? "Former user") : ""));
      if (f.kind === "select" || f.kind === "multiselect") {
        const ids = vs.map((x) => x.option_id).filter(/** @returns {x is string} */ (x) => !!x);
        value = f.kind === "select" ? (ids[0] ?? null) : ids;
        display = ids
          .map((id) => f.options.find((o) => o.id === id)?.label ?? "")
          .filter(Boolean)
          .join(", ");
      }
      values.push({ fieldId: f.id, name: f.name, kind: f.kind, value, display });
    }
    out.set(itemId, values);
  }
  return out;
}
/**
 * One field's value from the API, checked, as the rows to store. Empty: no rows.
 * @param {ItemContext} c
 * @param {CustomField} f
 * @param {unknown} raw
 * @returns {Promise<Omit<ValueRow, "item_id" | "field_id">[]>}
 */
async function rowsFor(c, f, raw) {
  const empty = raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && !raw.length);
  if (empty) return [];
  const base = { value_text: null, value_number: null, value_date: null, value_user: null, option_id: null };
  switch (f.kind) {
    case "text": {
      const t = String(raw).trim();
      if (t.length > 500) throw new HttpError(400, `${f.name}: up to 500 characters`);
      return t ? [{ ...base, value_text: t }] : [];
    }
    case "textarea": {
      const t = String(raw).trim();
      if (t.length > 5000) throw new HttpError(400, `${f.name}: up to 5,000 characters`);
      return t ? [{ ...base, value_text: t }] : [];
    }
    case "url": {
      const t = String(raw).trim();
      // Only web addresses: never javascript: or data: links, which would run when clicked.
      if (t.length > 500 || !/^https?:\/\/[^\s<>"]+$/i.test(t)) throw new HttpError(400, `${f.name} must be a web address starting with https://`);
      return [{ ...base, value_text: t }];
    }
    case "checkbox": {
      const on = raw === true || /^(yes|true|1|on)$/i.test(String(raw));
      if (!on && !(raw === false || /^(no|false|0|off)$/i.test(String(raw)))) throw new HttpError(400, `${f.name} is yes or no`);
      return [{ ...base, value_number: on ? 1 : 0 }];
    }
    case "currency":
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
      const u = await /** @type {Promise<{ id: string; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id FROM users WHERE id = ?").bind(String(raw)).first()));
      if (!u) throw new HttpError(400, `${f.name}: choose someone in this workspace`);
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
const display =
  /**
   * @param {CustomField} f
   * @param {Omit<ValueRow, "item_id" | "field_id">[]} rows
   * @param {Map<string, string>} names
   * @returns {string | null}
   */ (f, rows, names) => {
    if (!rows.length) return null;
    const r = rows[0];
    if (f.kind === "text" || f.kind === "textarea" || f.kind === "url") return r.value_text;
    if (f.kind === "number") return r.value_number == null ? null : String(Number(r.value_number));
    if (f.kind === "currency") return r.value_number == null ? null : money(Number(r.value_number), f.currency);
    if (f.kind === "checkbox") return Number(r.value_number) === 1 ? "Yes" : "No";
    if (f.kind === "date") return r.value_date;
    if (f.kind === "user") return r.value_user ? (names.get(r.value_user) ?? "Former user") : null;
    return rows.map((x) => f.options.find((o) => o.id === x.option_id)?.label ?? "").join(", ");
  };
/**
 * The statements that store an item's custom fields, and the changes for the activity log (as
 * "field:<name>"). On create, every required field shown on the create form must be filled; on edit,
 * a required field can't be emptied, and fields not editable there can't be changed.
 * @param {ItemContext} c
 * @param {string} itemId
 * @param {string} systemId
 * @param {unknown} input
 * @param {"create" | "edit"} mode
 * @param {string} [itemType]  the item's type: only its fields apply
 * @returns {Promise<{ stmts: D1PreparedStatement[]; changes: [string, unknown, unknown][]; }>}
 */
export async function planCustomValues(c, itemId, systemId, input, mode, itemType) {
  const sent = input !== undefined;
  const raw = input && typeof input === "object" && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};
  // Only the fields for this item's type (a field without types is for every type).
  const fields = (await fieldsForSystem(c.db, systemId)).filter((f) => !itemType || !f.itemTypes || f.itemTypes.includes(itemType));
  // On create, a field left out takes its default value, if it has one.
  /** @type {Record<string, unknown>} */ const given = { ...raw };
  if (mode === "create") {
    for (const f of fields) {
      if (f.defaultValue != null && f.onCreate && !Object.prototype.hasOwnProperty.call(given, f.id)) {
        const d = defaultFor(f);
        if (d !== undefined) given[f.id] = d;
      }
    }
  }
  /** @type {D1PreparedStatement[]} */ const stmts = [];
  /** @type {[string, unknown, unknown][]} */ const changes = [];
  if (!fields.length && !Object.keys(given).length) return { stmts, changes };
  const unknownId = Object.keys(given).find((id) => !fields.some((f) => f.id === id));
  if (unknownId) throw new HttpError(400, "That custom field isn't used for this kind of item in this workspace");
  const current = mode === "edit" ? await /** @type {Promise<D1Result<ValueRow>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT * FROM custom_field_values WHERE item_id = ?").bind(itemId).all())) : { results: /** @type {ValueRow[]} */ ([]) };
  const names = fields.some((f) => f.kind === "user")
    ? new Map((await /** @type {Promise<D1Result<{ id: string; name: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id, name FROM users").all()))).results.map((u) => [u.id, u.name]))
    : /** @type {Map<string, string>} */ (/** @type {unknown} */ (new Map()));
  for (const f of fields) {
    const shown = mode === "create" ? f.onCreate : f.onEdit;
    const has = Object.prototype.hasOwnProperty.call(given, f.id);
    if (has && !shown) throw new HttpError(400, `${f.name} can't be set here`);
    // Required fields are checked when the form or the API sends custom fields (automation and older clients don't).
    if (mode === "create" && sent && f.required && f.onCreate && !has) throw new HttpError(400, `${f.name} is required`);
    if (!has) continue;
    const next = await rowsFor(c, f, given[f.id]);
    if (f.required && !next.length) throw new HttpError(400, `${f.name} is required`);
    const before = current.results.filter((r) => r.field_id === f.id);
    const from = display(f, before, names);
    const to = display(f, next, names);
    if (from === to) continue;
    stmts.push(c.db.prepare("DELETE FROM custom_field_values WHERE item_id = ? AND field_id = ?").bind(itemId, f.id));
    for (const r of next) {
      stmts.push(c.db.prepare("INSERT INTO custom_field_values (item_id, field_id, value_text, value_number, value_date, value_user, option_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(itemId, f.id, r.value_text, r.value_number, r.value_date, r.value_user, r.option_id));
    }
    changes.push([`field:${f.name}`, from, to]);
  }
  return { stmts, changes };
}
/**
 * @param {ItemContext} c
 * @param {string} itemId
 * @param {string} systemId
 * @param {unknown} input
 * @param {"create" | "edit"} mode
 * @param {string} [itemType]
 * @returns {Promise<[string, unknown, unknown][]>}
 */
export async function saveCustomValues(c, itemId, systemId, input, mode, itemType) {
  const plan = await planCustomValues(c, itemId, systemId, input, mode, itemType);
  if (plan.stmts.length) await c.db.batch(plan.stmts);
  return plan.changes;
}
// ---------- administration ----------
/**
 * @param {Record<string, unknown>} b
 * @returns {{ name: string; kind: CustomFieldKind; description: string; required: number; onCreate: number; onEdit: number; onView: number; onBoard: number; options: { id: string | null; label: string; }[]; defaultValue: string | null; itemTypes: string[] | null; currency: string | null }}
 */
function checkField(b) {
  const name = String(b.name ?? "")
    .trim()
    .slice(0, 60);
  if (!name) throw new HttpError(400, "A custom field needs a name");
  const kind = /** @type {CustomFieldKind} */ (String(b.kind));
  if (!(kind in CUSTOM_FIELD_KINDS)) throw new HttpError(400, "Choose the kind of field");
  const options = Array.isArray(b.options)
    ? b.options
        .map(/** @returns {{ id?: unknown; label?: unknown }} */ (o) => (typeof o === "object" && o ? /** @type {{ id?: unknown; label?: unknown }} */ (o) : { label: o }))
        .map((o) => ({
          id: o.id ? String(o.id) : null,
          label: String(o.label ?? "")
            .trim()
            .slice(0, 60),
        }))
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
    description: String(b.description ?? "")
      .trim()
      .slice(0, 200),
    required: b.required ? 1 : 0,
    onCreate: b.onCreate === false ? 0 : 1,
    onEdit: b.onEdit === false ? 0 : 1,
    onView: b.onView === false ? 0 : 1,
    onBoard: b.onBoard ? 1 : 0,
    options: kind === "select" || kind === "multiselect" ? options.filter((o) => o.label) : [],
    defaultValue: cleanDefault(kind, b.defaultValue, options),
    itemTypes: Array.isArray(b.itemTypes) && b.itemTypes.length ? [...new Set(b.itemTypes.map(String))].slice(0, 30) : null,
    currency: kind === "currency" ? cleanCurrency(b.currency) : null,
  };
}
/**
 * A default value as stored: text as given, a number, a date (or +3d: days from the day the item is made), yes or
 * no, or a choice's label (matched by label, so a default survives the choices being saved again).
 * @param {CustomFieldKind} kind
 * @param {unknown} v
 * @param {{ label: string }[]} options
 * @returns {string | null}
 */
function cleanDefault(kind, v, options) {
  if (v === undefined || v === null || v === "") return null;
  const t = String(v).trim().slice(0, 500);
  if (kind === "number" || kind === "currency") {
    if (!Number.isFinite(Number(t))) throw new HttpError(400, "The default must be a number");
  } else if (kind === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t) && !/^\+\d{1,3}d$/.test(t)) throw new HttpError(400, "The default date is a date (2026-12-01) or days from the day it's made (+3d)");
  } else if (kind === "checkbox") {
    if (!/^(yes|no)$/i.test(t)) throw new HttpError(400, "The default is yes or no");
  } else if (kind === "select" || kind === "multiselect") {
    if (!options.some((o) => o.label.toLowerCase() === t.toLowerCase())) throw new HttpError(400, "The default must be one of the choices");
  } else if (kind === "url") {
    if (!/^https?:\/\/[^\s<>"]+$/i.test(t)) throw new HttpError(400, "The default must be a web address starting with https://");
  } else if (kind === "user") throw new HttpError(400, "A person field has no default");
  return t;
}
/** @param {unknown} v */
function cleanCurrency(v) {
  const c = String(v ?? "USD").toUpperCase();
  if (!CURRENCIES.includes(c)) throw new HttpError(400, `Choose a currency: ${CURRENCIES.join(", ")}`);
  return c;
}
/**
 * A field's default as a value the API takes (a date "+3d" counts from today); undefined if it no longer fits.
 * @param {CustomField} f
 * @returns {unknown}
 */
function defaultFor(f) {
  const d = /** @type {string} */ (f.defaultValue);
  if (f.kind === "date" && /^\+\d+d$/.test(d)) return new Date(Date.now() + Number(d.slice(1, -1)) * 86_400_000).toISOString().slice(0, 10);
  if (f.kind === "select" || f.kind === "multiselect") {
    const o = f.options.find((x) => x.label.toLowerCase() === d.toLowerCase());
    return o ? (f.kind === "select" ? o.id : [o.id]) : undefined;
  }
  return d;
}
/**
 * An amount with its currency: "USD 1,250.00".
 * @param {number} n
 * @param {string | undefined} currency
 */
function money(n, currency) {
  return `${currency ?? ""} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}
/**
 * Item types named for a field must be this workspace's.
 * @param {D1Database} db
 * @param {string[] | null} ids
 */
async function checkItemTypes(db, ids) {
  if (!ids) return;
  const known = new Set((/** @type {{ id: string }[]} */ ((await db.prepare("SELECT id FROM item_types").all()).results)).map((r) => r.id));
  const bad = ids.find((id) => !known.has(id));
  if (bad) throw new HttpError(400, `Unknown item type ${bad}`);
}
/**
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @returns {Promise<Response | null>}
 */
export async function customFieldsApi(c, path, method) {
  if (!path.startsWith("/api/custom-fields")) return null;
  const { db, req } = c;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  // Everyone signed in reads the definitions (forms and search need them); only "manage_schemes" changes them.
  if (path === "/api/custom-fields" && method === "GET") {
    const ws = new URL(req.url).searchParams.get("workspace");
    return json(ws ? await loadFields(db, "workspace = ?", [ws]) : await loadFields(db));
  }
  if (!c.can("manage_schemes")) throw new HttpError(403, "You don't have permission to manage custom fields");
  const saveOptions = /** @param {string} fieldId @param {{ id: string | null; label: string }[]} options @param {string[]} existing */ (fieldId, options, existing) => {
    const keep = new Set(options.map((o) => o.id).filter(/** @returns {x is string} */ (x) => !!x && existing.includes(x)));
    /** @type {D1PreparedStatement[]} */ const stmts = existing.filter((id) => !keep.has(id)).map((id) => db.prepare("DELETE FROM custom_field_options WHERE id = ?").bind(id));
    options.forEach((o, i) => {
      if (o.id && keep.has(o.id)) stmts.push(db.prepare("UPDATE custom_field_options SET label = ?, position = ? WHERE id = ?").bind(o.label, i, o.id));
      else stmts.push(db.prepare("INSERT INTO custom_field_options (id, field_id, label, position) VALUES (?, ?, ?, ?)").bind(newToken().slice(0, 16), fieldId, o.label, i));
    });
    return stmts;
  };
  if (path === "/api/custom-fields" && method === "POST") {
    const b = await /** @type {Promise<Record<string, unknown>>} */ (/** @type {unknown} */ (body(req)));
    const f = checkField(b);
    await checkItemTypes(db, f.itemTypes);
    const workspace = String(b.workspace ?? "");
    const ws = await /** @type {Promise<{ value: string; } | null>} */ (/** @type {unknown} */ (workspacesRow(db)));
    if (!(ws ? /** @type {string[]} */ (JSON.parse(ws.value)) : ["Projects", "HR"]).includes(workspace)) throw new HttpError(400, "Choose the workspace");
    const count = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(*) AS n FROM custom_fields WHERE workspace = ?").bind(workspace).first()));
    if (Number(count?.n ?? 0) >= MAX_CUSTOM_FIELDS) throw new HttpError(400, `Up to ${MAX_CUSTOM_FIELDS} custom fields per workspace`);
    if (await db.prepare("SELECT 1 FROM custom_fields WHERE workspace = ? AND lower(name) = lower(?)").bind(workspace, f.name).first()) {
      throw new HttpError(409, `${workspace} already has a field called ${f.name}`);
    }
    const id = newToken().slice(0, 16);
    await db.batch([
      db
        .prepare(
          `INSERT INTO custom_fields (id, workspace, name, kind, description, required, on_create, on_edit, on_view, on_board, position, default_value, item_types, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM custom_fields WHERE workspace = ?), ?, ?, ?, ?, ?)`,
        )
        .bind(id, workspace, f.name, f.kind, f.description, f.required, f.onCreate, f.onEdit, f.onView, f.onBoard, workspace, f.defaultValue, f.itemTypes ? JSON.stringify(f.itemTypes) : null, f.currency, c.now, c.now),
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
      const used = await /** @type {Promise<{ n: number; } | null>} */ (/** @type {unknown} */ (db.prepare("SELECT COUNT(DISTINCT item_id) AS n FROM custom_field_values WHERE field_id = ?").bind(before.id).first()));
      await db.prepare("DELETE FROM custom_fields WHERE id = ?").bind(before.id).run();
      await c.audit("custom_field_deleted", null, { field: before.name, workspace: before.workspace, itemsWithValues: Number(used?.n ?? 0) });
      return json({ ok: true });
    }
    const f = checkField({ ...(await /** @type {Promise<Record<string, unknown>>} */ (/** @type {unknown} */ (body(req)))) });
    if (f.kind !== before.kind) throw new HttpError(400, "A field's kind can't change; make a new field instead");
    await checkItemTypes(db, f.itemTypes);
    if (f.name.toLowerCase() !== before.name.toLowerCase() && (await db.prepare("SELECT 1 FROM custom_fields WHERE workspace = ? AND lower(name) = lower(?)").bind(before.workspace, f.name).first())) {
      throw new HttpError(409, `${before.workspace} already has a field called ${f.name}`);
    }
    await db.batch([
      db
        .prepare("UPDATE custom_fields SET name = ?, description = ?, required = ?, on_create = ?, on_edit = ?, on_view = ?, on_board = ?, default_value = ?, item_types = ?, currency = ?, updated_at = ? WHERE id = ?")
        .bind(f.name, f.description, f.required, f.onCreate, f.onEdit, f.onView, f.onBoard, f.defaultValue, f.itemTypes ? JSON.stringify(f.itemTypes) : null, f.currency, c.now, before.id),
      ...saveOptions(
        before.id,
        f.options,
        before.options.map((o) => o.id),
      ),
    ]);
    const [after] = await loadFields(db, "id = ?", [before.id]);
    const summary = /** @param {CustomField} x */ (x) => ({ name: x.name, required: x.required, create: x.onCreate, edit: x.onEdit, view: x.onView, board: x.onBoard, choices: x.options.map((o) => o.label), default: x.defaultValue, itemTypes: x.itemTypes });
    await c.audit("custom_field_updated", null, { field: after.name, workspace: after.workspace, from: summary(before), to: summary(after) });
    return json(after);
  }
  // Reordering within a workspace.
  if (path === "/api/custom-fields/order" && method === "PUT") {
    const ids = (await /** @type {Promise<{ ids?: unknown; }>} */ (/** @type {unknown} */ (body(req)))).ids;
    if (!Array.isArray(ids)) throw new HttpError(400, "Send the fields in order");
    await db.batch(ids.slice(0, 200).map((id, i) => db.prepare("UPDATE custom_fields SET position = ?, updated_at = ? WHERE id = ?").bind(i + 1, c.now, String(id))));
    return json({ ok: true });
  }
  throw new HttpError(404, "Not found");
}
/**
 * For PQL: every custom field, by lower-case name (fields of the same name in several workspaces share it).
 * @param {D1Database} db
 * @returns {Promise<Map<string, { ids: string[]; name: string; kind: CustomFieldKind }>>}
 */
export async function customFieldsByName(db) {
  const rows = await /** @type {Promise<D1Result<{ id: string; name: string; kind: CustomFieldKind; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id, name, kind FROM custom_fields ORDER BY workspace, position").all()));
  const out = /** @type {Map<string, { ids: string[]; name: string; kind: CustomFieldKind; }>} */ (/** @type {unknown} */ (new Map()));
  for (const r of rows.results) {
    const k = r.name.toLowerCase();
    const prev = out.get(k);
    if (prev && prev.kind === r.kind) prev.ids.push(r.id);
    else if (!prev) out.set(k, { ids: [r.id], name: r.name, kind: r.kind });
  }
  return out;
}
/**
 * @typedef {Object} FieldRow
 * @property {string} id
 * @property {string} workspace
 * @property {string} name
 * @property {CustomFieldKind} kind
 * @property {string} description
 * @property {number} required
 * @property {number} on_create
 * @property {number} on_edit
 * @property {number} on_view
 * @property {number} on_board
 * @property {number} position
 * @property {string | null} default_value
 * @property {string | null} item_types
 * @property {string | null} currency
 */
/**
 * @typedef {Object} ValueRow
 * @property {string} item_id
 * @property {string} field_id
 * @property {string | null} value_text
 * @property {string | number | null} value_number
 * @property {string | null} value_date
 * @property {string | null} value_user
 * @property {string | null} option_id
 */
