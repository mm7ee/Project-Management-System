// The clean-up that enforces the retention policy in src/data/retention.ts. Runs each weekday morning
// with the daily-digest cron; deletes are by date, so a missed run just catches up the next time.

import { AUDIT_DAYS, MFA_HELP_DAYS, NOTIFICATION_DAYS, SHARE_LINK_DAYS, SIGNIN_FAILURE_HOURS } from "../src/data/retention";

const DAY = 86_400_000;

export async function purgeExpired(db: D1Database, now = Date.now()): Promise<Record<string, number>> {
  const before = (days: number) => new Date(now - days * DAY).toISOString();
  const steps: [string, D1PreparedStatement][] = [
    ["activity", db.prepare("DELETE FROM activity WHERE at < ?").bind(before(AUDIT_DAYS))],
    ["notifications", db.prepare("DELETE FROM notifications WHERE created_at < ?").bind(before(NOTIFICATION_DAYS))],
    [
      "share_links",
      db
        .prepare("DELETE FROM share_links WHERE COALESCE(revoked_at, expires_at) < ?")
        .bind(before(SHARE_LINK_DAYS)),
    ],
    [
      "mfa_help_requests",
      db.prepare("DELETE FROM mfa_help_requests WHERE status != 'OPEN' AND handled_at < ?").bind(before(MFA_HELP_DAYS)),
    ],
    ["login_failures", db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - SIGNIN_FAILURE_HOURS * 3_600_000)],
    ["sessions", db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)],
    ["mfa_challenges", db.prepare("DELETE FROM mfa_challenges WHERE expires_at < ?").bind(now)],
    ["webauthn_challenges", db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(now)],
    ["mfa_recovery", db.prepare("DELETE FROM mfa_recovery WHERE used_at IS NOT NULL")],
    // Left behind by people removed before every table was cleared on removal.
    ...(["passkeys", "mfa_help_requests", "notifications", "password_history", "login_failures", "work_item_watchers"] as const).map(
      (t): [string, D1PreparedStatement] => [
        `${t} (removed users)`,
        db.prepare(`DELETE FROM ${t} WHERE user_id NOT IN (SELECT id FROM users)`),
      ],
    ),
    // An attachment's file outlives its document only if a removal was interrupted.
    ["document_chunks (orphaned)", db.prepare("DELETE FROM document_chunks WHERE doc_id NOT IN (SELECT id FROM documents)")],
  ];
  const results = await db.batch(steps.map(([, s]) => s));
  return Object.fromEntries(steps.map(([name], i) => [name, results[i].meta.changes ?? 0]));
}
