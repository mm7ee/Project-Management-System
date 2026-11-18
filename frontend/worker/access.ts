// Who may see a work item. One rule, used everywhere work items are read or sent: lists, item pages,
// boards, the timeline, reports, PQL, dashboards, subscriptions, digests, notifications, Ask Pulse,
// view-only links, the API, webhooks and automation.
//
// 1. Developers without "Log and assign feature requests" see only items assigned to them or that
//    they reported (the Phase 1 rule).
// 2. An item with a security level is seen only by administrators, its assignee and reporter, and the
//    roles and people the level grants. A view-only link never sees items with a security level.

import { DEFAULT_ROLE_PERMISSIONS, permissionsFor, type Role, type RolePermissions } from "../src/data/roles";

export interface Viewer {
  id: string;
  role: Role;
  /** Developers without manage_features: only items assigned to them or that they reported. */
  ownOnly: boolean;
  /** A view-only link. */
  guest?: boolean;
  /** Sees every item whatever its level (automation, which acts with full rights). */
  all?: boolean;
}

/** Nobody in particular: what may go to people outside Pulse or to everyone (webhooks, the briefing). */
export const PUBLIC_VIEWER: Viewer = { id: "", role: "viewer", ownOnly: false, guest: true };

/** The SQL condition (with its values) limiting work items, under `alias`, to what `v` may see. */
export function itemAccess(v: Viewer, alias = "w"): { sql: string; args: unknown[] } {
  if (v.all) return { sql: "TRUE", args: [] };
  const parts: string[] = [];
  const args: unknown[] = [];
  if (v.guest) parts.push(`${alias}.security_level IS NULL`);
  else if (v.role !== "admin") {
    parts.push(
      `(${alias}.security_level IS NULL OR ${alias}.assignee = ? OR ${alias}.reporter = ? OR EXISTS (SELECT 1 FROM security_level_grants g WHERE g.level_id = ${alias}.security_level AND (g.role = ? OR g.user_id = ?)))`,
    );
    args.push(v.id, v.id, v.role, v.id);
  }
  if (v.ownOnly && !v.guest) {
    parts.push(`(${alias}.assignee = ? OR ${alias}.reporter = ?)`);
    args.push(v.id, v.id);
  }
  return { sql: parts.length ? `(${parts.join(" AND ")})` : "TRUE", args };
}

/** The same rule for one item already loaded. */
export async function canSeeItem(db: D1Database, v: Viewer, r: { assignee: string | null; reporter: string; security_level?: string | null }): Promise<boolean> {
  if (v.all) return true;
  const own = r.assignee === v.id || r.reporter === v.id;
  if (v.ownOnly && !v.guest && !own) return false;
  if (!r.security_level) return true;
  if (v.guest) return false;
  if (v.role === "admin" || own) return true;
  return !!(await db
    .prepare("SELECT 1 FROM security_level_grants WHERE level_id = ? AND (role = ? OR user_id = ?)")
    .bind(r.security_level, v.role, v.id)
    .first());
}

/** The level ids a person may see (for choosing a level on an item, and showing the list). */
export async function levelsFor(db: D1Database, v: Viewer): Promise<string[]> {
  if (v.guest) return [];
  const rows =
    v.role === "admin" || v.all
      ? await db.prepare("SELECT id FROM security_levels ORDER BY position, name").all<{ id: string }>()
      : await db
          .prepare("SELECT DISTINCT level_id AS id FROM security_level_grants WHERE role = ? OR user_id = ?")
          .bind(v.role, v.id)
          .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

/** The saved role permissions, or the defaults. */
export async function roleMatrix(db: D1Database): Promise<RolePermissions> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").first<{ value: string }>();
  return row ? { ...DEFAULT_ROLE_PERMISSIONS, ...(JSON.parse(row.value) as Partial<RolePermissions>) } : DEFAULT_ROLE_PERMISSIONS;
}

/** A person as a viewer, for things sent to them later (notifications, subscriptions, digests). */
export function viewerOfUser(u: { id: string; role: Role }, matrix: RolePermissions): Viewer {
  const perms = permissionsFor(u.role, matrix);
  return { id: u.id, role: u.role, ownOnly: u.role === "developer" && !perms.includes("manage_features") };
}

/** Viewers for several people at once. Missing people are left out. */
export async function viewersOf(db: D1Database, ids: string[]): Promise<Map<string, Viewer>> {
  if (!ids.length) return new Map();
  const [matrix, rows] = await Promise.all([
    roleMatrix(db),
    db
      .prepare(`SELECT id, role FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
      .bind(...ids)
      .all<{ id: string; role: Role }>(),
  ]);
  return new Map(rows.results.map((u) => [u.id, viewerOfUser(u, matrix)]));
}
