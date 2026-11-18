// Notification schemes: for each work item event, who is told (assignee, reporter, watchers, project
// lead, a role, @mentioned people) and how (bell, email, Teams). Everyone told must be able to see the
// item (worker/access.ts), the person acting is never told, and each person can opt out of an event in
// Settings → Notifications. Items with a security level never go to the Teams channel.

import { canSeeItem, viewersOf } from "./access";
import type { ItemContext, ItemRow } from "./workitems";
import type { Alert } from "./notify";
import type { NotificationKind } from "../src/data/notifications";
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationScheme } from "../src/data/admin";
import { ROLES, type Role } from "../src/data/roles";

interface SchemeRow {
  event: NotificationEvent;
  notify_assignee: number;
  notify_reporter: number;
  notify_watchers: number;
  notify_lead: number;
  notify_mentioned: number;
  notify_role: string | null;
  by_bell: number;
  by_email: number;
  by_teams: number;
}

const toScheme = (r: SchemeRow): NotificationScheme => ({
  event: r.event,
  assignee: !!r.notify_assignee,
  reporter: !!r.notify_reporter,
  watchers: !!r.notify_watchers,
  lead: !!r.notify_lead,
  mentioned: !!r.notify_mentioned,
  ...(r.notify_role && ROLES.includes(r.notify_role as Role) ? { role: r.notify_role as Role } : {}),
  bell: !!r.by_bell,
  email: !!r.by_email,
  teams: !!r.by_teams,
});

/** The schemes, read once per request (a change can raise two or three events). */
const SCHEMES = new WeakMap<object, Promise<NotificationScheme[]>>();
function schemesFor(c: ItemContext): Promise<NotificationScheme[]> {
  let p = SCHEMES.get(c.req);
  if (!p) SCHEMES.set(c.req, (p = loadSchemes(c.db)));
  return p;
}

export async function loadSchemes(db: D1Database): Promise<NotificationScheme[]> {
  const rows = await db.prepare("SELECT * FROM notification_schemes").all<SchemeRow>();
  const by = new Map(rows.results.map((r) => [r.event, toScheme(r)]));
  return NOTIFICATION_EVENTS.map(
    (e) => by.get(e.key) ?? { event: e.key, assignee: false, reporter: false, watchers: false, lead: false, mentioned: false, bell: true, email: true, teams: false },
  );
}

const KIND: Record<NotificationEvent, NotificationKind> = {
  item_created: "assigned",
  item_assigned: "assigned",
  item_updated: "watching",
  item_transitioned: "watching",
  item_commented: "watching",
};

export interface ItemNotice {
  title: string;
  body: string;
  /** People @mentioned in the text that set this off (user ids). */
  mentioned?: string[];
  /** Already told about this change by another event. */
  skip?: string[];
  /** Always told, whatever the scheme (for example a workflow move's own "notify" rule), if they may see the item. */
  extra?: string[];
  /** Tell only the people mentioned (a comment edited to mention someone new). */
  onlyMentioned?: boolean;
}

const itemLink = (r: ItemRow) => `#/projects/${r.system_id}/items/${r.project_key}-${r.number}`;

/**
 * Tells the people the scheme for `event` names about `r`. Returns who was told, so a caller can skip
 * them for a second event about the same change. Mentioned people get the "mentioned" bell icon.
 */
export async function notifyItem(c: ItemContext, event: NotificationEvent, r: ItemRow, n: ItemNotice): Promise<string[]> {
  const scheme = (await schemesFor(c)).find((s) => s.event === event)!;
  const ids = new Set<string>(n.extra ?? []);
  const all = !n.onlyMentioned;
  if (all && scheme.assignee && r.assignee) ids.add(r.assignee);
  if (all && scheme.reporter) ids.add(r.reporter);
  if (all && scheme.watchers) {
    const w = await c.db.prepare("SELECT user_id FROM work_item_watchers WHERE item_id = ?").bind(r.id).all<{ user_id: string }>();
    w.results.forEach((x) => ids.add(x.user_id));
  }
  if (all && scheme.lead) {
    const lead = await c.db.prepare("SELECT (data::json ->> 'lead') AS l FROM systems WHERE id = ?").bind(r.system_id).first<{ l: string | null }>();
    if (lead?.l) ids.add(lead.l);
  }
  if (all && scheme.role) {
    const people = await c.db.prepare("SELECT id FROM users WHERE role = ?").bind(scheme.role).all<{ id: string }>();
    people.results.forEach((p) => ids.add(p.id));
  }
  const mentioned = new Set(scheme.mentioned ? (n.mentioned ?? []) : []);
  mentioned.forEach((id) => ids.add(id));
  ids.delete(c.me.id);
  (n.skip ?? []).forEach((id) => ids.delete(id));

  const told: string[] = [];
  if (ids.size && (scheme.bell || scheme.email || (n.extra?.length ?? 0) > 0)) {
    const [viewers, optouts] = await Promise.all([
      viewersOf(c.db, [...ids]),
      c.db
        .prepare(`SELECT user_id FROM notification_optouts WHERE event = ? AND user_id IN (${[...ids].map(() => "?").join(", ")})`)
        .bind(event, ...ids)
        .all<{ user_id: string }>(),
    ]);
    const out = new Set(optouts.results.map((o) => o.user_id));
    for (const id of ids) {
      const v = viewers.get(id);
      if (!v || out.has(id)) continue;
      if (!(await canSeeItem(c.db, v, r))) continue;
      told.push(id);
    }
  }
  const alerts: Alert[] = told.map((userId) => ({
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
