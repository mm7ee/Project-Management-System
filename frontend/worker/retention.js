// The clean-up that enforces the retention policy in src/data/retention.ts. Runs each weekday morning
// with the daily-digest cron; deletes are by date, so a missed run just catches up the next time.
import { API_USAGE_HOURS, AUDIT_DAYS, AUTOMATION_RUN_DAYS, EXPIRED_TOKEN_DAYS, MFA_HELP_DAYS, NOTIFICATION_DAYS, SHARE_LINK_DAYS, SIGNIN_FAILURE_HOURS, WEBHOOK_DELIVERY_DAYS } from "../src/data/retention";
import { RESET_KEEP_HOURS } from "../src/data/passwordReset";
const DAY = 86_400_000;
/**
 * @param {D1Database} db
 * @param {number} [now=Date.now()]
 * @returns {Promise<Record<string, number>>}
 */
export async function purgeExpired(db, now = Date.now()) {
  const before = /** @param {number} days */ (days) => new Date(now - days * DAY).toISOString();
  /** @type {[string, D1PreparedStatement][]} */ const steps = [
    ["activity", db.prepare("DELETE FROM activity WHERE at < ?").bind(before(AUDIT_DAYS))],
    ["notifications", db.prepare("DELETE FROM notifications WHERE created_at < ?").bind(before(NOTIFICATION_DAYS))],
    ["share_links", db.prepare("DELETE FROM share_links WHERE COALESCE(revoked_at, expires_at) < ?").bind(before(SHARE_LINK_DAYS))],
    ["mfa_help_requests", db.prepare("DELETE FROM mfa_help_requests WHERE status != 'OPEN' AND handled_at < ?").bind(before(MFA_HELP_DAYS))],
    ["login_failures", db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - SIGNIN_FAILURE_HOURS * 3_600_000)],
    ["password_resets", db.prepare("DELETE FROM password_resets WHERE created_at < ?").bind(now - RESET_KEEP_HOURS * 3_600_000)],
    ["automation_runs", db.prepare("DELETE FROM automation_runs WHERE at < ?").bind(before(AUTOMATION_RUN_DAYS))],
    ["webhook_deliveries", db.prepare("DELETE FROM webhook_deliveries WHERE created_at < ?").bind(before(WEBHOOK_DELIVERY_DAYS))],
    ["github_deliveries", db.prepare("DELETE FROM github_deliveries WHERE received_at < ?").bind(before(WEBHOOK_DELIVERY_DAYS))],
    ["api_token_usage", db.prepare("DELETE FROM api_token_usage WHERE minute < ?").bind(Math.floor((now - API_USAGE_HOURS * 3_600_000) / 60_000))],
    ["api_tokens", db.prepare("DELETE FROM api_tokens WHERE COALESCE(revoked_at, expires_at) < ?").bind(before(EXPIRED_TOKEN_DAYS))],
    ["portal_links", db.prepare("DELETE FROM portal_links WHERE COALESCE(revoked_at, expires_at) < ?").bind(before(EXPIRED_TOKEN_DAYS))],
    ["security_level_grants (removed users)", db.prepare("DELETE FROM security_level_grants WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)")],
    ["sessions", db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)],
    ["mfa_challenges", db.prepare("DELETE FROM mfa_challenges WHERE expires_at < ?").bind(now)],
    ["webauthn_challenges", db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(now)],
    ["mfa_recovery", db.prepare("DELETE FROM mfa_recovery WHERE used_at IS NOT NULL")],
    // Left behind by people removed before every table was cleared on removal.
    .../** @type {const} */ (["passkeys", "mfa_help_requests", "notifications", "password_history", "login_failures", "work_item_watchers", "filter_favourites", "filter_subscriptions", "notification_optouts", "api_tokens"]).map(
      /** @returns {[string, D1PreparedStatement]} */ (t) => [`${t} (removed users)`, db.prepare(`DELETE FROM ${t} WHERE user_id NOT IN (SELECT id FROM users)`)],
    ),
    // An attachment's file outlives its document only if a removal was interrupted.
    ["document_chunks (orphaned)", db.prepare("DELETE FROM document_chunks WHERE doc_id NOT IN (SELECT id FROM documents)")],
    // Chat files uploaded but never sent (the composer was closed): gone after a day. Chunks follow by cascade.
    ["chat_files (never sent)", db.prepare("DELETE FROM chat_files WHERE message_id IS NULL AND uploaded_at < ?").bind(before(1))],
  ];
  const results = await db.batch(steps.map(([, s]) => s));
  return Object.fromEntries(steps.map(([name], i) => [name, results[i].meta.changes ?? 0]));
}
