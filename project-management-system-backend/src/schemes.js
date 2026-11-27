/** @import { ItemContext, ItemRow } from './workitems' */
/** @import { Alert } from './notify' */
/** @import { NotificationKind } from '../../project-management-system-frontend/src/data/notifications' */
/** @import { NotificationEvent, NotificationScheme } from '../../project-management-system-frontend/src/data/admin' */
/** @import { Role } from '../../project-management-system-frontend/src/data/roles' */
// Notification schemes: for each work item event, who is told (assignee, reporter, watchers, project
// lead, a role, @mentioned people) and how (bell, email, Teams). Everyone told must be able to see the
// item (worker/access.ts), the person acting is never told, and each person can opt out of an event in
// Settings → Notifications. Items with a security level never go to the Teams channel.
import { canSeeItem, viewersOf } from "./access";
import { NOTIFICATION_EVENTS } from "../../project-management-system-frontend/src/data/admin";
import { ROLES } from "../../project-management-system-frontend/src/data/roles";
const toScheme =
  /**
   * @param {SchemeRow} r
   * @returns {NotificationScheme}
   */ (r) => ({
    event: r.event,
    assignee: !!r.notify_assignee,
    reporter: !!r.notify_reporter,
    watchers: !!r.notify_watchers,
    lead: !!r.notify_lead,
    mentioned: !!r.notify_mentioned,
    ...(r.notify_role && ROLES.includes(/** @type {Role} */ (r.notify_role)) ? { role: /** @type {Role} */ (r.notify_role) } : {}),
    bell: !!r.by_bell,
    email: !!r.by_email,
    teams: !!r.by_teams,
  });
/**
 * The schemes, read once per request (a change can raise two or three events).
 * @type {WeakMap<object, Promise<NotificationScheme[]>>}
 */
const SCHEMES = /** @type {WeakMap<object, Promise<Array<NotificationScheme>>>} */ (/** @type {unknown} */ (new WeakMap()));
/**
 * @param {ItemContext} c
 * @returns {Promise<NotificationScheme[]>}
 */
function schemesFor(c) {
  let p = SCHEMES.get(c.req);
  if (!p) SCHEMES.set(c.req, (p = loadSchemes(c.db)));
  return p;
}
/**
 * @param {D1Database} db
 * @returns {Promise<NotificationScheme[]>}
 */
export async function loadSchemes(db) {
  const rows = await /** @type {Promise<D1Result<SchemeRow>>} */ (/** @type {unknown} */ (db.prepare("SELECT * FROM notification_schemes").all()));
  const by = new Map(rows.results.map((r) => [r.event, toScheme(r)]));
  return NOTIFICATION_EVENTS.map((e) => by.get(e.key) ?? { event: e.key, assignee: false, reporter: false, watchers: false, lead: false, mentioned: false, bell: true, email: true, teams: false });
}
/** @type {Record<NotificationEvent, NotificationKind>} */ const KIND = {
  item_created: "assigned",
  item_assigned: "assigned",
  item_updated: "watching",
  item_transitioned: "watching",
  item_commented: "watching",
};
const itemLink =
  /** @param {ItemRow} r
   * @returns {string}
   */ (r) => `#/projects/${r.system_id}/items/${r.project_key}-${r.number}`;
/**
 * Tells the people the scheme for `event` names about `r`. Returns who was told, so a caller can skip
 * them for a second event about the same change. Mentioned people get the "mentioned" bell icon.
 * @param {ItemContext} c
 * @param {NotificationEvent} event
 * @param {ItemRow} r
 * @param {ItemNotice} n
 * @returns {Promise<string[]>}
 */
export async function notifyItem(c, event, r, n) {
  const scheme = /** @type {NotificationScheme} */ ((await schemesFor(c)).find((s) => s.event === event));
  const ids = /** @type {Set<string>} */ (/** @type {unknown} */ (new Set(n.extra ?? [])));
  const all = !n.onlyMentioned;
  if (all && scheme.assignee && r.assignee) ids.add(r.assignee);
  if (all && scheme.reporter) ids.add(r.reporter);
  if (all && scheme.watchers) {
    const w = await /** @type {Promise<D1Result<{ user_id: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(r.id).all()));
    w.results.forEach((x) => ids.add(x.user_id));
  }
  if (all && scheme.lead) {
    const lead = await /** @type {Promise<{ l: string | null; } | null>} */ (/** @type {unknown} */ (c.db.prepare("SELECT (data::json ->> 'lead') AS l FROM systems WHERE id = ?").bind(r.system_id).first()));
    if (lead?.l) ids.add(lead.l);
  }
  if (all && scheme.role) {
    const people = await /** @type {Promise<D1Result<{ id: string; }>>} */ (/** @type {unknown} */ (c.db.prepare("SELECT id FROM users WHERE role = ?").bind(scheme.role).all()));
    people.results.forEach((p) => ids.add(p.id));
  }
  const mentioned = new Set(scheme.mentioned ? (n.mentioned ?? []) : []);
  mentioned.forEach((id) => ids.add(id));
  ids.delete(c.me.id);
  (n.skip ?? []).forEach((id) => ids.delete(id));
  /** @type {string[]} */ const told = [];
  if (ids.size && (scheme.bell || scheme.email || (n.extra?.length ?? 0) > 0)) {
    const [viewers, optouts] = await Promise.all([
      viewersOf(c.db, [...ids]),
      /** @type {Promise<D1Result<{ user_id: string; }>>} */ (
        /** @type {unknown} */ (
          c.db
            .prepare(`SELECT user_id FROM notification_optouts WHERE event = ? AND user_id IN (${[...ids].map(() => "?").join(", ")})`)
            .bind(event, ...ids)
            .all()
        )
      ),
    ]);
    const out = new Set(optouts.results.map((o) => o.user_id));
    for (const id of ids) {
      const v = viewers.get(id);
      if (!v || out.has(id)) continue;
      if (!(await canSeeItem(c.db, v, r))) continue;
      told.push(id);
    }
  }
  /** @type {Alert[]} */ const alerts = told.map((userId) => ({
    userId,
    kind: mentioned.has(userId) ? "mentioned" : KIND[event],
    title: (mentioned.has(userId) ? `${c.me.name} mentioned you on ${r.project_key}-${r.number}` : n.title).slice(0, 200),
    body: n.body.slice(0, 500),
    link: itemLink(r),
    // A move's own "notify" rule always uses the bell; the scheme decides the rest.
    bell: scheme.bell || (n.extra ?? []).includes(userId),
    email: scheme.email,
  }));
  const post = all && scheme.teams && !r.security_level ? { title: n.title, body: n.body, link: itemLink(r) } : undefined;
  if (alerts.length || post) c.alert(alerts, post);
  return told;
}
/**
 * @typedef {Object} SchemeRow
 * @property {NotificationEvent} event
 * @property {number} notify_assignee
 * @property {number} notify_reporter
 * @property {number} notify_watchers
 * @property {number} notify_lead
 * @property {number} notify_mentioned
 * @property {string | null} notify_role
 * @property {number} by_bell
 * @property {number} by_email
 * @property {number} by_teams
 */
/**
 * @typedef {Object} ItemNotice
 * @property {string} title
 * @property {string} body
 * @property {string[]} [mentioned] People
 * @property {string[]} [skip] Already told about this change by another event.
 * @property {string[]} [extra] Always told, whatever the scheme (for example a workflow move's own "notify" rule), if they may see the item.
 * @property {boolean} [onlyMentioned] Tell only the people mentioned (a comment edited to mention someone new).
 */
