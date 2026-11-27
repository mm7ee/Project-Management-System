/** @import { Role, RolePermissions } from '../../project-management-system-frontend/src/data/roles' */
// Who may see a work item. One rule, used everywhere work items are read or sent: lists, item pages,
// boards, the timeline, reports, PQL, dashboards, subscriptions, digests, notifications, Ask AI,
// view-only links, the API, webhooks and automation.
//
// 1. Developers without "Log and assign feature requests" see only items assigned to them or that
//    they reported (the Phase 1 rule).
// 2. An item with a security level is seen only by administrators, its assignee and reporter, and the
//    roles and people the level grants. A view-only link never sees items with a security level.
import { DEFAULT_ROLE_PERMISSIONS, permissionsFor } from "../../project-management-system-frontend/src/data/roles";
import { settingRow } from "./settings";
/** Nobody in particular: what may go to people outside PMS or to everyone (webhooks, the briefing). */
/** @type {Viewer} */ export const PUBLIC_VIEWER = { id: "", role: "viewer", ownOnly: false, guest: true };
/**
 * The SQL condition (with its values) limiting work items, under `alias`, to what `v` may see.
 * @param {Viewer} v
 * @param {string} [alias="w"]
 * @returns {{ sql: string; args: unknown[] }}
 */
export function itemAccess(v, alias = "w") {
  if (v.all) return { sql: "TRUE", args: [] };
  /** @type {string[]} */ const parts = [];
  /** @type {unknown[]} */ const args = [];
  if (v.guest) parts.push(`${alias}.security_level IS NULL`);
  else if (v.role !== "admin") {
    parts.push(`(${alias}.security_level IS NULL OR ${alias}.assignee = ? OR ${alias}.reporter = ? OR EXISTS (SELECT 1 FROM security_level_grants g WHERE g.level_id = ${alias}.security_level AND (g.role = ? OR g.user_id = ?)))`);
    args.push(v.id, v.id, v.role, v.id);
  }
  if (v.ownOnly && !v.guest) {
    parts.push(`(${alias}.assignee = ? OR ${alias}.reporter = ?)`);
    args.push(v.id, v.id);
  }
  return { sql: parts.length ? `(${parts.join(" AND ")})` : "TRUE", args };
}
/**
 * The same rule for one item already loaded.
 * @param {D1Database} db
 * @param {Viewer} v
 * @param {{ assignee: string | null; reporter: string; security_level?: string | null }} r
 * @returns {Promise<boolean>}
 */
export async function canSeeItem(db, v, r) {
  if (v.all) return true;
  const own = r.assignee === v.id || r.reporter === v.id;
  if (v.ownOnly && !v.guest && !own) return false;
  if (!r.security_level) return true;
  if (v.guest) return false;
  if (v.role === "admin" || own) return true;
  return !!(await db.prepare("SELECT 1 FROM security_level_grants WHERE level_id = ? AND (role = ? OR user_id = ?)").bind(r.security_level, v.role, v.id).first());
}
/**
 * The level ids a person may see (for choosing a level on an item, and showing the list).
 * @param {D1Database} db
 * @param {Viewer} v
 * @returns {Promise<string[]>}
 */
export async function levelsFor(db, v) {
  if (v.guest) return [];
  const rows =
    v.role === "admin" || v.all
      ? await /** @type {Promise<D1Result<{ id: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT id FROM security_levels ORDER BY position, name").all()))
      : await /** @type {Promise<D1Result<{ id: string; }>>} */ (/** @type {unknown} */ (db.prepare("SELECT DISTINCT level_id AS id FROM security_level_grants WHERE role = ? OR user_id = ?").bind(v.role, v.id).all()));
  return rows.results.map((r) => r.id);
}
/**
 * The saved role permissions, or the defaults.
 * @param {D1Database} db
 * @returns {Promise<RolePermissions>}
 */
export async function roleMatrix(db) {
  const row = await /** @type {Promise<{ value: string; } | null>} */ (/** @type {unknown} */ (settingRow(db, "role_permissions")));
  return row ? { ...DEFAULT_ROLE_PERMISSIONS, .../** @type {Partial<RolePermissions>} */ (JSON.parse(row.value)) } : DEFAULT_ROLE_PERMISSIONS;
}
/**
 * A person as a viewer, for things sent to them later (notifications, subscriptions, digests).
 * @param {{ id: string; role: Role }} u
 * @param {RolePermissions} matrix
 * @returns {Viewer}
 */
export function viewerOfUser(u, matrix) {
  const perms = permissionsFor(u.role, matrix);
  return { id: u.id, role: u.role, ownOnly: u.role === "developer" && !perms.includes("manage_features") };
}
/**
 * Viewers for several people at once. Missing people are left out.
 * @param {D1Database} db
 * @param {string[]} ids
 * @returns {Promise<Map<string, Viewer>>}
 */
export async function viewersOf(db, ids) {
  if (!ids.length) return new Map();
  const [matrix, rows] = await Promise.all([
    roleMatrix(db),
    /** @type {Promise<D1Result<{ id: string; role: Role; }>>} */ (
      /** @type {unknown} */ (
        db
          .prepare(`SELECT id, role FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
          .bind(...ids)
          .all()
      )
    ),
  ]);
  return new Map(rows.results.map((u) => [u.id, viewerOfUser(u, matrix)]));
}
/**
 * @typedef {Object} Viewer
 * @property {string} id
 * @property {Role} role
 * @property {boolean} ownOnly Developers without manage_features: only items assigned to them or that they reported.
 * @property {boolean} [guest] A view-only link.
 * @property {boolean} [all] Sees every item whatever its level (automation, which acts with full rights).
 */
