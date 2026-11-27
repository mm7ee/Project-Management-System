// Settings by level (migration 0014): organisation settings (roles, two-step policy, sign-in rules, email and
// Teams delivery) and workspace settings (workload limits, the last Monday Briefing). Every read and write goes
// through here, on a database handle scoped to the tenant; a handle without one is refused rather than allowed to
// read every organisation's settings. The old `settings` table is no longer used (pulse_app can't even read it).
import { DEFAULT_WORKSPACES } from "../../project-management-system-frontend/src/data/project";

/** @typedef {"role_permissions" | "mfa_policy" | "signin_rules" | "delivery" | "delivery_error"} OrgKey */
/** @typedef {"workload_limits" | "latest_briefing"} WorkspaceKey */
/** @type {ReadonlySet<string>} */ const ORG_KEYS = new Set(["role_permissions", "mfa_policy", "signin_rules", "delivery", "delivery_error"]);
/** @type {ReadonlySet<string>} */ const WORKSPACE_KEYS = new Set(["workload_limits", "latest_briefing"]);

/**
 * Which table a key lives in, and the tenant it's read for.
 * @param {D1Database} db
 * @param {OrgKey | WorkspaceKey} key
 * @returns {{ table: "org_settings" | "workspace_settings"; column: "organization_id" | "workspace_id"; id: string }}
 */
function where(db, key) {
  const scope = /** @type {Partial<TenantDatabase>} */ (db).scope;
  if (ORG_KEYS.has(key)) {
    if (!scope?.orgId) throw new Error(`The "${key}" setting needs an organisation`);
    return { table: "org_settings", column: "organization_id", id: scope.orgId };
  }
  if (WORKSPACE_KEYS.has(key)) {
    if (!scope?.workspaceId) throw new Error(`The "${key}" setting needs a workspace`);
    return { table: "workspace_settings", column: "workspace_id", id: scope.workspaceId };
  }
  throw new Error(`Unknown setting "${key}"`);
}
/**
 * A setting as its row (`{ value }`), or null.
 * @param {D1Database} db
 * @param {OrgKey | WorkspaceKey} key
 * @returns {Promise<{ value: string } | null>}
 */
export async function settingRow(db, key) {
  const w = where(db, key);
  return /** @type {{ value: string } | null} */ (await db.prepare(`SELECT value FROM ${w.table} WHERE ${w.column} = ? AND key = ?`).bind(w.id, key).first());
}
/**
 * The statement that saves a setting: bind it to the value. The tenant columns default to the handle's.
 * (The key is one of the fixed names above, so it is safe in the text.)
 * @param {D1Database} db
 * @param {OrgKey | WorkspaceKey} key
 * @returns {D1PreparedStatement}
 */
export function saveSetting(db, key) {
  const w = where(db, key);
  return db.prepare(`INSERT INTO ${w.table} (key, value) VALUES ('${key}', ?) ON CONFLICT (${w.column}, key) DO UPDATE SET value = excluded.value`);
}
/**
 * The statement that removes a setting.
 * @param {D1Database} db
 * @param {OrgKey | WorkspaceKey} key
 * @returns {D1PreparedStatement}
 */
export function removeSetting(db, key) {
  const w = where(db, key);
  return db.prepare(`DELETE FROM ${w.table} WHERE ${w.column} = ? AND key = ?`).bind(w.id, key);
}
/**
 * The old "workspaces" setting's row, now holding only the open workspace (see workspaceNames).
 * @param {D1Database} db
 * @returns {Promise<{ value: string }>}
 */
export async function workspacesRow(db) {
  return { value: JSON.stringify(await workspaceNames(db)) };
}

/**
 * The workspace the handle is scoped to: its id and name.
 * @param {D1Database} db
 * @returns {Promise<{ id: string; name: string; key: string }>}
 */
export async function currentWorkspace(db) {
  const id = /** @type {Partial<TenantDatabase>} */ (db).scope?.workspaceId;
  if (!id) throw new Error("No workspace is open");
  const row = /** @type {{ id: string; name: string; key: string } | null} */ (await db.prepare("SELECT id, name, key FROM workspaces WHERE id = ?").bind(id).first());
  if (!row) throw new Error("The open workspace doesn't exist");
  return row;
}
/**
 * What the code before multi-tenancy called "the workspace list": now only the open workspace, since
 * nothing else is visible from it. Kept so the places that pick a workspace by name keep working.
 * @param {D1Database} db
 * @returns {Promise<string[]>}
 */
export async function workspaceNames(db) {
  const id = /** @type {Partial<TenantDatabase>} */ (db).scope?.workspaceId;
  if (!id) return DEFAULT_WORKSPACES.slice(0, 1);
  return [(await currentWorkspace(db)).name];
}
