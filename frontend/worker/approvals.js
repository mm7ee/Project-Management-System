/** @import { ItemContext, ItemRow } from './workitems' */
/** @import { ApprovalView, Transition } from '../src/data/workflows' */
// Approvals on workflow moves. A move with an "Approval is needed" rule (a validator, src/data/workflows.js) doesn't
// happen at once: it becomes a pending approval, and the item waits (no other move until it's decided or
// cancelled). Who approves:
//   user:<id>        a named person
//   role:<role>      anyone in the workspace with that role
//   users:<id,id,…>  some of these people, `needed` of them (N of M)
// The person asking never approves their own move. Each approver approves or rejects once; a rejection needs a
// reason and ends it at once. Enough approvals make the move, with what the requester sent with it (its comment and
// fields), and its post-functions. Someone who isn't an approver, or an approval in another workspace, gets the same
// 404 as one that doesn't exist.
import { newToken } from "./auth";
import { HttpError, body, json } from "./http";
import { addComment, itemById, itemByKey, keyOf } from "./workitems";

/**
 * An approval rule's settings, from its value: { who, needed }.
 * @param {string | null | undefined} value
 * @returns {{ who: string; needed: number }}
 */
export function approvalRule(value) {
  try {
    const v = JSON.parse(value ?? "{}");
    return { who: String(v.who ?? ""), needed: Math.max(1, Math.round(Number(v.needed ?? 1))) };
  } catch {
    return { who: "", needed: 1 };
  }
}
/**
 * Checks an approval rule's value as a workflow saves it.
 * @param {string | null} value
 * @returns {string}
 */
export function cleanApprovalValue(value) {
  const r = approvalRule(value);
  if (!/^(user:[a-z0-9._-]{1,80}|role:[a-z_]{2,20}|users:[a-z0-9._-]{1,80}(,[a-z0-9._-]{1,80}){0,19})$/.test(r.who)) throw new HttpError(400, "An approval needs a person, a role, or a list of people");
  if (r.who.startsWith("users:") && r.needed > r.who.slice(6).split(",").length) throw new HttpError(400, "More approvals needed than there are people to give them");
  if (!r.who.startsWith("users:") && r.who.startsWith("user:") && r.needed !== 1) throw new HttpError(400, "One person gives one approval");
  return JSON.stringify(r);
}
/**
 * The people who may approve: active members of this workspace (it's read through its handle), never the requester.
 * @param {ItemContext} c
 * @param {string} who
 * @param {string} requester
 * @returns {Promise<string[]>}
 */
async function approversFor(c, who, requester) {
  /** @type {{ id: string }[]} */ let rows = [];
  if (who.startsWith("role:")) rows = /** @type {{ id: string }[]} */ ((await c.db.prepare("SELECT id FROM users WHERE role = ? AND deactivated_at IS NULL ORDER BY id").bind(who.slice(5)).all()).results);
  else {
    const ids = who.startsWith("user:") ? [who.slice(5)] : who.slice(6).split(",");
    rows = /** @type {{ id: string }[]} */ (
      (
        await c.db
          .prepare(`SELECT id FROM users WHERE id IN (${ids.map(() => "?").join(", ")}) AND deactivated_at IS NULL ORDER BY id`)
          .bind(...ids)
          .all()
      ).results
    );
  }
  return rows.map((r) => r.id).filter((id) => id !== requester);
}

/**
 * The pending approval on an item, if any.
 * @param {D1Database} db
 * @param {string} itemId
 */
export async function pendingApproval(db, itemId) {
  return /** @type {ApprovalRow | null} */ (await db.prepare("SELECT * FROM approvals WHERE item_id = ? AND status = 'pending'").bind(itemId).first());
}

/**
 * Asks for approval of a move instead of making it.
 * @param {ItemContext} c
 * @param {ItemRow} r
 * @param {Transition} t
 * @param {{ comment: string; fields: Record<string, unknown> }} with_
 * @returns {Promise<ApprovalView>}
 */
