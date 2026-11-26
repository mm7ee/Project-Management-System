// The administration audit log (migration 0017): who changed what, with the values before and after. Append-only:
// the app's role can add and read entries, never change or remove them.
//
// auditEntry() returns a statement to put in the same batch as the change, so the change and its record are saved
// together or not at all. adminAudit() runs one on its own, for changes made in several steps.

/**
 * @typedef {Object} AuditInput
 * @property {string} action          e.g. "workspace_updated"
 * @property {"organization" | "workspace" | "person" | "membership" | "roles" | "setting" | "invite"} type
 * @property {string | null} [id]     what was changed
 * @property {string | null} [workspaceId]  the workspace it's in; omitted for organisation-wide changes
 * @property {unknown} [before]       omitted when something was made
 * @property {unknown} [after]        omitted when something was removed
 */

/**
 * @param {D1Database} db  a handle scoped to the organisation (the entry is stamped with it)
 * @param {Request} req
 * @param {{ id: string | null; name: string }} who
 * @param {AuditInput} e
 * @returns {D1PreparedStatement}
 */
export function auditEntry(db, req, who, e) {
  return db
    .prepare("INSERT INTO audit_log (workspace_id, at, actor_id, actor, action, target_type, target_id, before, after, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      e.workspaceId ?? null,
      new Date().toISOString(),
      who.id,
      who.name.slice(0, 64),
      e.action,
      e.type,
      e.id ?? null,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      req.headers.get("cf-connecting-ip"),
    );
}

/**
 * @param {D1Database} db
 * @param {Request} req
 * @param {{ id: string | null; name: string }} who
 * @param {AuditInput} e
 */
export async function adminAudit(db, req, who, e) {
  await auditEntry(db, req, who, e).run();
}

/**
 * The fields of `before` and `after` that differ, so an entry shows what changed and not the whole record.
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @returns {{ before: Record<string, unknown>; after: Record<string, unknown> } | null}  null when nothing changed
 */
export function changed(before, after) {
  /** @type {Record<string, unknown>} */ const b = {};
  /** @type {Record<string, unknown>} */ const a = {};
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
