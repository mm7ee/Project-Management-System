// What the assistant's read tools (src/assistant.js) and write tools (src/actions.js) share: looking a project or a
// person up as the person asking may see them, and the error a tool returns to the model (not to the person).
/** @typedef {import("./workitems").ItemContext} ItemContext */

/** A tool's own failure: its message goes back to the model, which can try again or say so. */
export class ToolError extends Error {}

/**
 * A project by its id or its key, if the person may see it (row-level security keeps other workspaces out).
 * @param {ItemContext} c @param {unknown} ref
 */
export async function projectRef(c, ref) {
  const r = String(ref ?? "").trim();
  if (!r) throw new ToolError("Say which project (its id or key, from find_projects).");
  const row = /** @type {{ id: string; key: string; data: string } | null} */ (await c.db.prepare("SELECT id, key, data FROM systems WHERE id = ? OR upper(key) = upper(?) LIMIT 1").bind(r, r).first());
  if (!row) throw new ToolError(`No project "${r}" that you can see. Use find_projects to look it up.`);
  return { id: row.id, key: row.key, name: /** @type {{ name: string }} */ (JSON.parse(row.data)).name };
}
/** A project page's address. */
export const projectHref = (/** @type {string} */ id, /** @type {string} */ tab = "") => `#/projects/${id}${tab ? `/${tab}` : ""}`;
/** Everyone's name by id. */
export const nameMap = async (/** @type {ItemContext} */ c) => new Map(/** @type {{ id: string; name: string }[]} */ ((await c.db.prepare("SELECT id, name FROM users").all()).results).map((u) => [u.id, u.name]));

/**
 * A person in the workspace by their name or username (case and spaces aside), or an error naming who exists. A
 * name the person used, not an id the model made up.
 * @param {ItemContext} c
 * @param {unknown} who
 */
export async function personRef(c, who) {
  const w = String(who ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!w) return null;
  const people = /** @type {{ id: string; name: string; username: string }[]} */ ((await c.db.prepare("SELECT id, name, username FROM users").all()).results);
  const found = people.filter((p) => p.name.toLowerCase().replace(/\s+/g, " ") === w || p.username.toLowerCase() === w);
  if (found.length === 1) return found[0];
  // A first name alone, when only one person has it.
  const first = people.filter((p) => p.name.toLowerCase().split(" ")[0] === w);
  if (!found.length && first.length === 1) return first[0];
  throw new ToolError(found.length || first.length > 1 ? `More than one person matches "${who}": use their full name.` : `No one called "${who}" in this workspace.`);
}