export async function requestApproval(c, r, t, with_) {
  const rule = approvalRule(t.rules.find((x) => x.rule === "approval")?.value);
  const approvers = await approversFor(c, rule.who, c.me.id);
  if (!approvers.length) throw new HttpError(409, `"${t.name}" needs an approval, and there's nobody (other than you) who can give it`, "no_approvers");
  const needed = Math.min(rule.needed, approvers.length);
  const id = newToken().slice(0, 16);
  try {
    await c.db
      .prepare("INSERT INTO approvals (id, item_id, transition_id, transition_name, from_status, to_status, comment, fields, approvers, needed, requested_by, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, r.id, t.id, t.name, r.status, t.to, with_.comment, JSON.stringify(with_.fields), JSON.stringify(approvers), needed, c.me.id, c.now)
      .run();
  } catch {
    throw new HttpError(409, "This item is already waiting for an approval", "approval_pending");
  }
  const key = keyOf(r);
  c.alert(
    approvers.map((userId) => ({
      userId,
      kind: /** @type {const} */ ("approval"),
      title: `${c.me.name} asks you to approve: ${key} → ${t.name}`.slice(0, 200),
      body: `${key} ${r.summary}`.slice(0, 500),
      link: `#/projects/${r.system_id}/items/${key}`,
      dedupe: `approval:${id}:${userId}`,
    })),
  );
  await c.audit("approval_requested", r.system_id, { key, summary: r.summary, move: t.name, needed, approvers: approvers.length });
  return /** @type {ApprovalView} */ (await viewOf(c.db, /** @type {ApprovalRow} */ (await c.db.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first())));
}

/**
 * @param {D1Database} db
 * @param {ApprovalRow} a
 * @returns {Promise<ApprovalView>}
 */
export async function viewOf(db, a) {
  const votes = /** @type {{ user_id: string; decision: "approve" | "reject"; comment: string; at: string }[]} */ ((await db.prepare("SELECT user_id, decision, comment, at FROM approval_votes WHERE approval_id = ? ORDER BY at").bind(a.id).all()).results);
  const ids = [...new Set([a.requested_by, ...JSON.parse(a.approvers), ...votes.map((v) => v.user_id)])];
  const names = new Map(
    (/** @type {{ id: string; name: string }[]} */ (
      (
        await db
          .prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
          .bind(...ids)
          .all()
      ).results
    )).map((u) => [u.id, u.name]),
  );
  const to = /** @type {{ name: string } | null} */ (await db.prepare("SELECT name FROM work_statuses WHERE id = ?").bind(a.to_status).first());
  return {
    id: a.id,
    move: a.transition_name,
    toStatus: to?.name ?? a.to_status,
    status: a.status,
    requestedBy: names.get(a.requested_by) ?? "a former user",
    requestedById: a.requested_by,
    requestedAt: a.requested_at,
    approvers: /** @type {string[]} */ (JSON.parse(a.approvers)).map((id) => ({ id, name: names.get(id) ?? "a former user" })),
    needed: a.needed,
    approvals: votes.filter((v) => v.decision === "approve").length,
    votes: votes.map((v) => ({ userId: v.user_id, by: names.get(v.user_id) ?? "a former user", decision: v.decision, comment: v.comment, at: v.at })),
    ...(a.decided_at ? { decidedAt: a.decided_at } : {}),
    ...(a.reason ? { reason: a.reason } : {}),
  };
}

/**
 * /api/approvals… and /api/items/:key/approvals.
 * @param {ItemContext} c
 * @param {string} path
 * @param {string} method
 * @param {(c: ItemContext, r: ItemRow, m: { transitionId: string; comment?: string; fields?: Record<string, unknown> }, opts: { approved: true }) => Promise<{ after: ItemRow }>} move
 * @returns {Promise<Response | null>}
 */
export async function approvalsApi(c, path, method, move) {
  const itemList = path.match(/^\/api\/items\/([A-Z][A-Z0-9]{1,9}-\d{1,7})\/approvals$/);
  if (!path.startsWith("/api/approvals") && !itemList) return null;
  const { db, req } = c;
  if (c.guest) throw new HttpError(403, "This link is view-only");
  if (itemList && method === "GET") {
    const r = await itemByKey(c, itemList[1]);
    const rows = /** @type {ApprovalRow[]} */ ((await db.prepare("SELECT * FROM approvals WHERE item_id = ? ORDER BY requested_at DESC LIMIT 20").bind(r.id).all()).results);
    return json(await Promise.all(rows.map((a) => viewOf(db, a))));
  }
  // Waiting for me.
  if (path === "/api/approvals" && method === "GET") {
    const rows = /** @type {(ApprovalRow & { key: string; summary: string; system_id: string })[]} */ (
      (
        await db
          .prepare(
            `SELECT a.*, s.key || '-' || w.number AS key, w.summary, w.system_id FROM approvals a JOIN work_items w ON w.id = a.item_id JOIN systems s ON s.id = w.system_id
             WHERE a.status = 'pending' AND a.approvers::jsonb @> jsonb_build_array(?::text) AND NOT EXISTS (SELECT 1 FROM approval_votes v WHERE v.approval_id = a.id AND v.user_id = ?) ORDER BY a.requested_at`,
          )
          .bind(c.me.id, c.me.id)
          .all()
      ).results
    );
    return json(await Promise.all(rows.map(async (a) => ({ ...(await viewOf(db, a)), itemKey: a.key, summary: a.summary, systemId: a.system_id }))));
  }
  const m = path.match(/^\/api\/approvals\/([a-f0-9]{16})\/(approve|reject|cancel)$/);
  if (!m || method !== "POST") throw new HttpError(404, "Not found");
  const a = /** @type {ApprovalRow | null} */ (await db.prepare("SELECT * FROM approvals WHERE id = ?").bind(m[1]).first());
  const approvers = a ? /** @type {string[]} */ (JSON.parse(a.approvers)) : [];
  const b = /** @type {{ comment?: unknown; reason?: unknown }} */ (await body(req).catch(() => ({})));
  if (m[2] === "cancel") {
    // The requester, or someone who may edit any work item.
    if (!a || (a.requested_by !== c.me.id && !c.can("edit_work_items"))) throw new HttpError(404, "Approval not found");
    if (a.status !== "pending") throw new HttpError(409, "It's already decided");
    await db.prepare("UPDATE approvals SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'pending'").bind(c.now, a.id).run();
    await c.audit("approval_cancelled", null, { move: a.transition_name });
    return json(await viewOf(db, /** @type {ApprovalRow} */ ({ ...a, status: "cancelled", decided_at: c.now })));
  }
  // Only its approvers can decide; to anyone else it doesn't exist.
  if (!a || !approvers.includes(c.me.id)) throw new HttpError(404, "Approval not found");
  if (a.status !== "pending") throw new HttpError(409, "It's already decided");
  const r = await itemById(c, a.item_id);
  if (!r) throw new HttpError(404, "Approval not found");
  const key = keyOf(r);
  const link = `#/projects/${r.system_id}/items/${key}`;
  if (m[2] === "reject") {
    const reason = String(b.reason ?? "").trim().slice(0, 1000);
    if (!reason) throw new HttpError(400, "Say why it's rejected", "reason_required");
    const claimed = await db.prepare("UPDATE approvals SET status = 'rejected', decided_at = ?, reason = ? WHERE id = ? AND status = 'pending'").bind(c.now, reason, a.id).run();
    if (!claimed.meta.changes) throw new HttpError(409, "It's already decided");
    await db.prepare("INSERT INTO approval_votes (approval_id, user_id, decision, comment, at) VALUES (?, ?, 'reject', ?, ?)").bind(a.id, c.me.id, reason, c.now).run();
    await addComment(c, r, `Rejected "${a.transition_name}": ${reason}`);
    c.alert([{ userId: a.requested_by, kind: "approval", title: `${c.me.name} rejected ${key} → ${a.transition_name}`.slice(0, 200), body: reason.slice(0, 500), link }]);
    await c.audit("approval_rejected", r.system_id, { key, move: a.transition_name, reason });
    c.emit?.({ type: "approval_rejected", itemId: r.id });
    return json(await viewOf(db, /** @type {ApprovalRow} */ ({ ...a, status: "rejected", decided_at: c.now, reason })));
  }
  // Approve.
  await db
    .prepare("INSERT INTO approval_votes (approval_id, user_id, decision, comment, at) VALUES (?, ?, 'approve', ?, ?) ON CONFLICT DO NOTHING")
    .bind(a.id, c.me.id, String(b.comment ?? "").trim().slice(0, 1000), c.now)
    .run();
  const count = Number((/** @type {{ n: number }} */ (await db.prepare("SELECT COUNT(*) AS n FROM approval_votes WHERE approval_id = ? AND decision = 'approve'").bind(a.id).first())).n);
  if (count < a.needed) {
    await c.audit("approval_given", r.system_id, { key, move: a.transition_name, approvals: count, needed: a.needed });
    return json(await viewOf(db, a));
  }
  const claimed = await db.prepare("UPDATE approvals SET status = 'approved', decided_at = ? WHERE id = ? AND status = 'pending'").bind(c.now, a.id).run();
  if (!claimed.meta.changes) return json(await viewOf(db, a));
  // The move itself, with what the requester sent with it.
  try {
    await move(c, r, { transitionId: a.transition_id, comment: a.comment || undefined, fields: JSON.parse(a.fields) }, { approved: true });
  } catch (e) {
    // The workflow changed meanwhile, or the item moved on: the approval stands, but the move can't be made.
    await db.prepare("UPDATE approvals SET status = 'cancelled', reason = ? WHERE id = ?").bind(`Approved, but the move couldn't be made: ${e instanceof Error ? e.message : "it's no longer possible"}`.slice(0, 1000), a.id).run();
    throw new HttpError(409, `Approved, but the move couldn't be made: ${e instanceof Error ? e.message : "it's no longer possible"}`, "approval_stale");
  }
  c.alert([{ userId: a.requested_by, kind: "approval", title: `Approved: ${key} → ${a.transition_name}`.slice(0, 200), body: `${key} ${r.summary}`.slice(0, 500), link }]);
  await c.audit("approval_granted", r.system_id, { key, move: a.transition_name, approvals: count });
  c.emit?.({ type: "approval_granted", itemId: r.id });
  return json(await viewOf(db, /** @type {ApprovalRow} */ ({ ...a, status: "approved", decided_at: c.now })));
}
/**
 * @typedef {Object} ApprovalRow
 * @property {string} id
 * @property {string} item_id
 * @property {string} transition_id
 * @property {string} transition_name
 * @property {string} from_status
 * @property {string} to_status
 * @property {string} comment
 * @property {string} fields
 * @property {string} approvers
 * @property {number} needed
 * @property {"pending" | "approved" | "rejected" | "cancelled"} status
 * @property {string} requested_by
 * @property {string} requested_at
 * @property {string | null} decided_at
 * @property {string | null} reason
 */
