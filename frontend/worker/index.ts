// Pulse Worker: serves the built app (ASSETS) and the JSON API under /api.
// Every permission check happens here; the UI only hides what a user can't do.

import {
  hashPassword,
  newRecoveryCodes,
  newToken,
  newTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  sealSecret,
  tempPassword,
  tokenHash,
  totpUri,
  verifyPassword,
  verifyTotp,
} from "./auth";
import { STATUS_META, initials, type Status, type System } from "../src/data/systems";
import {
  FEATURE_KINDS,
  FEATURE_STATUSES,
  PRIORITIES,
  type Feature,
} from "../src/data/features";
import { DEFAULT_LIMITS, DEFAULT_WORKSPACES, MAX_DOCUMENT_BYTES, formatBytes, type Blocker, type Limits, type ProjectDocument } from "../src/data/project";
import { buildShowcase } from "../src/data/showcase";
import { PASSWORD_HISTORY, passwordProblem } from "../src/data/password";
import { SESSION_DAYS, SIGNIN_FAILURE_HOURS } from "../src/data/retention";
import { DEFAULT_SIGNIN_RULES, SIGNIN_WINDOW_MINUTES, cleanSigninRules, lockMinutesFor, signinRefusal, type SigninRules } from "../src/data/signin";
import { purgeExpired } from "./retention";
import type { ProjectTemplate } from "../src/data/templates";
import { awaitingSignature, cleanPcn, pcnStatus, type Pcn, type Signatory } from "../src/data/pcn";
import { MAX_QUESTION, askStream, buildSnapshot, buildWorkFocus, type AskMode, type AskPerson, type AskTurn } from "./ask";
import { newChallenge, readClientData, verifyAssertion, verifyRegistration } from "./webauthn";
import { noteFailure, postToTeams, raise, readDelivery, sendEmail, emailFor, type Alert, type ChannelPost, type Delivery } from "./notify";
import { runBriefing, runDailyDigests } from "./digest";
import { toFeature, type FeatureRow } from "./rows";
import { pgDatabase } from "./pg";
import { HttpError, body, json } from "./http";
import { KEY_PATTERN, suggestKey } from "../src/data/workitems";
import {
  applyChange,
  askItemLines,
  createItem,
  deleteItem,
  featureToItem,
  afterChange,
  moveFeatureTo,
  itemById,
  itemsApi,
  recomputeProgress,
  type ItemContext,
} from "./workitems";
import { workflowsApi } from "./workflows";
import { askBoardLines, boardsApi } from "./boards";
import { sprintHealth, sprintsApi } from "./sprints";
import { askSearchLines, runSubscriptions, searchApi } from "./search";
import { askAutomationLines, automationApi, runEvent, runScheduledRules } from "./automation";
import { dueJobs } from "./schedule";
import { askIntegrationLines, githubWebhook, integrationsApi, retryWebhooks, tokenAuth } from "./integrations";
import { askServiceDeskLines, portalApi, runSlaChecks, serviceDeskApi } from "./servicedesk";
import { customFieldsApi } from "./customfields";
import { adminApi } from "./admin";
import { levelsFor } from "./access";

/** Requests made with a personal API token, and the token's name, for the activity log. */
const VIA_TOKEN = new WeakMap<Request, string>();
import { EFFECTIVE_WORKFLOW, loadWorkflow } from "./workflowData";
import type { AppNotification, DeliveryStatus, Digest, NotificationKind } from "../src/data/notifications";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLES,
  ROLE_LABEL,
  type MfaPolicy,
  START_KEYS,
  cleanPrefs,
  mfaRequiredFor,
  permissionsFor,
  type Permission,
  type Role,
  type RolePermissions,
  type UpdateRequest,
  type User,
} from "../src/data/roles";

const COOKIE = "omni_session";
/** Ask Pulse: questions per person per window, kept per Worker instance (a guard, not a quota). */
const ASK_LIMIT = 20;
const ASK_WINDOW_MS = 10 * 60_000;
const askLog = new Map<string, number[]>();


interface UserRow {
  id: string;
  username: string;
  name: string;
  title: string;
  email: string | null;
  phone: string | null;
  role: Role;
  password_hash: string;
  prefs: string;
  must_change_password: number;
  mfa_secret: string | null;
  mfa_pending: string | null;
  mfa_last_step: number;
  mfa_enabled_at: string | null;
  locked_until: number | null;
  locked_at: string | null;
}

const toUser = (r: UserRow, projectIds: string[] = []): User => ({
  id: r.id,
  username: r.username,
  name: r.name,
  title: r.title,
  role: r.role,
  ...(r.email ? { email: r.email } : {}),
  ...(r.phone ? { phone: r.phone } : {}),
  ...(projectIds.length ? { projectIds } : {}),
  ...(r.must_change_password ? { mustChangePassword: true } : {}),
  ...(r.mfa_secret ? { mfaEnabled: true } : {}),
});

interface ShareLinkRow {
  id: string;
  token_hash: string;
  label: string;
  created_by: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  views: number;
}

/** Who a view-only link browses as: no account, no password, read-only. */
const guestUser = (l: ShareLinkRow): UserRow => ({
  id: `share-${l.id}`,
  username: "view-only",
  name: `${l.label} (view-only link)`,
  title: l.label,
  email: null,
  phone: null,
  role: "viewer",
  password_hash: "",
  prefs: "{}",
  must_change_password: 0,
  mfa_secret: null,
  mfa_pending: null,
  mfa_last_step: 0,
  mfa_enabled_at: null,
  locked_until: null,
  locked_at: null,
});

interface TemplateRow {
  id: string;
  name: string;
  summary: string;
  data: string;
  created_by: string | null;
  created_at: string;
}

const toTemplate = (r: TemplateRow): ProjectTemplate => ({
  id: r.id,
  name: r.name,
  summary: r.summary,
  ...(JSON.parse(r.data) as Pick<ProjectTemplate, "description" | "status" | "progress" | "durationWeeks">),
  ...(r.created_by ? { createdBy: r.created_by } : {}),
  createdAt: r.created_at,
});

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}


function cookieToken(req: Request): string | null {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function sessionCookie(token: string, req: Request, maxAge: number): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------- data access ----------

async function roleMatrix(db: D1Database): Promise<RolePermissions> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'role_permissions'").first<{ value: string }>();
  return row ? { ...DEFAULT_ROLE_PERMISSIONS, ...JSON.parse(row.value) } : DEFAULT_ROLE_PERMISSIONS;
}

// ---------- two-step verification ----------

const MFA_TICKET_MINUTES = 5;
const MFA_MAX_ATTEMPTS = 5;

function mfaKey(env: Env): string {
  if (!env.MFA_KEY) throw new HttpError(500, "Two-step verification isn't configured on the server (MFA_KEY is missing)");
  return env.MFA_KEY;
}

/** Which roles must use two-step verification. Set by an admin; nobody until then. */
async function mfaPolicy(db: D1Database): Promise<MfaPolicy> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'mfa_policy'").first<{ value: string }>();
  const roles = row ? (JSON.parse(row.value).roles as unknown[]) : [];
  return { roles: ROLES.filter((r) => roles.includes(r)) };
}

/** Two-step verification is on when the user has an authenticator app or at least one passkey. */
async function passkeyCount(db: D1Database, userId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(userId).first<{ n: number }>())!.n;
}
async function hasMfa(db: D1Database, row: UserRow): Promise<boolean> {
  return !!row.mfa_secret || (await passkeyCount(db, row.id)) > 0;
}

/** Where WebAuthn responses must come from: this site's origin, with its host name as the RP ID. */
function webauthnSite(req: Request) {
  const url = new URL(req.url);
  return { origin: url.origin, rpId: url.hostname };
}

/** Signs the user out everywhere except this browser: after a sign-in method is revoked. */
async function endOtherSessions(db: D1Database, req: Request, userId: string) {
  const token = cookieToken(req);
  await db
    .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
    .bind(userId, token ? await tokenHash(token) : "")
    .run();
}

/** Turns two-step verification fully off once no method is left: recovery codes go too. */
function clearMfaIfEmpty(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        "UPDATE users SET mfa_enabled_at = NULL WHERE id = ? AND mfa_secret IS NULL AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?)",
      )
      .bind(userId, userId),
    db
      .prepare(
        "DELETE FROM mfa_recovery WHERE user_id = ? AND (SELECT mfa_secret FROM users WHERE id = ?) IS NULL AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?)",
      )
      .bind(userId, userId, userId),
  ];
}

/**
 * Accepts a current authenticator code (once only) or an unused recovery code.
 * Returns how the user got in ("app" or "recovery"), or null.
 */
async function checkSecondFactor(db: D1Database, env: Env, row: UserRow, code: string): Promise<"app" | "recovery" | null> {
  // Passkey-only accounts have no app secret but can still use recovery codes.
  const step = row.mfa_secret ? await verifyTotp(await openSecret(row.mfa_secret, mfaKey(env)), code) : null;
  if (step !== null) {
    // Each code works once, even inside its 30-second window.
    const claimed = await db.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ? AND mfa_last_step < ?").bind(step, row.id, step).run();
    return claimed.meta.changes ? "app" : null;
  }
  const recovery = normalizeRecoveryCode(code);
  if (recovery.length !== 8) return null;
  const spent = await db
    .prepare("UPDATE mfa_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
    .bind(new Date().toISOString(), row.id, await tokenHash(recovery))
    .run();
  return spent.meta.changes ? "recovery" : null;
}

/** Stores fresh recovery codes (hashed) in place of any old ones and returns them, shown once. */
async function issueRecoveryCodes(db: D1Database, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.batch([
    db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").bind(userId),
    ...(await Promise.all(
      codes.map(async (c) => db.prepare("INSERT INTO mfa_recovery (user_id, code_hash) VALUES (?, ?)").bind(userId, await tokenHash(normalizeRecoveryCode(c)))),
    )),
  ]);
  return codes;
}

async function startSession(db: D1Database, req: Request, row: UserRow, detail: Record<string, unknown>): Promise<Response> {
  const token = newToken();
  await db.batch([
    db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await tokenHash(token), row.id, Date.now() + SESSION_DAYS * 86_400_000),
    // A full sign-in starts the count of wrong passwords again.
    db.prepare("DELETE FROM login_failures WHERE user_id = ?").bind(row.id),
  ]);
  await audit(db, req, row, "login", null, { ...detail, ...(row.must_change_password ? { temporaryPassword: true } : {}) });
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, req, SESSION_DAYS * 86_400) });
}

// ---------- sign-in lockout ----------
// Every failed password (and wrong two-step code) is a row in login_failures, so the limits hold
// across every copy of the Worker. Too many on one account locks it; too many from one address
// refuses that address. Either way the person sees the same message as a wrong password.

async function signinRules(db: D1Database): Promise<SigninRules> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'signin_rules'").first<{ value: string }>();
  return row ? cleanSigninRules(JSON.parse(row.value)) : DEFAULT_SIGNIN_RULES;
}

type FailureReason = "password" | "two_step" | "locked" | "address";

/** Records one failure, and clears out any older than the retention period while it's there. */
async function recordFailure(db: D1Database, req: Request, f: { username: string; userId: string | null; reason: FailureReason; at: number }) {
  await db.batch([
    db
      .prepare("INSERT INTO login_failures (id, at, username, user_id, ip, reason) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(newToken().slice(0, 16), f.at, f.username.toLowerCase().slice(0, 64), f.userId, req.headers.get("cf-connecting-ip"), f.reason),
    db.prepare("DELETE FROM login_failures WHERE at < ?").bind(f.at - SIGNIN_FAILURE_HOURS * 3_600_000),
  ]);
}

/** Failed sign-ins from this request's address within the window. */
async function addressFailures(db: D1Database, req: Request, since: number): Promise<number> {
  const ip = req.headers.get("cf-connecting-ip");
  if (!ip) return 0;
  return (await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?").bind(ip, since).first<{ n: number }>())!.n;
}

const isLocked = (row: { locked_until: number | null }, at = Date.now()) => !!row.locked_until && row.locked_until > at;

/** Checked against when there's no account, so an unknown username takes as long as a real one. */
const DUMMY_HASH = `pbkdf2$100000$${"00".repeat(16)}$${"00".repeat(32)}`;

/**
 * After a failure on a real account: locks it once it has had too many within the window. Failures
 * from before its last lock ended don't count again. Administrators are told under the bell.
 */
async function lockIfNeeded(env: Env, ctx: ExecutionContext, req: Request, row: UserRow, rules: SigninRules, at: number) {
  const db = env.DB;
  const since = Math.max(at - SIGNIN_WINDOW_MINUTES * 60_000, row.locked_until ?? 0);
  const failures = (
    await db
      .prepare("SELECT COUNT(*) AS n FROM login_failures WHERE user_id = ? AND reason IN ('password', 'two_step') AND at > ?")
      .bind(row.id, since)
      .first<{ n: number }>()
  )!.n;
  if (failures < rules.attempts) return;
  const minutes = lockMinutesFor(row, rules);
  const until = at + minutes * 60_000;
  // Only the first request over the limit locks it, if two arrive at once.
  const done = await db
    .prepare("UPDATE users SET locked_until = ?, locked_at = ? WHERE id = ? AND (locked_until IS NULL OR locked_until <= ?)")
    .bind(until, new Date(at).toISOString(), row.id, at)
    .run();
  if (!done.meta.changes) return;
  await audit(db, req, row, "account_locked", row.id, {
    name: row.name,
    username: row.username,
    failures,
    minutes,
    until: new Date(until).toISOString(),
  });
  const matrix = await roleMatrix(db);
  const people = await db.prepare("SELECT id, role FROM users").all<{ id: string; role: Role }>();
  const alerts: Alert[] = people.results
    .filter((u) => permissionsFor(u.role, matrix).includes("manage_users"))
    .map((u) => ({
      userId: u.id,
      kind: "account_locked" as const,
      title: `${row.name}'s account is locked`,
      body: `${failures} failed sign-ins in ${SIGNIN_WINDOW_MINUTES} minutes. It unlocks itself in ${minutes} minutes, or you can unlock it now in Settings → People.`,
      link: "view:users",
      dedupe: `locked:${row.id}:${until}`,
    }));
  ctx.waitUntil(raise(env, alerts).catch((e) => noteFailure(db, "Notification", e)));
}

/** The workspace list (settings key "workspaces"), or the defaults until someone edits it. */
async function workspaceList(db: D1Database): Promise<string[]> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'workspaces'").first<{ value: string }>();
  return row ? (JSON.parse(row.value) as string[]) : DEFAULT_WORKSPACES;
}

async function workloadLimits(db: D1Database): Promise<Limits> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'workload_limits'").first<{ value: string }>();
  return row ? { ...DEFAULT_LIMITS, ...JSON.parse(row.value) } : DEFAULT_LIMITS;
}

async function currentUser(req: Request, db: D1Database): Promise<UserRow | null> {
  const token = cookieToken(req);
  if (!token) return null;
  return db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(await tokenHash(token), Date.now())
    .first<UserRow>();
}

/** A project as stored: its details as JSON, with its key and progress setting in their own columns. */
interface SystemRow {
  data: string;
  key: string;
  progress_from_items: number;
  has_items?: boolean;
  agile_mode?: "kanban" | "scrum";
}
const toSystem = (r: SystemRow): System => ({
  ...JSON.parse(r.data),
  key: r.key,
  ...(r.progress_from_items ? { progressFromItems: true } : {}),
  ...(r.has_items ? { hasWorkItems: true } : {}),
  agileMode: r.agile_mode ?? "kanban",
});
/** What goes in the JSON column: the key and progress setting live in their own columns. */
const systemData = (s: System) => {
  const { key: _key, progressFromItems: _p, hasWorkItems: _h, agileMode: _a, ...rest } = s;
  return JSON.stringify(rest);
};

async function getSystem(db: D1Database, id: string): Promise<System> {
  const row = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(id).first<{ data: string }>();
  if (!row) throw new HttpError(404, "System not found");
  return JSON.parse(row.data);
}

/** The projects a developer is assigned to. */
async function projectsOf(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db.prepare("SELECT system_id FROM assignments WHERE user_id = ?").bind(userId).all<{ system_id: string }>();
  return rows.results.map((r) => r.system_id);
}

async function adminCount(db: D1Database): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>())!.n;
}

// ---------- validation ----------

const STATUSES = Object.keys(STATUS_META) as Status[];

function checkStatus(s: unknown): Status {
  if (!STATUSES.includes(s as Status)) throw new HttpError(400, "Unknown status");
  return s as Status;
}

function checkProgress(p: unknown): number {
  const n = Number(p);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, "Progress must be 0–100");
  return Math.round(n);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(v as T)) throw new HttpError(400, `Unknown ${field}`);
  return v as T;
}

/** An optional YYYY-MM-DD date; empty clears it. */
function checkDate(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${field} must be a date`);
  }
  return v;
}

/** A project key: 2 to 10 capital letters. */
function checkKey(v: unknown): string {
  const key = String(v ?? "").trim().toUpperCase();
  if (!KEY_PATTERN.test(key)) throw new HttpError(400, "A project key is 2 to 10 capital letters, such as INFRA");
  return key;
}

function checkRole(r: unknown): Role {
  if (!ROLES.includes(r as Role)) throw new HttpError(400, "Unknown role");
  return r as Role;
}

/** A new password must meet the policy: 12+ characters, letters, numbers, symbols, not your name. */
function checkPassword(p: unknown, who: { username?: string; name?: string }): string {
  if (typeof p !== "string") throw new HttpError(400, "Password is required");
  const problem = passwordProblem(p, who);
  if (problem) throw new HttpError(400, problem, "password_policy");
  return p;
}

/** Refuses the current password and the previous ones kept in password_history. */
async function checkNotReused(db: D1Database, userId: string, fresh: string, currentHash: string) {
  const old = await db
    .prepare("SELECT hash FROM password_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT ?")
    .bind(userId, PASSWORD_HISTORY - 1)
    .all<{ hash: string }>();
  for (const h of [currentHash, ...old.results.map((r) => r.hash)]) {
    if (await verifyPassword(fresh, h)) {
      throw new HttpError(400, `Choose a password you haven't used before: your last ${PASSWORD_HISTORY} can't be reused`, "password_reused");
    }
  }
}

/** Statements that keep the outgoing hash in the history, trimmed to what the reuse check reads. */
function rememberPassword(db: D1Database, userId: string, outgoingHash: string, at: string): D1PreparedStatement[] {
  return [
    db.prepare("INSERT INTO password_history (user_id, hash, changed_at) VALUES (?, ?, ?)").bind(userId, outgoingHash, at),
    db
      .prepare(
        `DELETE FROM password_history WHERE user_id = ? AND rowid NOT IN
         (SELECT rowid FROM password_history WHERE user_id = ? ORDER BY changed_at DESC LIMIT ?)`,
      )
      .bind(userId, userId, PASSWORD_HISTORY - 1),
  ];
}

const text = (v: unknown, field: string, required = false): string | undefined => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new HttpError(400, `${field} must be text`);
  return v.trim().slice(0, 500);
};

// ---------- audit trail ----------

/** Appends one entry to the activity log. Never fails the request it describes. */
async function audit(
  db: D1Database,
  req: Request,
  who: { id: string | null; name: string },
  action: string,
  target: string | null = null,
  detail: Record<string, unknown> = {},
) {
  try {
    await db
      .prepare("INSERT INTO activity (at, user_id, actor, action, target, detail, ip, agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        new Date().toISOString(),
        who.id,
        who.name.slice(0, 64),
        action,
        target,
        JSON.stringify(VIA_TOKEN.has(req) ? { ...detail, viaApiToken: VIA_TOKEN.get(req) } : detail),
        req.headers.get("cf-connecting-ip"),
        (req.headers.get("user-agent") ?? "").slice(0, 300),
      )
      .run();
  } catch (e) {
    console.error("audit write failed", e);
  }
}

/** Activity about work items: developers who see only their own items see only their own entries. */
const ITEM_ACTIONS = new Set([
  "work_item_created",
  "work_item_updated",
  "work_item_deleted",
  "comment_added",
  "comment_edited",
  "comment_deleted",
  "link_added",
  "link_removed",
  "attachment_added",
  "attachment_removed",
  "time_logged",
  "time_log_deleted",
  "work_item_watched",
  "work_item_unwatched",
]);

const ACTIVITY_KINDS: Record<string, string[]> = {
  signin: ["login", "logout", "logout_all"],
  failed: ["login_failed", "account_locked", "signin_ip_blocked"],
  account: ["password_changed", "password_set_after_reset", "profile_updated", "mfa_enabled", "mfa_disabled", "mfa_recovery_regenerated"],
  systems: ["system_created", "system_progress", "system_updated", "system_developers", "system_deleted", "request_created", "request_dismissed", "template_created", "template_deleted", "pcn_updated", "pcn_signed"],
  features: ["feature_created", "feature_updated", "feature_deleted"],
  workflows: ["workflow_created", "workflow_updated", "workflow_deleted", "workflow_assigned", "status_created", "status_updated", "status_deleted", "work_items_moved", "board_updated"],
  search: ["filter_created", "filter_updated", "filter_deleted", "filter_subscribed", "filter_unsubscribed", "dashboard_created", "dashboard_updated", "dashboard_deleted"],
  automation: ["automation_rule_created", "automation_rule_updated", "automation_rule_deleted", "automation_rule_run"],
  integrations: ["integration_updated", "api_token_created", "api_token_revoked", "webhook_created", "webhook_updated", "webhook_deleted"],
  schemes: [
    "notification_scheme_updated",
    "notification_optouts_updated",
    "security_level_created",
    "security_level_updated",
    "security_level_deleted",
    "custom_field_created",
    "custom_field_updated",
    "custom_field_deleted",
  ],
  service_desk: ["service_request_raised", "service_desk_updated", "request_type_created", "request_type_updated", "request_type_deleted", "holidays_updated", "portal_link_created", "portal_link_revoked"],
  sprints: ["sprint_created", "sprint_updated", "sprint_deleted", "sprint_started", "sprint_completed", "sprint_scope_changed", "backlog_ranked"],
  items: [
    "work_item_created",
    "work_item_updated",
    "work_item_deleted",
    "comment_added",
    "comment_edited",
    "comment_deleted",
    "link_added",
    "link_removed",
    "attachment_added",
    "attachment_removed",
    "time_logged",
    "time_log_deleted",
    "work_item_watched",
    "work_item_unwatched",
  ],
  project: ["document_added", "document_removed", "blocker_raised", "blocker_resolved", "blocker_reopened", "blocker_deleted"],
  admin: ["user_created", "user_updated", "user_password_reset", "user_deleted", "roles_updated", "limits_updated", "mfa_reset", "mfa_policy_updated", "delivery_updated", "digest_sent", "account_unlocked", "signin_rules_updated"],
};

// ---------- email and Teams settings ----------

const TEAMS_HOSTS = [".logic.azure.com", ".powerplatform.com", ".powerautomate.com"];

function checkTeamsWebhook(v: string): string {
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw new HttpError(400, "That Teams address doesn't look right");
  }
  if (url.protocol !== "https:" || !TEAMS_HOSTS.some((h) => url.hostname.endsWith(h))) {
    throw new HttpError(400, "Use the webhook address from a Teams Workflow: it starts with https:// and ends in logic.azure.com or powerplatform.com");
  }
  return url.toString();
}

async function deliveryStatus(db: D1Database): Promise<DeliveryStatus> {
  const [delivery, failure, demo] = await Promise.all([
    readDelivery(db),
    db.prepare("SELECT value FROM settings WHERE key = 'delivery_error'").first<{ value: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM systems WHERE id LIKE 'demo-%'").first<{ n: number }>(),
  ]);
  return {
    email: { configured: !!delivery.resendKey, from: delivery.from ?? "" },
    teams: { configured: !!delivery.teams },
    briefingEmails: delivery.briefingEmails ?? [],
    ...(failure ? { lastError: JSON.parse(failure.value) } : {}),
    demoProjects: demo?.n ?? 0,
  };
}

/** The installable app's description. A view-only link installs as that link, not the sign-in page. */
function manifest(start: string | null): Response {
  const view = start && /^\/view\/[A-Za-z0-9_-]{20,}\/?$/.test(start) ? start : null;
  return new Response(
    JSON.stringify({
      id: view ?? "/",
      name: "Pulse",
      short_name: "Pulse",
      description: "Omni Contact's project tracker",
      start_url: view ?? "/",
      scope: "/",
      display: "standalone",
      background_color: "#101553",
      theme_color: "#101553",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json", "cache-control": view ? "no-store" : "public, max-age=3600" } },
  );
}

// ---------- the API ----------

async function api(req: Request, env: Env, path: string, ctx: ExecutionContext): Promise<Response> {
  const db = env.DB;
  const method = req.method;

  if (path === "/api/manifest" && method === "GET") return manifest(new URL(req.url).searchParams.get("start"));

  if (path === "/api/login" && method === "POST") {
    const { username, password } = await body<{ username?: string; password?: string }>(req);
    const tried = String(username ?? "").trim().slice(0, 64);
    const rules = await signinRules(db);
    const at = Date.now();
    // Wrong password, unknown username, locked account or a refused address: one message for all,
    // so usernames can't be probed and a lock can't be told apart.
    const refused = new HttpError(401, signinRefusal(rules));
    const since = at - SIGNIN_WINDOW_MINUTES * 60_000;
    if ((await addressFailures(db, req, since)) >= rules.ipAttempts) {
      await recordFailure(db, req, { username: tried, userId: null, reason: "address", at });
      await audit(db, req, { id: null, name: tried || "(blank)" }, "login_failed", null, { username: tried, reason: "too many failed sign-ins from this address" });
      throw refused;
    }
    const row = await db.prepare("SELECT * FROM users WHERE lower(username) = lower(?)").bind(tried).first<UserRow>();
    const passwordOk = await verifyPassword(String(password ?? ""), row?.password_hash ?? DUMMY_HASH);
    if (row && isLocked(row, at)) {
      // Refused even with the right password, until the lock ends or an administrator lifts it.
      await recordFailure(db, req, { username: tried, userId: row.id, reason: "locked", at });
      await audit(db, req, row, "login_failed", null, { username: tried, reason: "account locked" });
      throw refused;
    }
    if (!row || !passwordOk) {
      await recordFailure(db, req, { username: tried, userId: row?.id ?? null, reason: "password", at });
      await audit(db, req, { id: row?.id ?? null, name: row?.name ?? (tried || "(blank)") }, "login_failed", null, { username: tried });
      if (row) await lockIfNeeded(env, ctx, req, row, rules, at);
      // Logged once, as the address reaches the limit.
      const fromAddress = await addressFailures(db, req, since);
      if (fromAddress === rules.ipAttempts) {
        const ip = req.headers.get("cf-connecting-ip");
        await audit(db, req, { id: null, name: ip ?? "(unknown address)" }, "signin_ip_blocked", null, { ip, failures: fromAddress, minutes: SIGNIN_WINDOW_MINUTES });
      }
      throw refused;
    }
    // Passwords set before the policy may fall short of it. Only now, while we hold the plain text,
    // can that be checked; such accounts must choose a compliant one before doing anything else.
    if (!row.must_change_password && passwordProblem(String(password), row)) {
      await db.prepare("UPDATE users SET must_change_password = 2 WHERE id = ?").bind(row.id).run();
      row.must_change_password = 2;
    }
    // With two-step verification on, the right password only earns a short-lived ticket to
    // trade for a session together with a code from the authenticator app.
    const keys = await passkeyCount(db, row.id);
    if (row.mfa_secret || keys) {
      const ticket = newToken();
      await db.batch([
        db.prepare("DELETE FROM mfa_challenges WHERE expires_at < ? OR user_id = ?").bind(Date.now(), row.id),
        db
          .prepare("INSERT INTO mfa_challenges (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
          .bind(await tokenHash(ticket), row.id, Date.now() + MFA_TICKET_MINUTES * 60_000),
      ]);
      // Which ways through the second step this account has, so the screen offers the right ones.
      return json({ mfa: true, ticket, methods: { app: !!row.mfa_secret, passkey: keys > 0 } });
    }
    return startSession(db, req, row, {});
  }

  if (path === "/api/login/mfa" && method === "POST") {
    const b = await body<{ ticket?: string; code?: string }>(req);
    const hash = await tokenHash(String(b.ticket ?? ""));
    const challenge = await db
      .prepare("SELECT * FROM mfa_challenges WHERE token_hash = ? AND expires_at > ?")
      .bind(hash, Date.now())
      .first<{ user_id: string; attempts: number }>();
    if (!challenge) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(challenge.user_id).first<UserRow>();
    if (!row || !(await hasMfa(db, row))) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    if (isLocked(row)) {
      await db.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(hash).run();
      throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    }
    const used = await checkSecondFactor(db, env, row, String(b.code ?? ""));
    if (!used) {
      const attempts = challenge.attempts + 1;
      await audit(db, req, row, "login_failed", null, { username: row.username, reason: "wrong two-step code" });
      // Wrong codes count towards the lock too, so someone with the password can't keep guessing codes.
      const at = Date.now();
      await recordFailure(db, req, { username: row.username, userId: row.id, reason: "two_step", at });
      await lockIfNeeded(env, ctx, req, row, await signinRules(db), at);
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await db.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(hash).run();
        throw new HttpError(401, "Too many wrong codes. Enter your password again.", "mfa_expired");
      }
      await db.prepare("UPDATE mfa_challenges SET attempts = ? WHERE token_hash = ?").bind(attempts, hash).run();
      throw new HttpError(401, `That code didn't work. ${MFA_MAX_ATTEMPTS - attempts} ${MFA_MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left.`);
    }
    await db.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(hash).run();
    return startSession(db, req, row, { twoStep: used });
  }

  // Sign-in with a passkey or security key instead of a code: first a challenge for this ticket...
  if (path === "/api/login/passkey/options" && method === "POST") {
    const b = await body<{ ticket?: string }>(req);
    const hash = await tokenHash(String(b.ticket ?? ""));
    const challenge = await db
      .prepare("SELECT user_id FROM mfa_challenges WHERE token_hash = ? AND expires_at > ?")
      .bind(hash, Date.now())
      .first<{ user_id: string }>();
    if (!challenge) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const keys = await db.prepare("SELECT id FROM passkeys WHERE user_id = ?").bind(challenge.user_id).all<{ id: string }>();
    if (!keys.results.length) throw new HttpError(400, "There's no passkey on this account");
    const c = newChallenge();
    await db.batch([
      db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ? OR ticket_hash = ?").bind(Date.now(), hash),
      db
        .prepare("INSERT INTO webauthn_challenges (challenge, user_id, purpose, ticket_hash, expires_at) VALUES (?, ?, 'login', ?, ?)")
        .bind(c, challenge.user_id, hash, Date.now() + MFA_TICKET_MINUTES * 60_000),
    ]);
    return json({ challenge: c, rpId: webauthnSite(req).rpId, allow: keys.results.map((k) => k.id) });
  }

  // ...then the signed answer.
  if (path === "/api/login/passkey" && method === "POST") {
    const b = await body<{ ticket?: string; credential?: { id?: string; clientDataJSON?: string; authenticatorData?: string; signature?: string } }>(req);
    const hash = await tokenHash(String(b.ticket ?? ""));
    const ticket = await db
      .prepare("SELECT * FROM mfa_challenges WHERE token_hash = ? AND expires_at > ?")
      .bind(hash, Date.now())
      .first<{ user_id: string; attempts: number }>();
    if (!ticket) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(ticket.user_id).first<UserRow>();
    if (!row || isLocked(row)) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const cred = b.credential ?? {};
    try {
      const key = await db
        .prepare("SELECT * FROM passkeys WHERE id = ? AND user_id = ?")
        .bind(String(cred.id ?? ""), row.id)
        .first<{ id: string; name: string; public_key: string; alg: number; sign_count: number }>();
      if (!key) throw new Error("That passkey isn't registered to this account");
      const sent = readClientData(String(cred.clientDataJSON ?? "")).challenge;
      const issued = await db
        .prepare("DELETE FROM webauthn_challenges WHERE challenge = ? AND user_id = ? AND purpose = 'login' AND ticket_hash = ? AND expires_at > ?")
        .bind(sent, row.id, hash, Date.now())
        .run();
      if (!issued.meta.changes) throw new Error("That passkey request has expired. Try again.");
      const { signCount } = await verifyAssertion({
        clientDataJSON: String(cred.clientDataJSON ?? ""),
        authenticatorData: String(cred.authenticatorData ?? ""),
        signature: String(cred.signature ?? ""),
        publicKey: key.public_key,
        alg: key.alg,
        storedCount: key.sign_count,
        challenge: sent,
        ...webauthnSite(req),
      });
      await db.batch([
        db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?").bind(signCount, new Date().toISOString(), key.id),
        db.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(hash),
      ]);
      return startSession(db, req, row, { twoStep: "passkey", passkey: key.name });
    } catch (e) {
      const attempts = ticket.attempts + 1;
      await audit(db, req, row, "login_failed", null, { username: row.username, reason: `passkey: ${e instanceof Error ? e.message : "failed"}` });
      if (attempts >= MFA_MAX_ATTEMPTS) {
        await db.prepare("DELETE FROM mfa_challenges WHERE token_hash = ?").bind(hash).run();
        throw new HttpError(401, "Too many failed attempts. Enter your password again.", "mfa_expired");
      }
      await db.prepare("UPDATE mfa_challenges SET attempts = ? WHERE token_hash = ?").bind(attempts, hash).run();
      throw new HttpError(401, e instanceof Error ? e.message : "That passkey didn't work");
    }
  }

  // Lost every way to verify: after the right password, ask an administrator for a reset. One
  // open request per person; the ticket stays usable in case they find a code after all.
  if (path === "/api/login/mfa/help" && method === "POST") {
    const b = await body<{ ticket?: string; message?: string }>(req);
    const challenge = await db
      .prepare("SELECT user_id FROM mfa_challenges WHERE token_hash = ? AND expires_at > ?")
      .bind(await tokenHash(String(b.ticket ?? "")), Date.now())
      .first<{ user_id: string }>();
    if (!challenge) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(challenge.user_id).first<UserRow>();
    if (!row) throw new HttpError(401, "That sign-in has expired. Enter your password again.", "mfa_expired");
    const message = String(b.message ?? "").trim().slice(0, 300);
    const open = await db.prepare("SELECT id FROM mfa_help_requests WHERE user_id = ? AND status = 'OPEN'").bind(row.id).first<{ id: string }>();
    if (open) {
      await db.prepare("UPDATE mfa_help_requests SET message = ?, created_at = ? WHERE id = ?").bind(message, new Date().toISOString(), open.id).run();
    } else {
      await db
        .prepare("INSERT INTO mfa_help_requests (id, user_id, message, created_at, ip) VALUES (?, ?, ?, ?, ?)")
        .bind(newToken().slice(0, 16), row.id, message, new Date().toISOString(), req.headers.get("cf-connecting-ip"))
        .run();
    }
    await audit(db, req, row, "mfa_help_requested", row.id, { name: row.name, ...(message ? { message } : {}) });
    return json({ ok: true });
  }

  // The public showcase (/executive): totals only, no names. Needs no sign-in.
  if (path === "/api/showcase" && method === "GET") {
    const [systems, users, assigned, features, blocked, limits] = await Promise.all([
      db.prepare("SELECT data FROM systems").all<{ data: string }>(),
      db.prepare("SELECT * FROM users").all<UserRow>(),
      db.prepare("SELECT user_id, system_id FROM assignments").all<{ user_id: string; system_id: string }>(),
      db.prepare("SELECT * FROM features").all<FeatureRow>(),
      db.prepare("SELECT DISTINCT system_id FROM blockers WHERE resolved_at IS NULL").all<{ system_id: string }>(),
      workloadLimits(db),
    ]);
    const projects = (id: string) => assigned.results.filter((a) => a.user_id === id).map((a) => a.system_id);
    const showcase = buildShowcase(
      systems.results.map((r) => JSON.parse(r.data)),
      users.results.map((u) => toUser(u, projects(u.id))),
      features.results.map(toFeature),
      new Set(blocked.results.map((b) => b.system_id)),
      limits,
      Date.now(),
    );
    return json(showcase, 200, { "cache-control": "public, max-age=60" });
  }

  // GitHub calls this, signed with the shared secret; the customer portal works by its link. No session.
  if (path === "/api/integrations/github/webhook" && method === "POST") return githubWebhook(env, req);
  const portal = await portalApi(env, req, path, (p) => ctx.waitUntil(p.catch((e) => console.error("portal background work failed", e))));
  if (portal) return portal;

  if (path === "/api/logout" && method === "POST") {
    const token = cookieToken(req);
    if (token) {
      const hash = await tokenHash(token);
      const who = await db
        .prepare("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
        .bind(hash)
        .first<{ id: string; name: string }>();
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
      if (who) await audit(db, req, who, "logout");
    }
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  // Everything below needs a signed-in user.
  // A view-only share link stands in for a signed-in user: read-only, and only while the link
  // is valid. It may load the data and project history, ask Ask Pulse, and request updates
  // (or withdraw its own requests); nothing else.
  const shareToken = req.headers.get("x-share-token");
  const guest = shareToken
    ? await db
        .prepare("SELECT * FROM share_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?")
        .bind(await tokenHash(shareToken), new Date().toISOString())
        .first<ShareLinkRow>()
    : null;
  if (shareToken && !guest) throw new HttpError(401, "This view-only link has expired or been turned off.", "share_invalid");
  const guestAllowed =
    (method === "GET" &&
      (path === "/api/data" ||
        path === "/api/notifications" ||
        /^\/api\/systems\/[a-z0-9-]+\/history$/.test(path) ||
        path === "/api/items" ||
        path === "/api/boards" ||
        path === "/api/statuses" ||
        path === "/api/backlog" ||
        path === "/api/timeline" ||
        path.startsWith("/api/reports/agile/") ||
        /^\/api\/items\/[A-Z]{2,10}-\d{1,7}(\/comments)?$/.test(path))) ||
    (method === "POST" && (path === "/api/ask" || path === "/api/requests")) ||
    (method === "DELETE" && /^\/api\/requests\/[a-f0-9]+$/.test(path));
  if (guest && !guestAllowed) {
    throw new HttpError(403, "This link is view-only");
  }
  // A personal API token stands in for its owner, with the owner's permissions (worker/integrations.ts).
  const apiToken = guest ? null : await tokenAuth(db, req, path);
  const me = guest
    ? guestUser(guest)
    : apiToken
      ? await db.prepare("SELECT * FROM users WHERE id = ?").bind(apiToken.userId).first<UserRow>()
      : await currentUser(req, db);
  if (!me) throw new HttpError(401, "Not signed in");
  if (apiToken) VIA_TOKEN.set(req, apiToken.name);
  if (guest && path === "/api/data") {
    await db.prepare("UPDATE share_links SET views = views + 1, last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), guest.id).run();
  }

  // After an admin reset, the only things a user may do are choose a new password or sign out.
  if (me.must_change_password && !["/api/me/password", "/api/logout", "/api/logout-all"].includes(path)) {
    throw new HttpError(
      403,
      me.must_change_password === 2
        ? `Hi ${me.name}, the password policy has changed and your password no longer meets it`
        : `Hi ${me.name}, you signed in with a temporary password`,
      "password_change_required",
      // So the change-password screen can check "not your name or username" before submitting.
      { who: { username: me.username, name: me.name } },
    );
  }
  // When the admin requires two-step verification for this role, nothing works until it's set up.
  // A required password change comes first, so it stays allowed: the order is password, then
  // two-step setup, then the app.
  const policy = await mfaPolicy(db);
  // Setting up either method (app or passkey) is allowed before the rest of the app.
  const mfaSetupPaths = ["/api/me/mfa/setup", "/api/me/mfa/enable", "/api/me/passkeys/options", "/api/me/passkeys", "/api/logout", "/api/logout-all"];
  if (me.must_change_password) mfaSetupPaths.push("/api/me/password");
  if (!guest && mfaRequiredFor(me, policy) && !mfaSetupPaths.includes(path) && !(await hasMfa(db, me))) {
    throw new HttpError(403, `Hi ${me.name}, your organisation requires two-step verification. Set it up to continue.`, "mfa_setup_required");
  }

  const matrix = await roleMatrix(db);
  // A view-only link sees everything, including Reports, and may request updates; it changes nothing else.
  const perms: Permission[] = guest ? ["reports", "request_updates"] : permissionsFor(me.role, matrix);
  const can = (p: Permission) => perms.includes(p);
  if (apiToken && !can("use_api")) throw new HttpError(403, "Your role can no longer use API tokens", "token_not_allowed");
  // Developers (without manage_features) see only the feature requests assigned to them or
  // logged by them: everywhere, including Ask Pulse and project history.
  const ownFeaturesOnly = me.role === "developer" && !can("manage_features");
  const mineOnly = (rows: FeatureRow[]) => (ownFeaturesOnly ? rows.filter((f) => f.assignee === me.id || f.created_by === me.id) : rows);
  // Feature requests are work items: those with a security level only for people at the level (worker/access.ts).
  const visibleFeatures = async (rows: FeatureRow[]) => {
    const own = mineOnly(rows);
    if (!own.some((f) => f.security_level)) return own;
    const levels = guest ? [] : me.role === "admin" ? null : await levelsFor(db, { id: me.id, role: me.role, ownOnly: ownFeaturesOnly });
    return own.filter((f) => !f.security_level || (!guest && (levels === null || levels.includes(f.security_level) || f.assignee === me.id || f.created_by === me.id)));
  };
  const seeFeature = async (f: FeatureRow) => (await visibleFeatures([f])).length === 1;
  // Developers (without manage_systems) see only the Concept Notes they wrote or are asked to sign:
  // anyone else's is left off the project, everywhere it's sent, including Ask Pulse.
  const ownPcnsOnly = me.role === "developer" && !can("manage_systems");
  const pcnFor = (s: System): System => {
    if (!ownPcnsOnly || !s.pcn || s.pcnBy === me.id || s.pcn.signatories.some((g) => g.userId === me.id)) return s;
    const { pcn: _pcn, pcnBy: _pcnBy, ...rest } = s;
    return rest;
  };
  const need = (p: Permission) => {
    if (!can(p)) throw new HttpError(403, "You don't have permission to do that");
  };
  const now = new Date().toISOString();

  // Tell people what needs them, without holding up the request or failing it. Your own actions
  // don't notify you.
  const alert = (alerts: Alert[], channel?: ChannelPost) => {
    const others = alerts.filter((a) => a.userId !== me.id);
    if (others.length || channel) ctx.waitUntil(raise(env, others, channel).catch((e) => noteFailure(db, "Notification", e)));
  };
  // Work items (worker/workitems.ts) run with the same person, permissions and visibility rules.
  const itemCtx: ItemContext = {
    db,
    req,
    me: { id: me.id, name: me.name, username: me.username, role: me.role },
    guest: !!guest,
    can,
    ownOnly: ownFeaturesOnly,
    viewer: { id: me.id, role: me.role, ownOnly: ownFeaturesOnly, guest: !!guest },
    now,
    audit: (action, target, detail) => audit(db, req, me, action, target, detail),
    alert: (alerts, channel) => alert(alerts, channel),
    env,
    defer: (p) => ctx.waitUntil(p.catch((e) => console.error("background work failed", e))),
    // Automation reacts after the response, so a person never waits for a rule.
    emit: guest ? undefined : (e) => ctx.waitUntil(runEvent(env, e).catch((err) => console.error("automation failed", err))),
  };
  const itemsResponse = (await itemsApi(itemCtx, path, method)) ?? (await workflowsApi(itemCtx, path, method)) ?? (await boardsApi(itemCtx, path, method)) ?? (await sprintsApi(itemCtx, path, method)) ?? (await searchApi(itemCtx, env, path, method)) ?? (await automationApi(itemCtx, env, path, method)) ??
    (await customFieldsApi(itemCtx, path, method)) ?? (await adminApi(itemCtx, path, method)) ?? (await serviceDeskApi(itemCtx, path, method)) ?? (await integrationsApi(itemCtx, env, path, method));
  if (itemsResponse) return itemsResponse;

  /**
   * After a project changes workspace: it takes the new workspace's workflow, unless some of its work
   * items are in statuses that workflow doesn't have. Then it keeps the workflow it had, as its own.
   */
  const keepWorkflowIfNeeded = async (systemId: string, before: string) => {
    const row = await db.prepare(`SELECT s.workflow_id, ${EFFECTIVE_WORKFLOW} AS wf FROM systems s WHERE s.id = ?`).bind(systemId).first<{ workflow_id: string | null; wf: string }>();
    if (!row || row.workflow_id || row.wf === before) return;
    const wf = await loadWorkflow(db, row.wf);
    const misfit = await db
      .prepare(`SELECT 1 FROM work_items WHERE system_id = ? AND status NOT IN (${wf.statuses.map(() => "?").join(", ")}) LIMIT 1`)
      .bind(systemId, ...wf.statuses.map((x) => x.id))
      .first();
    if (misfit) await db.prepare("UPDATE systems SET workflow_id = ? WHERE id = ?").bind(before, systemId).run();
  };
  const workflowsBefore = async () =>
    new Map(
      (await db.prepare(`SELECT s.id, ${EFFECTIVE_WORKFLOW} AS wf FROM systems s`).all<{ id: string; wf: string }>()).results.map((r) => [r.id, r.wf]),
    );

  const nameOfUser = async (id: string) => (await db.prepare("SELECT name FROM users WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? "Someone";
  /** Each signatory with an account hears once per project that a Concept Note needs them. */
  const askToSign = (system: { id: string; name: string }, pcn: Pcn) =>
    alert(
      pcn.signatories
        .filter((s) => s.userId && awaitingSignature(pcn, s.userId))
        .map((s) => ({
          userId: s.userId!,
          kind: "signature" as const,
          title: `Your signature is needed on "${pcn.title}"`,
          body: `${me.name} sent you this Concept Note to approve or decline.`,
          link: "view:pcns",
          dedupe: `signature:${system.id}`,
        })),
      { title: `Concept Note "${pcn.title}" needs signatures`, body: `Waiting for ${pcn.signatories.filter((s) => s.status === "PENDING").map((s) => s.name).join(", ")}.` },
    );

  // A project's workspace must be one on the list.
  const checkWorkspace = async (v: unknown): Promise<string> => {
    const name = String(v ?? "").trim();
    const list = await workspaceList(db);
    const match = list.find((w) => w.toLowerCase() === name.toLowerCase());
    if (!match) throw new HttpError(400, `Unknown workspace "${name.slice(0, 40)}"`);
    return match;
  };

  // ----- view-only share links (administrators) -----
  if (path === "/api/share-links" && method === "GET") {
    need("manage_users");
    const rows = await db
      .prepare(
        "SELECT l.*, u.name AS by_name FROM share_links l LEFT JOIN users u ON u.id = l.created_by ORDER BY l.revoked_at IS NOT NULL, l.created_at DESC LIMIT 50",
      )
      .all<ShareLinkRow & { by_name: string | null }>();
    return json(
      rows.results.map((r) => ({
        id: r.id,
        label: r.label,
        createdBy: r.by_name ?? "someone",
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        ...(r.revoked_at ? { revokedAt: r.revoked_at } : {}),
        ...(r.last_used_at ? { lastUsedAt: r.last_used_at } : {}),
        views: r.views,
      })),
    );
  }

  if (path === "/api/share-links" && method === "POST") {
    need("manage_users");
    const b = await body<{ label?: string; days?: number }>(req);
    const label = text(b.label, "Who it's for", true)!.slice(0, 80);
    const days = [1, 7, 30, 90].includes(Number(b.days)) ? Number(b.days) : 7;
    const token = newToken();
    const id = newToken().slice(0, 12);
    const expires = new Date(Date.now() + days * 86_400_000).toISOString();
    await db
      .prepare("INSERT INTO share_links (id, token_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, await tokenHash(token), label, me.id, now, expires)
      .run();
    await audit(db, req, me, "share_link_created", null, { label, days });
    // The secret is shown once; only its hash is kept.
    return json({ id, url: `${new URL(req.url).origin}/view/${token}`, expiresAt: expires }, 201);
  }

  const shareMatch = path.match(/^\/api\/share-links\/([A-Za-z0-9_-]+)$/);
  if (shareMatch && method === "DELETE") {
    need("manage_users");
    const row = await db.prepare("SELECT label FROM share_links WHERE id = ? AND revoked_at IS NULL").bind(shareMatch[1]).first<{ label: string }>();
    if (!row) throw new HttpError(404, "Link not found");
    await db.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ?").bind(now, shareMatch[1]).run();
    await audit(db, req, me, "share_link_revoked", null, { label: row.label });
    return json({ ok: true });
  }

  // ----- notifications -----
  if (path === "/api/notifications" && method === "GET") {
    // A view-only link has no inbox of its own: it reads the latest Monday Briefing.
    if (guest) {
      const saved = await db.prepare("SELECT value FROM settings WHERE key = 'latest_briefing'").first<{ value: string }>();
      const digest = saved ? (JSON.parse(saved.value) as Digest) : null;
      const items: AppNotification[] = digest ? [{ id: "latest-briefing", kind: "monday_briefing", title: digest.title, body: digest.summary, digest, createdAt: digest.writtenAt ?? now }] : [];
      return json({ items, unread: 0 });
    }
    const [rows, unread] = await Promise.all([
      db
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40")
        .bind(me.id)
        .all<{ id: string; kind: NotificationKind; title: string; body: string; link: string | null; digest: string | null; created_at: string; read_at: string | null }>(),
      db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").bind(me.id).first<{ n: number }>(),
    ]);
    return json({
      items: rows.results.map(
        (r): AppNotification => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          createdAt: r.created_at,
          ...(r.link ? { link: r.link } : {}),
          ...(r.digest ? { digest: JSON.parse(r.digest) } : {}),
          ...(r.read_at ? { readAt: r.read_at } : {}),
        }),
      ),
      unread: unread?.n ?? 0,
    });
  }

  if (path === "/api/notifications/read" && method === "POST") {
    const b = await body<{ id?: string }>(req);
    if (b.id) await db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").bind(now, String(b.id), me.id).run();
    else await db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").bind(now, me.id).run();
    return json({ ok: true });
  }

  // ----- email and Teams delivery (administrators) -----
  if (path === "/api/settings/delivery" && method === "GET") {
    need("manage_users");
    return json(await deliveryStatus(db));
  }

  if (path === "/api/settings/delivery" && method === "PUT") {
    need("manage_users");
    const b = await body<{ resendKey?: string | null; from?: string; teamsWebhook?: string | null; briefingEmails?: string }>(req);
    const next: Delivery = await readDelivery(db);
    const changed: string[] = [];
    if (b.resendKey === null) {
      delete next.resendKey;
      changed.push("email disconnected");
    } else if (b.resendKey) {
      const key = String(b.resendKey).trim();
      if (key.length < 10 || key.length > 200 || /\s/.test(key)) throw new HttpError(400, "That API key doesn't look right");
      next.resendKey = await sealSecret(key, mfaKey(env));
      changed.push("email key");
    }
    if (b.from !== undefined && b.from.trim() !== (next.from ?? "")) {
      const from = b.from.trim();
      if (from && !/^([^<>]{1,60}<)?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(from)) throw new HttpError(400, 'Send from: an address, or a name and address like "Pulse <pulse@omnicontact.biz>"');
      next.from = from;
      changed.push("send-from address");
    }
    if (b.teamsWebhook === null) {
      delete next.teams;
      changed.push("Teams disconnected");
    } else if (b.teamsWebhook) {
      next.teams = await sealSecret(checkTeamsWebhook(String(b.teamsWebhook)), mfaKey(env));
      changed.push("Teams webhook");
    }
    if (b.briefingEmails !== undefined) {
      const list = [...new Set(String(b.briefingEmails).split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const bad = list.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (bad) throw new HttpError(400, `"${bad.slice(0, 60)}" doesn't look like an email address`);
      if (list.length > 20) throw new HttpError(400, "Up to 20 extra Monday Briefing addresses");
      if (list.join() !== (next.briefingEmails ?? []).join()) changed.push("extra briefing addresses");
      next.briefingEmails = list;
    }
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('delivery', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    // The log says what changed, never the key or the webhook address.
    if (changed.length) await audit(db, req, me, "delivery_updated", null, { changed });
    return json(await deliveryStatus(db));
  }

  if (path === "/api/settings/delivery/test" && method === "POST") {
    need("manage_users");
    const delivery = await readDelivery(db);
    const outcome = async (connected: boolean, send: () => Promise<void>, success: string) => {
      if (!connected) return "not connected.";
      try {
        await send();
        return success;
      } catch (e) {
        return e instanceof Error ? `${e.message}.` : "failed.";
      }
    };
    const mail = emailFor(env, "Test message", "Email from Pulse is working.");
    const email = await outcome(
      !!(delivery.resendKey && delivery.from && me.email),
      () => sendEmail(env, delivery, me.email!, mail.subject, mail.html, mail.text),
      `sent to ${me.email}.`,
    );
    const teams = await outcome(!!delivery.teams, () => postToTeams(env, delivery, { title: "Test message from Pulse", body: `Sent by ${me.name}.` }), "posted.");
    // A working connection clears the old failure notice.
    if (!/refused|fail/i.test(email + teams)) await db.prepare("DELETE FROM settings WHERE key = 'delivery_error'").run();
    return json({ email, teams });
  }

  if (path === "/api/digests/run" && method === "POST") {
    need("manage_users");
    const b = await body<{ kind?: string }>(req);
    if (b.kind !== "daily" && b.kind !== "briefing") throw new HttpError(400, "Choose the daily digests or the Monday Briefing");
    const result = b.kind === "daily" ? await runDailyDigests(env) : await runBriefing(env);
    await audit(db, req, me, "digest_sent", null, { kind: b.kind, ...result });
    return json(result);
  }

  // Edit the workspace list. Each entry may say what it was called before ("was"), so a rename
  // moves its projects along; projects in a removed workspace move to the first one.
  if (path === "/api/settings/workspaces" && method === "PUT") {
    need("manage_systems");
    const b = await body<{ workspaces?: { name?: string; was?: string }[] }>(req);
    if (!Array.isArray(b.workspaces)) throw new HttpError(400, "Send the list of workspaces");
    const entries = b.workspaces
      .map((w) => ({ name: String(w?.name ?? "").trim().slice(0, 40), was: w?.was ? String(w.was) : undefined }))
      .filter((w) => w.name);
    const names = entries.map((w) => w.name);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new HttpError(400, "Two workspaces have the same name");
    if (names.length > 30) throw new HttpError(400, "Up to 30 workspaces");
    if (!names.length) throw new HttpError(400, "Keep at least one workspace");
    const before = await workspaceList(db);
    const renames = new Map(entries.filter((w) => w.was && w.was !== w.name && before.includes(w.was)).map((w) => [w.was!, w.name]));
    const rows = await db.prepare("SELECT id, data FROM systems").all<{ id: string; data: string }>();
    const wfBefore = await workflowsBefore();
    const stmts = [
      db
        .prepare("INSERT INTO settings (key, value) VALUES ('workspaces', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(JSON.stringify(names)),
      // A renamed workspace keeps its workflow and its board; a removed one's go.
      ...[...renames].flatMap(([was, now]) => [
        db.prepare("UPDATE workspace_workflows SET workspace = ? WHERE workspace = ?").bind(now, was),
        db.prepare("UPDATE boards SET workspace = ?, name = ? WHERE workspace = ?").bind(now, `${now} board`, was),
      ]),
      ...before
        .filter((w) => !names.includes(w) && !renames.has(w))
        .flatMap((w) => [db.prepare("DELETE FROM workspace_workflows WHERE workspace = ?").bind(w), db.prepare("DELETE FROM boards WHERE workspace = ?").bind(w)]),
    ];
    for (const r of rows.results) {
      const sys = JSON.parse(r.data) as System;
      const to = (sys.workspace && (renames.get(sys.workspace) ?? (names.includes(sys.workspace) ? sys.workspace : undefined))) || names[0];
      if (to === sys.workspace) continue;
      sys.workspace = to;
      stmts.push(db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(sys), r.id));
    }
    await db.batch(stmts);
    for (const [id, wf] of wfBefore) await keepWorkflowIfNeeded(id, wf);
    await audit(db, req, me, "workspaces_updated", null, { from: before, to: names, ...(renames.size ? { renamed: Object.fromEntries(renames) } : {}) });
    return json({ workspaces: names });
  }

  // ----- two-step verification: your own -----
  if (path === "/api/me/mfa/setup" && method === "POST") {
    if (me.mfa_secret) throw new HttpError(400, "Two-step verification is already on");
    const secret = newTotpSecret();
    await db.prepare("UPDATE users SET mfa_pending = ? WHERE id = ?").bind(await sealSecret(secret, mfaKey(env)), me.id).run();
    return json({ secret, uri: totpUri(secret, me.username) });
  }

  if (path === "/api/me/mfa/enable" && method === "POST") {
    // A pending secret comes from first-time setup, or from "move to a new phone" (which needed
    // the password and a code); confirming it replaces any old app.
    if (!me.mfa_pending) throw new HttpError(400, "Start the setup again");
    const replacing = !!me.mfa_secret;
    const hadPasskeys = (await passkeyCount(db, me.id)) > 0;
    const { code } = await body<{ code?: string }>(req);
    const step = await verifyTotp(await openSecret(me.mfa_pending, mfaKey(env)), String(code ?? ""));
    if (step === null) throw new HttpError(400, "That code didn't match. Check the time on your phone and try the newest code.");
    await db
      .prepare("UPDATE users SET mfa_secret = mfa_pending, mfa_pending = NULL, mfa_last_step = ?, mfa_enabled_at = ? WHERE id = ?")
      .bind(step, now, me.id)
      .run();
    // Fresh recovery codes when it's the first method, or after a move (old codes may be in use).
    const recoveryCodes = replacing || !hadPasskeys ? await issueRecoveryCodes(db, me.id) : undefined;
    if (replacing) await endOtherSessions(db, req, me.id);
    await audit(db, req, me, replacing ? "mfa_app_replaced" : "mfa_enabled", me.id, { name: me.name });
    return json({ recoveryCodes });
  }

  // Lost or changed phone: with the password and a code (an app code or a recovery code), start
  // linking a new authenticator. The old one keeps working until the new one is confirmed.
  if (path === "/api/me/mfa/replace" && method === "POST") {
    if (!me.mfa_secret) throw new HttpError(400, "There's no authenticator app to replace. Set one up instead.");
    const b = await body<{ password?: string; code?: string }>(req);
    if (!(await verifyPassword(String(b.password ?? ""), me.password_hash))) throw new HttpError(400, "Password is wrong");
    if (!(await checkSecondFactor(db, env, me, String(b.code ?? "")))) throw new HttpError(400, "That code didn't work. Use a code from the app or one of your recovery codes.");
    const secret = newTotpSecret();
    await db.prepare("UPDATE users SET mfa_pending = ? WHERE id = ?").bind(await sealSecret(secret, mfaKey(env)), me.id).run();
    return json({ secret, uri: totpUri(secret, me.username) });
  }

  // Revoke the authenticator app (a lost or stolen phone) straight away. Needs the password and
  // a recovery code (or a code from the app). Other browsers are signed out. If no method is left
  // and the role requires one, the next screen asks for a new one.
  if (path === "/api/me/mfa/app" && method === "DELETE") {
    if (!me.mfa_secret) throw new HttpError(400, "There's no authenticator app on your account");
    const b = await body<{ password?: string; code?: string }>(req);
    if (!(await verifyPassword(String(b.password ?? ""), me.password_hash))) throw new HttpError(400, "Password is wrong");
    if (!(await checkSecondFactor(db, env, me, String(b.code ?? "")))) throw new HttpError(400, "That code didn't work. Use one of your recovery codes.");
    await db.batch([
      db.prepare("UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, mfa_last_step = 0 WHERE id = ?").bind(me.id),
      ...clearMfaIfEmpty(db, me.id),
    ]);
    await endOtherSessions(db, req, me.id);
    await audit(db, req, me, "mfa_app_removed", me.id, { name: me.name });
    return json({ ok: true });
  }

  // ----- passkeys and security keys -----
  if (path === "/api/me/passkeys/options" && method === "POST") {
    const b = await body<{ password?: string }>(req);
    // The password again, so a borrowed signed-in browser can't quietly add its own key.
    if (!(await verifyPassword(String(b.password ?? ""), me.password_hash))) throw new HttpError(400, "Password is wrong");
    const keys = await db.prepare("SELECT id FROM passkeys WHERE user_id = ?").bind(me.id).all<{ id: string }>();
    if (keys.results.length >= 10) throw new HttpError(400, "You can have up to 10 passkeys. Remove one first.");
    const c = newChallenge();
    await db.batch([
      db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ? OR (user_id = ? AND purpose = 'register')").bind(Date.now(), me.id),
      db
        .prepare("INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at) VALUES (?, ?, 'register', ?)")
        .bind(c, me.id, Date.now() + 5 * 60_000),
    ]);
    return json({
      challenge: c,
      rpId: webauthnSite(req).rpId,
      user: { id: me.id, name: me.username, displayName: me.name },
      exclude: keys.results.map((k) => k.id),
    });
  }

  if (path === "/api/me/passkeys" && method === "POST") {
    const b = await body<{ name?: string; credential?: { id?: string; clientDataJSON?: string; authenticatorData?: string; publicKey?: string; alg?: number } }>(req);
    const cred = b.credential ?? {};
    const name = String(b.name ?? "").trim().slice(0, 60) || "Passkey";
    const id = String(cred.id ?? "");
    if (!/^[A-Za-z0-9_-]{16,1400}$/.test(id)) throw new HttpError(400, "Unreadable passkey");
    try {
      const sent = readClientData(String(cred.clientDataJSON ?? "")).challenge;
      const issued = await db
        .prepare("DELETE FROM webauthn_challenges WHERE challenge = ? AND user_id = ? AND purpose = 'register' AND expires_at > ?")
        .bind(sent, me.id, Date.now())
        .run();
      if (!issued.meta.changes) throw new Error("That request has expired. Try adding the passkey again.");
      const { signCount } = await verifyRegistration({
        clientDataJSON: String(cred.clientDataJSON ?? ""),
        authenticatorData: String(cred.authenticatorData ?? ""),
        publicKey: String(cred.publicKey ?? ""),
        alg: Number(cred.alg),
        challenge: sent,
        ...webauthnSite(req),
      });
      const first = !(await hasMfa(db, me));
      await db
        .prepare("INSERT INTO passkeys (id, user_id, name, public_key, alg, sign_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(id, me.id, name, String(cred.publicKey), Number(cred.alg), signCount, now)
        .run();
      if (first) await db.prepare("UPDATE users SET mfa_enabled_at = ? WHERE id = ?").bind(now, me.id).run();
      const recoveryCodes = first ? await issueRecoveryCodes(db, me.id) : undefined;
      await audit(db, req, me, "passkey_added", me.id, { name: me.name, passkey: name });
      return json({ recoveryCodes });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (String(e).includes("UNIQUE")) throw new HttpError(400, "That passkey is already on your account");
      throw new HttpError(400, e instanceof Error ? e.message : "Couldn't add that passkey");
    }
  }

  const passkeyMatch = path.match(/^\/api\/me\/passkeys\/([A-Za-z0-9_-]+)$/);
  if (passkeyMatch && method === "DELETE") {
    const b = await body<{ password?: string }>(req);
    if (!(await verifyPassword(String(b.password ?? ""), me.password_hash))) throw new HttpError(400, "Password is wrong");
    const key = await db.prepare("SELECT name FROM passkeys WHERE id = ? AND user_id = ?").bind(passkeyMatch[1], me.id).first<{ name: string }>();
    if (!key) throw new HttpError(404, "Passkey not found");
    await db.batch([db.prepare("DELETE FROM passkeys WHERE id = ?").bind(passkeyMatch[1]), ...clearMfaIfEmpty(db, me.id)]);
    await endOtherSessions(db, req, me.id);
    await audit(db, req, me, "passkey_removed", me.id, { name: me.name, passkey: key.name });
    return json({ ok: true });
  }

  if (path === "/api/me/mfa/recovery" && method === "POST") {
    const { code } = await body<{ code?: string }>(req);
    if ((await checkSecondFactor(db, env, me, String(code ?? ""))) !== "app") throw new HttpError(400, "Enter the current code from your authenticator app");
    const recoveryCodes = await issueRecoveryCodes(db, me.id);
    await audit(db, req, me, "mfa_recovery_regenerated", me.id, { name: me.name });
    return json({ recoveryCodes });
  }

  if (path === "/api/me/mfa/disable" && method === "POST") {
    if (!(await hasMfa(db, me))) throw new HttpError(400, "Two-step verification is already off");
    if (mfaRequiredFor(me, policy)) throw new HttpError(400, `Two-step verification is required for ${ROLE_LABEL[me.role]} accounts`);
    const b = await body<{ password?: string; code?: string }>(req);
    if (!(await verifyPassword(String(b.password ?? ""), me.password_hash))) throw new HttpError(400, "Password is wrong");
    if (!(await checkSecondFactor(db, env, me, String(b.code ?? "")))) throw new HttpError(400, "That code didn't work");
    await db.batch([
      db.prepare("UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, mfa_last_step = 0, mfa_enabled_at = NULL WHERE id = ?").bind(me.id),
      db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").bind(me.id),
      db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(me.id),
    ]);
    await audit(db, req, me, "mfa_disabled", me.id, { name: me.name });
    return json({ ok: true });
  }

  // ----- two-step verification: administration -----
  const mfaResetMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)\/mfa$/);
  if (mfaResetMatch && method === "DELETE") {
    need("manage_users");
    // Your own goes through Settings, with a code: a stolen admin session can't strip it.
    if (mfaResetMatch[1] === me.id) throw new HttpError(400, "Turn off your own two-step verification in Settings");
    const row = await db.prepare("SELECT id, name, mfa_secret FROM users WHERE id = ?").bind(mfaResetMatch[1]).first<{ id: string; name: string; mfa_secret: string | null }>();
    if (!row) throw new HttpError(404, "User not found");
    await db.batch([
      db.prepare("UPDATE users SET mfa_secret = NULL, mfa_pending = NULL, mfa_last_step = 0, mfa_enabled_at = NULL WHERE id = ?").bind(row.id),
      db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").bind(row.id),
      db.prepare("DELETE FROM mfa_challenges WHERE user_id = ?").bind(row.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
      db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(row.id),
      db
        .prepare("UPDATE mfa_help_requests SET status = 'RESOLVED', handled_by = ?, handled_at = ? WHERE user_id = ? AND status = 'OPEN'")
        .bind(me.id, now, row.id),
    ]);
    await audit(db, req, me, "mfa_reset", row.id, { name: row.name });
    return json({ ok: true });
  }

  // An administrator turns down a help request (say, it wasn't really them).
  const helpMatch = path.match(/^\/api\/mfa-help\/([A-Za-z0-9_-]+)$/);
  if (helpMatch && method === "DELETE") {
    need("manage_users");
    const r = await db
      .prepare("SELECT h.id, u.id AS user_id, u.name FROM mfa_help_requests h JOIN users u ON u.id = h.user_id WHERE h.id = ? AND h.status = 'OPEN'")
      .bind(helpMatch[1])
      .first<{ id: string; user_id: string; name: string }>();
    if (!r) throw new HttpError(404, "Request not found");
    await db.prepare("UPDATE mfa_help_requests SET status = 'DISMISSED', handled_by = ?, handled_at = ? WHERE id = ?").bind(me.id, now, r.id).run();
    await audit(db, req, me, "mfa_help_dismissed", r.user_id, { name: r.name });
    return json({ ok: true });
  }

  if (path === "/api/settings/mfa" && method === "PUT") {
    need("manage_users");
    const b = await body<{ roles?: unknown }>(req);
    if (!Array.isArray(b.roles)) throw new HttpError(400, "Roles must be a list");
    const next: MfaPolicy = { roles: ROLES.filter((r) => (b.roles as unknown[]).includes(r)) };
    // Requiring it for your own role before you have it would lock you into the setup screen.
    if (mfaRequiredFor(me, next) && !(await hasMfa(db, me))) {
      throw new HttpError(400, `Turn on two-step verification for yourself first (Settings), then require it for ${ROLE_LABEL[me.role]}s`);
    }
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('mfa_policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    await audit(db, req, me, "mfa_policy_updated", null, { from: policy.roles, to: next.roles });
    return json(next);
  }

  // How many wrong passwords lock an account, for how long, and the per-address limit.
  if (path === "/api/settings/signin" && method === "PUT") {
    need("manage_users");
    const before = await signinRules(db);
    const next = cleanSigninRules(await body<Partial<SigninRules>>(req));
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('signin_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    if (JSON.stringify(before) !== JSON.stringify(next)) await audit(db, req, me, "signin_rules_updated", null, { from: before, to: next });
    return json(next);
  }

  if (path === "/api/data" && method === "GET") {
    const [systems, users, requests, assigned, features, documents, blockers, limits, templates] = await Promise.all([
      db.prepare("SELECT data, key, progress_from_items, agile_mode, EXISTS (SELECT 1 FROM work_items w WHERE w.system_id = systems.id) AS has_items FROM systems ORDER BY sort, rowid").all<SystemRow>(),
      db.prepare("SELECT * FROM users ORDER BY name").all<UserRow>(),
      db.prepare("SELECT * FROM requests ORDER BY created_at DESC").all<Record<string, string>>(),
      db
        .prepare("SELECT a.user_id, a.system_id FROM assignments a JOIN systems s ON s.id = a.system_id ORDER BY s.sort, s.rowid")
        .all<{ user_id: string; system_id: string }>(),
      db.prepare("SELECT * FROM features ORDER BY created_at DESC").all<FeatureRow>(),
      db.prepare("SELECT * FROM documents WHERE work_item_id IS NULL ORDER BY uploaded_at DESC").all<Record<string, string | number | null>>(),
      db.prepare("SELECT * FROM blockers ORDER BY raised_at DESC").all<Record<string, string | null>>(),
      workloadLimits(db),
      db.prepare("SELECT * FROM templates ORDER BY created_by IS NOT NULL, created_at").all<TemplateRow>(),
    ]);
    const projectsByUser = new Map<string, string[]>();
    for (const a of assigned.results) projectsByUser.set(a.user_id, [...(projectsByUser.get(a.user_id) ?? []), a.system_id]);
    return json({
      me: toUser(me, projectsByUser.get(me.id)),
      prefs: cleanPrefs(JSON.parse(me.prefs || "{}"), START_KEYS),
      permissions: perms,
      roleMatrix: matrix,
      systems: systems.results.map((r) => pcnFor(toSystem(r))),
      users: await (async () => {
        // Two-step is on with an app or a passkey; admins also see which methods.
        const keyed = await db.prepare("SELECT user_id, COUNT(*) AS n FROM passkeys GROUP BY user_id").all<{ user_id: string; n: number }>();
        const keysOf = new Map(keyed.results.map((k) => [k.user_id, k.n]));
        const list = users.results.map((u) => {
          const user = toUser(u, projectsByUser.get(u.id));
          if (guest) {
            delete user.email;
            delete user.phone;
          }
          const keys = keysOf.get(u.id) ?? 0;
          if (keys) user.mfaEnabled = true;
          if (can("manage_users") && user.mfaEnabled) user.mfaMethods = [...(u.mfa_secret ? ["app" as const] : []), ...(keys ? ["passkey" as const] : [])];
          if (can("manage_users") && isLocked(u)) {
            user.lockedUntil = new Date(u.locked_until!).toISOString();
            if (u.locked_at) user.lockedAt = u.locked_at;
          }
          return user;
        });
        if (!can("audit_log")) return list;
        const last = await db
          .prepare("SELECT user_id, MAX(at) AS at FROM activity WHERE action = 'login' GROUP BY user_id")
          .all<{ user_id: string; at: string }>();
        const byUser = new Map(last.results.map((r) => [r.user_id, r.at]));
        return list.map((u) => (byUser.has(u.id) ? { ...u, lastLogin: byUser.get(u.id) } : u));
      })(),
      requests: await (async () => {
        // Requests made through a view-only link carry the link's name, as there's no user.
        const linkIds = [...new Set(requests.results.map((r) => r.requested_by).filter((id) => id.startsWith("share-")))];
        const labels = new Map<string, string>();
        for (const id of linkIds) {
          const l = await db.prepare("SELECT label FROM share_links WHERE id = ?").bind(id.slice(6)).first<{ label: string }>();
          labels.set(id, `${l?.label ?? "A"} (view-only link)`);
        }
        return requests.results.map(
          (r): UpdateRequest => ({
            id: r.id,
            systemId: r.system_id,
            requestedBy: r.requested_by,
            ...(labels.has(r.requested_by) ? { requestedByName: labels.get(r.requested_by) } : {}),
            message: r.message,
            createdAt: r.created_at,
          }),
        );
      })(),
      features: (await visibleFeatures(features.results)).map(toFeature),
      documents: documents.results.map(
        (d): ProjectDocument => ({
          id: String(d.id),
          systemId: String(d.system_id),
          name: String(d.name),
          kind: d.kind === "link" ? "link" : "file",
          ...(d.url ? { url: String(d.url) } : {}),
          ...(d.mime ? { mime: String(d.mime) } : {}),
          ...(d.size != null ? { size: Number(d.size) } : {}),
          uploadedBy: String(d.uploaded_by),
          uploadedAt: String(d.uploaded_at),
        }),
      ),
      blockers: blockers.results.map(
        (b): Blocker => ({
          id: b.id!,
          systemId: b.system_id!,
          text: b.text!,
          raisedBy: b.raised_by!,
          raisedAt: b.raised_at!,
          ...(b.resolved_at ? { resolvedAt: b.resolved_at, resolvedBy: b.resolved_by ?? undefined } : {}),
          ...(b.resolution ? { resolution: b.resolution } : {}),
        }),
      ),
      limits,
      workspaces: await workspaceList(db),
      ...(guest ? { viewOnly: { label: guest.label, expiresAt: guest.expires_at } } : {}),
      mfaPolicy: policy,
      ...(can("manage_users") ? { signinRules: await signinRules(db) } : {}),
      templates: templates.results.map(toTemplate),
      recoveryCodesLeft: (await db.prepare("SELECT COUNT(*) AS n FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL").bind(me.id).first<{ n: number }>())!.n,
      // Your own second-step methods, for Settings.
      twoStep: {
        app: !!me.mfa_secret,
        passkeys: (
          await db
            .prepare("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
            .bind(me.id)
            .all<{ id: string; name: string; created_at: string; last_used_at: string | null }>()
        ).results.map((k) => ({ id: k.id, name: k.name, createdAt: k.created_at, ...(k.last_used_at ? { lastUsedAt: k.last_used_at } : {}) })),
      },
      // People locked out of two-step verification, waiting for an administrator.
      mfaHelp: can("manage_users")
        ? (
            await db
              .prepare(
                "SELECT h.id, h.user_id, u.name, h.message, h.created_at, h.ip FROM mfa_help_requests h JOIN users u ON u.id = h.user_id WHERE h.status = 'OPEN' ORDER BY h.created_at DESC",
              )
              .all<{ id: string; user_id: string; name: string; message: string; created_at: string; ip: string | null }>()
          ).results.map((h) => ({ id: h.id, userId: h.user_id, name: h.name, message: h.message, createdAt: h.created_at, ...(h.ip ? { ip: h.ip } : {}) }))
        : [],
    });
  }

  // Ask Pulse: a plain-English question answered from the data every signed-in user can see.
  if (path === "/api/ask" && method === "POST") {
    if (!env.AI) throw new HttpError(503, "Ask Pulse isn't switched on for this server");
    const b = await body<{ question?: string; history?: AskTurn[] }>(req);
    const question = String(b.question ?? "").trim();
    if (!question) throw new HttpError(400, "Type a question");
    if (question.length > MAX_QUESTION) throw new HttpError(400, `Keep questions under ${MAX_QUESTION} characters`);
    const t = Date.now();
    const recent = (askLog.get(me.id) ?? []).filter((at) => t - at < ASK_WINDOW_MS);
    if (recent.length >= ASK_LIMIT) throw new HttpError(429, "You've asked a lot in a short time. Try again in a few minutes.");
    askLog.set(me.id, [...recent, t]);
    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((h) => h && typeof h.q === "string" && typeof h.a === "string")
      .slice(-2);

    const [systems, people, assignments, features, blockers, limits, updateAsks] = await Promise.all([
      db.prepare("SELECT data FROM systems ORDER BY sort, rowid").all<{ data: string }>(),
      db.prepare("SELECT id, name, username, role, locked_until FROM users ORDER BY name").all<AskPerson & { locked_until: number | null }>(),
      db.prepare("SELECT user_id, system_id FROM assignments").all<{ user_id: string; system_id: string }>(),
      db.prepare("SELECT * FROM features ORDER BY created_at DESC").all<FeatureRow>(),
      db.prepare("SELECT * FROM blockers ORDER BY raised_at DESC").all<Record<string, string | null>>(),
      workloadLimits(db),
      db.prepare("SELECT system_id, requested_by, message, created_at FROM requests ORDER BY created_at DESC").all<Record<string, string>>(),
    ]);
    // Developers get a personal work assistant; everyone else the team view.
    const mode: AskMode = me.role === "developer" && !can("manage_features") ? "developer" : "team";
    const allSystems = systems.results.map((r) => pcnFor(JSON.parse(r.data) as System));
    const featuresSeen = (await visibleFeatures(features.results)).map(toFeature);
    const blockerList = blockers.results.map(
      (r): Blocker => ({
        id: r.id!,
        systemId: r.system_id!,
        text: r.text!,
        raisedBy: r.raised_by!,
        raisedAt: r.raised_at!,
        ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
        ...(r.resolution ? { resolution: r.resolution } : {}),
      }),
    );
    const focus =
      mode === "developer"
        ? buildWorkFocus({
            now: t,
            me: { id: me.id, name: me.name, username: me.username, role: me.role },
            systems: allSystems,
            people: people.results,
            assignments: assignments.results,
            features: featuresSeen,
            blockers: blockerList,
            updateRequests: updateAsks.results.map((r) => ({ systemId: r.system_id, requestedBy: r.requested_by, message: r.message, createdAt: r.created_at })),
            limits,
          })
        : "";
    const sprints = await sprintHealth(db, t, itemCtx.viewer);
    const itemLines = [
      ...(await askItemLines(itemCtx, new Map(people.results.map((p) => [p.id, p.name])))),
      ...(await askBoardLines(itemCtx)),
      ...(guest ? [] : await askSearchLines(itemCtx)),
      ...(can("manage_automation") ? await askAutomationLines(db) : []),
      ...(await askServiceDeskLines(itemCtx)),
      ...(await askIntegrationLines(itemCtx)),
      ...(sprints.length
        ? [
            "",
            `RUNNING SPRINTS (project | sprint | goal | ends | days left | story points done of the sprint's points | points committed at the start | behind?)${ownFeaturesOnly ? " (counting only your own items)" : ""}`,
            ...sprints.map((s) => [s.project, s.name, s.goal || "-", s.endDate, s.daysLeft, `${s.done} of ${s.scope}`, s.committed, s.behind ? "yes" : "no"].map((x) => String(x).replace(/\|/g, "/")).join(" | ")),
          ]
        : []),
    ];
    const snapshot = focus + buildSnapshot({
      now: t,
      systems: allSystems,
      people: people.results,
      assignments: assignments.results,
      features: featuresSeen,
      brief: mode === "developer",
      // Only people who manage users can see who is locked out, here as in Settings → People.
      ...(can("manage_users")
        ? {
            lockedAccounts: people.results
              .filter((p) => isLocked(p, t))
              .map((p) => ({ name: p.name, until: new Date(p.locked_until!).toISOString() })),
          }
        : {}),
      blockers: blockers.results.map(
        (r): Blocker => ({
          id: r.id!,
          systemId: r.system_id!,
          text: r.text!,
          raisedBy: r.raised_by!,
          raisedAt: r.raised_at!,
          ...(r.resolved_at ? { resolvedAt: r.resolved_at } : {}),
          ...(r.resolution ? { resolution: r.resolution } : {}),
        }),
      ),
      limits,
    }) + itemLines.join("\n");
    try {
      const stream = await askStream(env.AI, snapshot, question, history, mode);
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    } catch (e) {
      console.error("ask failed", e);
      throw new HttpError(502, "The assistant didn't respond. Try again in a moment.");
    }
  }

  if (path === "/api/me/password" && method === "POST") {
    const { current, next } = await body<{ current?: string; next?: string }>(req);
    // A forced change follows a sign-in with the temporary password, so it needs no "current".
    if (!me.must_change_password && !(await verifyPassword(String(current ?? ""), me.password_hash))) {
      throw new HttpError(400, "Current password is wrong");
    }
    const fresh = checkPassword(next, me);
    await checkNotReused(db, me.id, fresh, me.password_hash);
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").bind(await hashPassword(fresh), me.id),
      ...rememberPassword(db, me.id, me.password_hash, now),
    ]);
    await audit(
      db,
      req,
      me,
      me.must_change_password === 1 ? "password_set_after_reset" : "password_changed",
      null,
      me.must_change_password === 2 ? { reason: "policy" } : {},
    );
    return json({ ok: true });
  }

  if (path === "/api/me/prefs" && method === "PUT") {
    const prefs = cleanPrefs(await body<unknown>(req), START_KEYS);
    await db.prepare("UPDATE users SET prefs = ? WHERE id = ?").bind(JSON.stringify(prefs), me.id).run();
    return json(prefs);
  }

  // Everyone may keep their own contact details current (they feed the lead contact buttons).
  if (path === "/api/me" && method === "PATCH") {
    const b = await body<{ email?: string; phone?: string }>(req);
    const email = b.email !== undefined ? text(b.email, "Email") ?? null : me.email;
    const phone = b.phone !== undefined ? text(b.phone, "Phone") ?? null : me.phone;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "That email address doesn't look right");
    if (phone && !/^\+?[\d\s()-]{7,20}$/.test(phone)) throw new HttpError(400, "Phone: digits, spaces and an optional leading +");
    await db.prepare("UPDATE users SET email = ?, phone = ? WHERE id = ?").bind(email, phone, me.id).run();
    const fields = [email !== me.email && "email", phone !== me.phone && "phone"].filter(Boolean);
    if (fields.length) await audit(db, req, me, "profile_updated", me.id, { fields });
    return json({ ok: true });
  }

  if (path === "/api/logout-all" && method === "POST") {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(me.id).run();
    await audit(db, req, me, "logout_all");
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", req, 0) });
  }

  // ----- systems -----
  // A developer can work on several projects (the assignments table). Setting a project's
  // developers assigns the listed ones to it and unassigns the rest; their other projects stay.
  const checkDevelopers = async (list: unknown) => {
    if (!Array.isArray(list)) throw new HttpError(400, "Developers must be a list");
    const ids = [...new Set(list.map(String))];
    const devs = await db.prepare("SELECT id, name FROM users WHERE role = 'developer'").all<{ id: string; name: string }>();
    const byId = new Map(devs.results.map((d) => [d.id, d]));
    for (const id of ids) if (!byId.has(id)) throw new HttpError(400, "Only users with the developer role can be assigned");
    return { ids, byId };
  };
  /**
   * Refuses to give any of `adding` one more project when they're already at the workload limit,
   * naming developers who have room instead. Removing people is always allowed.
   */
  const checkRoom = async (adding: string[]) => {
    if (!adding.length) return;
    const limit = (await workloadLimits(db)).projects;
    const counts = await db
      .prepare(
        `SELECT u.id, u.name, COUNT(s.id) AS n FROM users u
         LEFT JOIN assignments a ON a.user_id = u.id
         LEFT JOIN systems s ON s.id = a.system_id
         WHERE u.role = 'developer' GROUP BY u.id ORDER BY n, u.name`,
      )
      .all<{ id: string; name: string; n: number }>();
    const full = counts.results.filter((d) => adding.includes(d.id) && d.n >= limit);
    if (!full.length) return;
    const room = counts.results.filter((d) => d.n < limit && !adding.includes(d.id)).slice(0, 3);
    const who = full.map((d) => `${d.name} already has ${d.n} project${d.n === 1 ? "" : "s"}`).join("; ");
    const suggest = room.length
      ? ` Developers with room: ${room.map((d) => `${d.name} (${d.n || "no"} project${d.n === 1 ? "" : "s"})`).join(", ")}.`
      : " Every developer is at the limit; free someone up first.";
    throw new HttpError(400, `${who}, the most a developer can have (${limit}).${suggest}`, "developer_full");
  };

  const setDevelopers = async (systemId: string, list: unknown) => {
    const { ids, byId } = await checkDevelopers(list);
    const rows = await db.prepare("SELECT user_id FROM assignments WHERE system_id = ?").bind(systemId).all<{ user_id: string }>();
    const before = rows.results.map((r) => r.user_id);
    const added = ids.filter((id) => !before.includes(id));
    await checkRoom(added);
    const removed = before.filter((id) => !ids.includes(id));
    const stmts = [
      ...added.map((id) => db.prepare("INSERT INTO assignments (user_id, system_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(id, systemId)),
      ...removed.map((id) => db.prepare("DELETE FROM assignments WHERE user_id = ? AND system_id = ?").bind(id, systemId)),
    ];
    if (stmts.length) await db.batch(stmts);
    if (added.length) {
      const system = await getSystem(db, systemId);
      alert(
        added.map((id) => ({ userId: id, kind: "assigned" as const, title: `You were assigned to ${system.name}`, body: `${me.name} added you to this project.`, link: `#/projects/${system.id}` })),
        { title: `${added.map((id) => byId.get(id)!.name).join(", ")} assigned to ${system.name}`, body: `By ${me.name}.`, link: `#/projects/${system.id}` },
      );
    }
    return {
      added: added.map((id) => ({ name: byId.get(id)!.name })),
      removed: removed.map((id) => byId.get(id)?.name ?? id),
    };
  };

  /** Signatories linked to an account get that account's current name; unknown accounts are refused. */
  const resolveSigners = async (list: Signatory[]): Promise<Signatory[]> => {
    const ids = list.map((s) => s.userId).filter((id): id is string => !!id);
    if (!ids.length) return list;
    const rows = await db
      .prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => "?").join(", ")})`)
      .bind(...ids)
      .all<{ id: string; name: string }>();
    const names = new Map(rows.results.map((r) => [r.id, r.name]));
    return list.map((s) => {
      if (!s.userId) return s;
      if (!names.has(s.userId)) throw new HttpError(400, "A signatory's account no longer exists");
      return { ...s, name: names.get(s.userId)! };
    });
  };

  if (path === "/api/systems" && method === "POST") {
    const b = await body<Partial<System> & { developers?: string[] }>(req);
    // Managers add systems outright. Anyone allowed to propose may add one with a Concept Note,
    // which starts as an Idea with nobody assigned until it's approved and planned.
    const proposal = !can("manage_systems");
    if (proposal && !(b.pcn !== undefined && can("propose_projects"))) throw new HttpError(403, "You don't have permission to do that");
    const pcn = b.pcn !== undefined ? cleanPcn(b.pcn) : undefined;
    if (pcn && !pcn.title) throw new HttpError(400, "The PCN needs a title");
    // A proposer can't arrive with sign-offs already recorded; only managers record approvals.
    // Sign-offs only ever happen through /pcn/sign, so a new PCN starts with all of them pending.
    if (pcn) pcn.signatories = await resolveSigners(pcn.signatories.map(({ date: _date, ...s }) => ({ ...s, status: "PENDING" as const })));
    const name = text(b.name ?? pcn?.title, "Name", true)!;
    let id = slug(name);
    for (let n = 2; await db.prepare("SELECT 1 FROM systems WHERE id = ?").bind(id).first(); n++) id = `${slug(name)}-${n}`;
    const status = proposal ? "IDEA" : checkStatus(b.status ?? "WIP");
    if (proposal) {
      delete b.developers;
      delete b.lead;
      delete b.dueAt;
      delete b.finishedAt;
      delete b.health;
      b.progress = 0;
    }
    // Validate before inserting, so a bad list doesn't leave a half-created system behind.
    if (b.developers !== undefined) await checkRoom((await checkDevelopers(b.developers)).ids);
    const system: System = {
      id,
      name,
      short: initials(name),
      description: text(b.description, "Description") ?? "",
      url: text(b.url, "URL") ?? "",
      status,
      owner: "Systems Team",
      engagement: 0,
      progress: checkProgress(b.progress ?? 0),
      startedAt: text(b.startedAt, "Start date", true)!,
      ...(b.finishedAt ? { finishedAt: text(b.finishedAt, "Delivered on") } : {}),
      ...(b.dueAt ? { dueAt: text(b.dueAt, "Due date") } : {}),
      ...(b.health ? { health: b.health === "Maintenance" ? "Maintenance" : "Stable" } : {}),
      ...(b.lead ? { lead: text(b.lead, "Lead") } : {}),
      ...(b.template ? { template: text(b.template, "Template")!.slice(0, 100) } : {}),
      // Every project belongs to a workspace: the first on the list unless one is chosen.
      workspace: b.workspace ? await checkWorkspace(b.workspace) : (await workspaceList(db))[0],
      ...(pcn ? { pcn, pcnBy: me.id } : {}),
      updatedAt: now,
      updatedBy: initials(me.name),
    };
    const sort = (await db.prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM systems").first<{ s: number }>())!.s;
    // Its key: the one asked for, or one suggested from the name.
    const taken = new Set((await db.prepare("SELECT key FROM systems").all<{ key: string }>()).results.map((r) => r.key));
    const key = b.key ? checkKey(b.key) : suggestKey(name, taken);
    if (taken.has(key)) throw new HttpError(409, `The key ${key} is taken by another project`);
    await db.prepare("INSERT INTO systems (id, sort, data, key) VALUES (?, ?, ?, ?)").bind(id, sort, JSON.stringify(system), key).run();
    system.key = key;
    await audit(db, req, me, "system_created", id, {
      name,
      key,
      status,
      progress: system.progress,
      ...(system.template ? { template: system.template } : {}),
      ...(pcn ? { pcn: true } : {}),
    });
    if (b.developers?.length) await audit(db, req, me, "system_developers", id, { name, ...(await setDevelopers(id, b.developers)) });
    if (system.lead) alert([{ userId: system.lead, kind: "assigned", title: `You now lead ${name}`, body: `${me.name} made you the lead on this new project.`, link: `#/projects/${id}` }]);
    if (pcn) askToSign(system, pcn);
    return json(system, 201);
  }

  // A signatory approves or declines a PCN themselves. For someone without an account, a manager
  // records the decision as it arrives through Econet. Nobody signs on behalf of an account holder.
  const signMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)\/pcn\/sign$/);
  if (signMatch && method === "POST") {
    const current = await getSystem(db, signMatch[1]);
    if (!current.pcn) throw new HttpError(404, "This project has no Concept Note");
    const b = await body<{ index?: number; decision?: string; remarks?: string }>(req);
    const i = Number(b.index);
    const signer = current.pcn.signatories[i];
    if (!Number.isInteger(i) || !signer) throw new HttpError(400, "Unknown signatory");
    if (signer.userId ? signer.userId !== me.id : !can("manage_systems")) {
      throw new HttpError(403, signer.userId ? `Only ${signer.name} can sign their part of this PCN` : "Only someone who can add systems (an administrator or team leader) can record this sign-off");
    }
    const decision = b.decision === "APPROVED" || b.decision === "DECLINED" || b.decision === "PENDING" ? b.decision : null;
    if (!decision) throw new HttpError(400, "Choose approve or decline");
    const before = pcnStatus(current.pcn);
    const signatories = current.pcn.signatories.map((s, j) => {
      if (j !== i) return s;
      const { date: _date, ...rest } = s;
      return {
        ...rest,
        status: decision,
        ...(b.remarks !== undefined ? { remarks: (text(b.remarks, "Remarks") ?? "").slice(0, 500) } : {}),
        ...(decision !== "PENDING" ? { date: now.slice(0, 10) } : {}),
      } as Signatory;
    });
    const next: System = { ...current, pcn: { ...current.pcn, signatories } };
    await db.prepare("UPDATE systems SET data = ? WHERE id = ?").bind(JSON.stringify(next), current.id).run();
    await audit(db, req, me, "pcn_signed", current.id, {
      name: current.name,
      signatory: signer.name,
      decision,
      ...(signer.userId ? {} : { recordedFor: true }),
      from: before,
      to: pcnStatus(next.pcn!),
    });
    return json(next);
  }

  const sysMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)$/);
  if (sysMatch && method === "PATCH") {
    const id = sysMatch[1];
    const current = await getSystem(db, id);
    const b = await body<Partial<System> & { developers?: string[] }>(req);
    const next: System = { ...current };

    // The Concept Note: its author keeps editing it; managers also record approvals as they come
    // in through Econet. Authors can't mark their own PCN approved: their sign-off changes are ignored.
    let pcnChange: Record<string, unknown> | null = null;
    if (b.pcn !== undefined) {
      if (!can("manage_systems") && current.pcnBy !== me.id) throw new HttpError(403, "Only whoever wrote the PCN or a manager can change it");
      const pcn = cleanPcn(b.pcn);
      if (!pcn.title) throw new HttpError(400, "The PCN needs a title");
      // Editing never changes a sign-off: each signatory keeps what they (or, for someone without an
      // account, a manager) recorded through /pcn/sign. New signatories start pending.
      pcn.signatories = await resolveSigners(
        pcn.signatories.map(({ date: _date, remarks, ...s }) => {
          const was = current.pcn?.signatories.find((o) => (s.userId ? o.userId === s.userId : !o.userId && o.name === s.name));
          return { ...s, remarks: was && was.status !== "PENDING" ? was.remarks : remarks, status: was?.status ?? "PENDING", ...(was?.date ? { date: was.date } : {}) };
        }),
      );
      const before = current.pcn ? pcnStatus(current.pcn) : null;
      next.pcn = pcn;
      if (!current.pcnBy) next.pcnBy = me.id;
      pcnChange = { name: current.name, from: before, to: pcnStatus(pcn) };
    }

    const columns = (await db.prepare("SELECT key, progress_from_items, agile_mode FROM systems WHERE id = ?").bind(id).first<{ key: string; progress_from_items: number; agile_mode: "kanban" | "scrum" }>())!;
    // Scrum (sprints and a backlog) or Kanban only. Switching off sprints waits for the running one to finish.
    let agileMode = columns.agile_mode;
    if (b.agileMode !== undefined && b.agileMode !== columns.agile_mode) {
      need("manage_systems");
      if (b.agileMode !== "scrum" && b.agileMode !== "kanban") throw new HttpError(400, "Choose Scrum or Kanban");
      if (b.agileMode === "kanban" && (await db.prepare("SELECT 1 FROM sprints WHERE system_id = ? AND state = 'ACTIVE'").bind(id).first())) {
        throw new HttpError(400, "Complete the running sprint before switching off sprints");
      }
      agileMode = b.agileMode;
    }
    // The key can change until the project's first work item exists.
    let keyChange: { from: string; to: string } | null = null;
    if (b.key !== undefined && b.key !== columns.key) {
      need("manage_systems");
      const key = checkKey(b.key);
      if (await db.prepare("SELECT 1 FROM work_items WHERE system_id = ?").bind(id).first()) {
        throw new HttpError(400, `The key is locked: ${columns.key}-1 already exists`);
      }
      if (await db.prepare("SELECT 1 FROM systems WHERE key = ? AND id <> ?").bind(key, id).first()) throw new HttpError(409, `The key ${key} is taken by another project`);
      keyChange = { from: columns.key, to: key };
    }
    let fromItems = !!columns.progress_from_items;
    if (b.progressFromItems !== undefined && !!b.progressFromItems !== fromItems) {
      need("manage_systems");
      fromItems = !!b.progressFromItems;
    }
    if (fromItems && b.progress !== undefined && b.progress !== current.progress) {
      throw new HttpError(400, "This project takes its progress from its work items. Turn that off to set it by hand.");
    }

    // Progress, status and maintenance are "progress updates": the assigned developer may post them.
    const touchesProgress =
      b.progress !== undefined || b.status !== undefined || b.health !== undefined || b.maintenanceNote !== undefined;
    if (touchesProgress) {
      const allowed = can("edit_any") || can("manage_systems") || (can("edit_assigned") && (await projectsOf(db, me.id)).includes(id));
      if (!allowed) throw new HttpError(403, "You can only update projects you're assigned to");
      if (b.progress !== undefined) next.progress = checkProgress(b.progress);
      if (b.status !== undefined) next.status = checkStatus(b.status);
      if (b.health !== undefined) {
        const health = b.health === "Maintenance" ? "Maintenance" : "Stable";
        if (health === "Maintenance" && current.health !== "Maintenance") next.maintenanceSince = now;
        next.health = health;
      }
      if (b.maintenanceNote !== undefined) next.maintenanceNote = text(b.maintenanceNote, "Maintenance note");
      if (next.health !== "Maintenance") {
        delete next.maintenanceNote;
        delete next.maintenanceSince;
      }
      if (next.progress === 100 && (next.status === "LIVE" || next.status === "COMPLETED") && !next.finishedAt) {
        next.finishedAt = now;
      }
      next.updatedAt = now;
      next.updatedBy = initials(me.name);
    }

    const detailFields = ["name", "description", "url", "lead", "dueAt", "startedAt", "workspace"] as const;
    if (detailFields.some((f) => b[f] !== undefined)) {
      need("manage_systems");
      if (b.name !== undefined) next.name = text(b.name, "Name", true)!;
      if (b.description !== undefined) next.description = text(b.description, "Description") ?? "";
      if (b.url !== undefined) next.url = text(b.url, "URL") ?? "";
      if (b.startedAt !== undefined) next.startedAt = text(b.startedAt, "Start date", true)!;
      if (b.dueAt !== undefined) next.dueAt = text(b.dueAt, "Due date");
      if (b.workspace !== undefined) next.workspace = await checkWorkspace(b.workspace);
      if (b.lead !== undefined) {
        const lead = text(b.lead, "Lead");
        if (lead && !(await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(lead).first())) throw new HttpError(400, "Unknown lead");
        next.lead = lead;
      }
    }

    if (b.developers !== undefined) {
      if (!can("manage_systems") && !can("assign_developers")) throw new HttpError(403, "You don't have permission to change a project's developers");
      const result = await setDevelopers(id, b.developers);
      if (result.added.length || result.removed.length) await audit(db, req, me, "system_developers", id, { name: next.name, ...result });
    }

    const wfBefore = next.workspace !== current.workspace ? (await workflowsBefore()).get(id) : undefined;
    const stmts = [
      db
        .prepare("UPDATE systems SET data = ?, key = ?, progress_from_items = ?, agile_mode = ? WHERE id = ?")
        .bind(systemData(next), keyChange?.to ?? columns.key, fromItems ? 1 : 0, agileMode, id),
    ];
    if (pcnChange) await audit(db, req, me, "pcn_updated", id, pcnChange);
    // Posting progress answers any open update requests for this project.
    if (touchesProgress) stmts.push(db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id));
    await db.batch(stmts);
    if (wfBefore) await keepWorkflowIfNeeded(id, wfBefore);
    if (touchesProgress) {
      const snap = (s: System) => ({ progress: s.progress, status: s.status, health: s.health ?? null });
      await audit(db, req, me, "system_progress", id, {
        name: next.name,
        from: snap(current),
        to: snap(next),
        ...(next.maintenanceNote && next.maintenanceNote !== current.maintenanceNote ? { note: next.maintenanceNote } : {}),
      });
    }
    if (pcnChange) askToSign(next, next.pcn!);
    const changed = detailFields.filter((f) => b[f] !== undefined && b[f] !== current[f]);
    if (changed.includes("lead") && next.lead) {
      alert(
        [{ userId: next.lead, kind: "assigned", title: `You now lead ${next.name}`, body: `${me.name} made you the lead on this project.`, link: `#/projects/${id}` }],
        { title: `${await nameOfUser(next.lead)} now leads ${next.name}`, body: `By ${me.name}.`, link: `#/projects/${id}` },
      );
    }
    if (keyChange) await audit(db, req, me, "system_updated", id, { name: next.name, fields: ["key"], key: keyChange });
    if (agileMode !== columns.agile_mode) await audit(db, req, me, "system_updated", id, { name: next.name, fields: ["agileMode"], agileMode: { from: columns.agile_mode, to: agileMode } });
    if (fromItems !== !!columns.progress_from_items) {
      await audit(db, req, me, "system_updated", id, { name: next.name, fields: ["progressFromItems"], progressFromItems: { from: !fromItems, to: fromItems } });
      if (fromItems) await recomputeProgress(itemCtx, id);
    }
    if (changed.length) {
      await audit(db, req, me, "system_updated", id, {
        name: next.name,
        fields: changed,
        ...(changed.includes("lead") ? { lead: { from: current.lead ?? null, to: next.lead ?? null } } : {}),
        ...(changed.includes("workspace") ? { workspace: { from: current.workspace ?? null, to: next.workspace ?? null } } : {}),
      });
    }
    return json(pcnFor({ ...(await getSystem(db, id)), key: keyChange?.to ?? columns.key, agileMode, ...(fromItems ? { progressFromItems: true } : {}) }));
  }

  if (sysMatch && method === "DELETE") {
    need("manage_systems");
    const id = sysMatch[1];
    const gone = await getSystem(db, id);
    await db.batch([
      db.prepare("DELETE FROM document_chunks WHERE doc_id IN (SELECT id FROM documents WHERE system_id = ?)").bind(id),
      db.prepare("DELETE FROM documents WHERE system_id = ?").bind(id),
      db.prepare("DELETE FROM requests WHERE system_id = ?").bind(id),
      db.prepare("DELETE FROM assignments WHERE system_id = ?").bind(id),
      db.prepare("DELETE FROM blockers WHERE system_id = ?").bind(id),
      // Its work items (feature requests included), with their comments, links, history and time logs.
      db.prepare("DELETE FROM systems WHERE id = ?").bind(id),
    ]);
    await audit(db, req, me, "system_deleted", id, { name: gone.name });
    return json({ ok: true });
  }

  // ----- update requests -----
  if (path === "/api/requests" && method === "POST") {
    need("request_updates");
    if (guest) {
      // A link is shared by several people: up to 10 requests an hour, so it can't be used to spam the team.
      const recent = await db
        .prepare("SELECT COUNT(*) AS n FROM requests WHERE requested_by = ? AND created_at > ?")
        .bind(me.id, new Date(Date.now() - 3_600_000).toISOString())
        .first<{ n: number }>();
      if ((recent?.n ?? 0) >= 10) throw new HttpError(429, "This link has made 10 update requests in the last hour. Try again later.");
    }
    const b = await body<{ systemId?: string; message?: string }>(req);
    const system = await getSystem(db, String(b.systemId ?? ""));
    const id = newToken().slice(0, 16);
    await db
      .prepare("INSERT INTO requests (id, system_id, requested_by, message, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, system.id, me.id, text(b.message, "Message") ?? "", now)
      .run();
    const asked = text(b.message, "Message") ?? "";
    await audit(db, req, me, "request_created", system.id, { name: system.name, message: asked });
    // Everyone working on the project hears: its developers and its lead.
    const team = (await db.prepare("SELECT user_id FROM assignments WHERE system_id = ?").bind(system.id).all<{ user_id: string }>()).results.map((r) => r.user_id);
    alert(
      [...new Set([...team, ...(system.lead ? [system.lead] : [])])].map((userId) => ({
        userId,
        kind: "update_requested" as const,
        title: `${me.name} asked for an update on ${system.name}`,
        body: asked,
        link: `#/projects/${system.id}`,
      })),
      { title: `${me.name} asked for an update on ${system.name}`, body: asked, link: `#/projects/${system.id}` },
    );
    return json({ ok: true }, 201);
  }

  const reqMatch = path.match(/^\/api\/requests\/([a-f0-9]+)$/);
  if (reqMatch && method === "DELETE") {
    const r = await db.prepare("SELECT * FROM requests WHERE id = ?").bind(reqMatch[1]).first<Record<string, string>>();
    if (!r) throw new HttpError(404, "Request not found");
    const mayDismiss = r.requested_by === me.id || can("manage_systems") || (await projectsOf(db, me.id)).includes(r.system_id);
    if (!mayDismiss) throw new HttpError(403, "You can't dismiss this request");
    await db.prepare("DELETE FROM requests WHERE id = ?").bind(r.id).run();
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(r.system_id).first<{ data: string }>();
    await audit(db, req, me, "request_dismissed", r.system_id, { name: sys ? JSON.parse(sys.data).name : r.system_id });
    return json({ ok: true });
  }

  // ----- project documents and blockers -----
  // The people working on a project add documents and raise blockers: its developers and lead,
  // and anyone who may edit any project.
  const mayContribute = async (system: System) =>
    can("edit_any") || can("manage_systems") || system.lead === me.id || (await projectsOf(db, me.id)).includes(system.id);

  const docsMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)\/documents$/);
  if (docsMatch && method === "POST") {
    const system = await getSystem(db, docsMatch[1]);
    if (!(await mayContribute(system))) throw new HttpError(403, "Only people on this project can add documents");
    const id = newToken().slice(0, 16);
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const form = await req.formData().catch(() => {
        throw new HttpError(400, "Couldn't read the upload");
      });
      const file = form.get("file");
      if (!file || typeof file === "string") throw new HttpError(400, "Choose a file to upload");
      if (file.size === 0) throw new HttpError(400, "That file is empty");
      if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, `Files can be up to ${formatBytes(MAX_DOCUMENT_BYTES)}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const name = (text(form.get("name"), "Name") || file.name || "document").slice(0, 200);
      const CHUNK = 1024 * 1024;
      const stmts = [
        db
          .prepare("INSERT INTO documents (id, system_id, name, kind, mime, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'file', ?, ?, ?, ?)")
          .bind(id, system.id, name, file.type || "application/octet-stream", bytes.length, me.id, now),
      ];
      for (let i = 0, seq = 0; i < bytes.length; i += CHUNK, seq++) {
        stmts.push(db.prepare("INSERT INTO document_chunks (doc_id, seq, data) VALUES (?, ?, ?)").bind(id, seq, bytes.slice(i, i + CHUNK)));
      }
      await db.batch(stmts);
      await audit(db, req, me, "document_added", system.id, { name: system.name, document: name, size: bytes.length });
    } else {
      const b = await body<{ name?: string; url?: string }>(req);
      const url = text(b.url, "Link", true)!;
      if (!/^https?:\/\/\S+$/i.test(url)) throw new HttpError(400, "Links must start with http:// or https://");
      const name = text(b.name, "Name") ?? url;
      await db
        .prepare("INSERT INTO documents (id, system_id, name, kind, url, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'link', ?, ?, ?)")
        .bind(id, system.id, name.slice(0, 200), url, me.id, now)
        .run();
      await audit(db, req, me, "document_added", system.id, { name: system.name, document: name, link: true });
    }
    return json({ ok: true, id }, 201);
  }

  const docMatch = path.match(/^\/api\/documents\/([a-f0-9]+)$/);
  if (docMatch && method === "GET") {
    const doc = await db.prepare("SELECT * FROM documents WHERE id = ? AND kind = 'file'").bind(docMatch[1]).first<Record<string, string>>();
    if (!doc) throw new HttpError(404, "Document not found");
    if (doc.work_item_id && ownFeaturesOnly) {
      const item = await itemById(itemCtx, doc.work_item_id);
      if (!item || (item.assignee !== me.id && item.reporter !== me.id)) throw new HttpError(404, "Document not found");
    }
    const chunks = await db.prepare("SELECT data FROM document_chunks WHERE doc_id = ? ORDER BY seq").bind(doc.id).all<{ data: ArrayBuffer | number[] }>();
    const parts = chunks.results.map((c) => new Uint8Array(c.data as ArrayBuffer));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
    // Uploads are untrusted: only PDFs and images open in the browser, everything else downloads,
    // and nothing served here may run script on this origin.
    const inline = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(doc.mime) && new URL(req.url).searchParams.get("download") === null;
    return new Response(out, {
      headers: {
        "content-type": inline ? doc.mime : "application/octet-stream",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        "cache-control": "private, max-age=300",
      },
    });
  }

  if (docMatch && method === "DELETE") {
    const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").bind(docMatch[1]).first<Record<string, string>>();
    if (!doc) throw new HttpError(404, "Document not found");
    if (doc.work_item_id) throw new HttpError(400, "Remove attachments from their work item");
    if (doc.uploaded_by !== me.id && !can("manage_systems")) throw new HttpError(403, "Only whoever added it or a manager can remove a document");
    await db.batch([
      db.prepare("DELETE FROM document_chunks WHERE doc_id = ?").bind(doc.id),
      db.prepare("DELETE FROM documents WHERE id = ?").bind(doc.id),
    ]);
    const system = await getSystem(db, doc.system_id).catch(() => null);
    await audit(db, req, me, "document_removed", doc.system_id, { name: system?.name ?? doc.system_id, document: doc.name });
    return json({ ok: true });
  }

  const blockersMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)\/blockers$/);
  if (blockersMatch && method === "POST") {
    const system = await getSystem(db, blockersMatch[1]);
    if (!(await mayContribute(system))) throw new HttpError(403, "Only people on this project can raise blockers");
    const b = await body<{ text?: string }>(req);
    const id = newToken().slice(0, 16);
    const blocker = text(b.text, "Blocker", true)!;
    await db.prepare("INSERT INTO blockers (id, system_id, text, raised_by, raised_at) VALUES (?, ?, ?, ?, ?)").bind(id, system.id, blocker, me.id, now).run();
    await audit(db, req, me, "blocker_raised", system.id, { name: system.name, blocker });
    return json({ ok: true, id }, 201);
  }

  const blockerMatch = path.match(/^\/api\/blockers\/([a-f0-9]+)$/);
  if (blockerMatch && (method === "PATCH" || method === "DELETE")) {
    const row = await db.prepare("SELECT * FROM blockers WHERE id = ?").bind(blockerMatch[1]).first<Record<string, string | null>>();
    if (!row) throw new HttpError(404, "Blocker not found");
    const system = await getSystem(db, row.system_id!);
    if (method === "DELETE") {
      // Deleting is for mistakes; real blockers get resolved so the history stays.
      if (row.raised_by !== me.id && !can("manage_systems")) throw new HttpError(403, "Only whoever raised it or a manager can delete a blocker");
      await db.prepare("DELETE FROM blockers WHERE id = ?").bind(row.id).run();
      await audit(db, req, me, "blocker_deleted", system.id, { name: system.name, blocker: row.text });
      return json({ ok: true });
    }
    if (!(await mayContribute(system))) throw new HttpError(403, "Only people on this project can resolve blockers");
    const b = await body<{ resolved?: boolean; resolution?: string }>(req);
    if (b.resolved === false) {
      await db.prepare("UPDATE blockers SET resolved_by = NULL, resolved_at = NULL, resolution = NULL WHERE id = ?").bind(row.id).run();
      await audit(db, req, me, "blocker_reopened", system.id, { name: system.name, blocker: row.text });
    } else {
      const resolution = text(b.resolution, "Resolution") ?? null;
      await db.prepare("UPDATE blockers SET resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ?").bind(me.id, now, resolution, row.id).run();
      await audit(db, req, me, "blocker_resolved", system.id, { name: system.name, blocker: row.text, ...(resolution ? { resolution } : {}) });
    }
    return json({ ok: true });
  }

  // Everything that happened to one project, for its page. Visible to everyone who can see the project.
  const historyMatch = path.match(/^\/api\/systems\/([a-z0-9-]+)\/history$/);
  if (historyMatch && method === "GET") {
    const rows = await db
      .prepare("SELECT id, at, user_id, actor, action, target, detail FROM activity WHERE target = ? ORDER BY id DESC LIMIT 100")
      .bind(historyMatch[1])
      .all<{ id: number; at: string; user_id: string | null; actor: string; action: string; target: string; detail: string }>();
    return json(
      rows.results
        .filter((r) => !ownFeaturesOnly || !(r.action.startsWith("feature_") || ITEM_ACTIONS.has(r.action)) || r.user_id === me.id)
        .map((r) => ({
        id: r.id,
        at: r.at,
        userId: r.user_id,
        actor: r.actor,
        action: r.action,
        target: r.target,
        detail: JSON.parse(r.detail || "{}"),
        ip: null,
        agent: null,
      })),
    );
  }

  if (path === "/api/settings/limits" && method === "PUT") {
    need("manage_users");
    const b = await body<Partial<Limits>>(req);
    const whole = (v: unknown, field: string, max: number) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `${field} must be a whole number from 1 to ${max}`);
      return n;
    };
    const current = await workloadLimits(db);
    const next: Limits = {
      projects: b.projects !== undefined ? whole(b.projects, "Projects per developer", 50) : current.projects,
      features: b.features !== undefined ? whole(b.features, "Feature requests per developer", 200) : current.features,
      stallDays: b.stallDays !== undefined ? whole(b.stallDays, "Days without progress", 365) : current.stallDays,
    };
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('workload_limits', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    await audit(db, req, me, "limits_updated", null, { from: current, to: next });
    return json(next);
  }

  // ----- project templates -----
  // Starting points for "Add system". Saved from scratch or from an existing project.
  if (path === "/api/templates" && method === "POST") {
    need("manage_systems");
    const b = await body<Partial<ProjectTemplate> & { fromSystem?: string }>(req);
    const name = text(b.name, "Template name", true)!.slice(0, 80);
    let data: Pick<ProjectTemplate, "description" | "status" | "progress" | "durationWeeks">;
    if (b.fromSystem) {
      // A template is for new projects, so a delivered one starts again from the beginning.
      const s = await getSystem(db, String(b.fromSystem));
      const weeks = s.dueAt ? Math.max(1, Math.round((Date.parse(s.dueAt) - Date.parse(s.startedAt)) / (7 * 86_400_000))) : undefined;
      data = {
        description: s.description,
        status: s.status === "LIVE" || s.status === "COMPLETED" ? "UPCOMING" : s.status,
        progress: 0,
        ...(weeks ? { durationWeeks: weeks } : {}),
      };
    } else {
      const weeks = b.durationWeeks === undefined || b.durationWeeks === null ? undefined : Number(b.durationWeeks);
      if (weeks !== undefined && (!Number.isInteger(weeks) || weeks < 1 || weeks > 260)) throw new HttpError(400, "Duration must be 1 to 260 weeks");
      data = {
        description: text(b.description, "Description") ?? "",
        status: checkStatus(b.status ?? "UPCOMING"),
        progress: checkProgress(b.progress ?? 0),
        ...(weeks ? { durationWeeks: weeks } : {}),
      };
    }
    let id = slug(name);
    for (let n = 2; await db.prepare("SELECT 1 FROM templates WHERE id = ?").bind(id).first(); n++) id = `${slug(name)}-${n}`;
    await db
      .prepare("INSERT INTO templates (id, name, summary, data, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, name, text(b.summary, "Summary") ?? "", JSON.stringify(data), me.id, now)
      .run();
    await audit(db, req, me, "template_created", null, { template: name, ...(b.fromSystem ? { from: b.fromSystem } : {}) });
    return json({ ok: true, id }, 201);
  }

  const templateMatch = path.match(/^\/api\/templates\/([a-z0-9-]+)$/);
  if (templateMatch && method === "DELETE") {
    need("manage_systems");
    const row = await db.prepare("SELECT name FROM templates WHERE id = ?").bind(templateMatch[1]).first<{ name: string }>();
    if (!row) throw new HttpError(404, "Template not found");
    await db.prepare("DELETE FROM templates WHERE id = ?").bind(templateMatch[1]).run();
    await audit(db, req, me, "template_deleted", null, { template: row.name });
    return json({ ok: true });
  }

  // ----- feature requests -----
  // Anyone with manage_features logs, edits and assigns them; the assigned developer keeps
  // the status and their notes current. With log_features (developers), people log requests
  // assigned to themselves or no one, and edit the details of the ones they logged.
  // Each feature request is a work item (source "client_request"); these endpoints keep their old
  // shape and rules and run on the work item code underneath. The `features` view reads them back.
  const featureRow = async (id: string) => (await db.prepare("SELECT * FROM features WHERE id = ?").bind(id).first<FeatureRow>())!;
  const featureLabels = async (id: string) =>
    (await db.prepare("SELECT label FROM work_item_labels WHERE item_id = ?").bind(id).all<{ label: string }>()).results.map((l) => l.label);

  if (path === "/api/features" && method === "POST") {
    if (!can("manage_features") && !can("log_features")) throw new HttpError(403, "You don't have permission to do that");
    const b = await body<Partial<Feature>>(req);
    if (!can("manage_features") && b.assignee && b.assignee !== me.id) throw new HttpError(403, "You can assign a request to yourself only. A manager assigns others.");
    const system = await getSystem(db, String(b.systemId ?? ""));
    const fields = featureToItem({
      systemId: system.id,
      title: text(b.title, "Feature", true)!,
      description: text(b.description, "Description") ?? "",
      kind: oneOf(b.kind ?? "CHANGE", FEATURE_KINDS, "request type"),
      client: text(b.client, "Requested by") ?? "",
      priority: oneOf(b.priority ?? "MEDIUM", PRIORITIES, "priority"),
      assignee: b.assignee,
      notes: text(b.notes, "Notes") ?? null,
      dueAt: checkDate(b.dueAt, "Expected delivery"),
    });
    // The assignee hears about it below, in the feature request's own words.
    const status = oneOf(b.status ?? "NOT_STARTED", FEATURE_STATUSES, "status");
    const quiet = { ...itemCtx, alert: () => undefined };
    const item = await createItem(quiet, fields, "client_request");
    // It starts where its workflow starts, then moves on through the workflow's moves if asked to.
    if (status !== "NOT_STARTED") await moveFeatureTo(quiet, item, status);
    const f = await featureRow(item.id);
    await audit(db, req, me, "feature_created", system.id, {
      name: system.name,
      title: f.title,
      priority: f.priority,
      key: f.item_key,
      ...(f.client ? { client: f.client } : {}),
      ...(f.assignee ? { assignee: f.assignee } : {}),
    });
    if (f.assignee) {
      alert(
        [{ userId: f.assignee, kind: "assigned", title: `New request assigned to you: ${f.title}`, body: `${system.name}, ${f.priority.toLowerCase()} priority. From ${me.name}.`, link: "view:features" }],
        { title: `${await nameOfUser(f.assignee)} was assigned "${f.title}"`, body: `${system.name}, ${f.priority.toLowerCase()} priority. From ${me.name}.`, link: `#/projects/${system.id}` },
      );
    }
    return json(toFeature(f), 201);
  }

  const featMatch = path.match(/^\/api\/features\/([a-z0-9-]+)$/);
  if (featMatch && method === "PATCH") {
    const row = await db.prepare("SELECT * FROM features WHERE id = ?").bind(featMatch[1]).first<FeatureRow>();
    if (!row || !(await seeFeature(row))) throw new HttpError(404, "Feature request not found");
    const b = await body<Partial<Feature>>(req);
    const manager = can("manage_features");
    const logger = !manager && can("log_features") && row.created_by === me.id;
    const developerFields = ["status", "notes"] as const;
    const otherFields = ["title", "description", "kind", "client", "priority", "assignee", "dueAt", "systemId"] as const;
    if (logger) {
      // Whoever logged it edits its details, but assigns only themselves.
      if (b.assignee && b.assignee !== me.id && b.assignee !== row.assignee) throw new HttpError(403, "You can assign a request to yourself only. A manager assigns others.");
      if (b.assignee !== undefined && row.assignee && row.assignee !== me.id && (b.assignee || null) !== row.assignee) {
        throw new HttpError(403, "A manager assigned this request; ask them to change the developer.");
      }
    } else if (!manager) {
      if (row.assignee !== me.id) throw new HttpError(403, "Only the assigned developer, whoever logged it, or a manager can update this request");
      if (otherFields.some((k) => b[k] !== undefined)) throw new HttpError(403, "You can update the status and your notes only");
    }
    const next: FeatureRow = { ...row };
    if (b.status !== undefined) next.status = oneOf(b.status, FEATURE_STATUSES, "status");
    if (b.notes !== undefined) next.notes = text(b.notes, "Notes") ?? null;
    if (b.title !== undefined) next.title = text(b.title, "Feature", true)!;
    if (b.description !== undefined) next.description = text(b.description, "Description") ?? "";
    if (b.kind !== undefined) next.kind = oneOf(b.kind, FEATURE_KINDS, "request type");
    if (b.client !== undefined) next.client = text(b.client, "Requested by") ?? "";
    if (b.priority !== undefined) next.priority = oneOf(b.priority, PRIORITIES, "priority");
    if (b.assignee !== undefined) next.assignee = text(b.assignee, "Developer") ?? null;
    if (b.dueAt !== undefined) next.due_at = checkDate(b.dueAt, "Expected delivery");
    if (b.systemId !== undefined) next.system_id = (await getSystem(db, String(b.systemId))).id;

    const columns: Record<(typeof developerFields)[number] | (typeof otherFields)[number], keyof FeatureRow> = {
      status: "status",
      notes: "notes",
      title: "title",
      description: "description",
      kind: "kind",
      client: "client",
      priority: "priority",
      assignee: "assignee",
      dueAt: "due_at",
      systemId: "system_id",
    };
    const changed = (Object.keys(columns) as (keyof typeof columns)[]).filter((k) => next[columns[k]] !== row[columns[k]]);
    if (!changed.length) return json(toFeature(row));
    const item = (await itemById(itemCtx, row.id))!;
    const given = Object.fromEntries(changed.filter((k) => k !== "status").map((k) => [k, next[columns[k]]])) as Parameters<typeof featureToItem>[0];
    const res = await applyChange(itemCtx, item, featureToItem(given, { type: item.type, labels: await featureLabels(row.id) }));
    await afterChange(itemCtx, res, false);
    // A new status is a move (or a few) in the project's workflow, under its rules.
    if (changed.includes("status")) await moveFeatureTo(itemCtx, res.after, next.status);
    const saved = await featureRow(row.id);
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(saved.system_id).first<{ data: string }>();
    await audit(db, req, me, "feature_updated", saved.system_id, {
      name: sys ? JSON.parse(sys.data).name : saved.system_id,
      title: saved.title,
      key: saved.item_key,
      fields: changed,
      ...(changed.includes("status") ? { status: { from: row.status, to: saved.status } } : {}),
      ...(changed.includes("priority") ? { priority: { from: row.priority, to: saved.priority } } : {}),
      ...(changed.includes("assignee") ? { assignee: { from: row.assignee, to: saved.assignee } } : {}),
      ...(changed.includes("systemId") ? { movedFrom: row.item_key } : {}),
    });
    if (changed.includes("assignee") && saved.assignee) {
      const project = sys ? (JSON.parse(sys.data) as System).name : saved.system_id;
      alert(
        [{ userId: saved.assignee, kind: "assigned", title: `Request assigned to you: ${saved.title}`, body: `${project}, ${saved.priority.toLowerCase()} priority. From ${me.name}.`, link: "view:features" }],
        { title: `${await nameOfUser(saved.assignee)} was assigned "${saved.title}"`, body: `${project}, ${saved.priority.toLowerCase()} priority. From ${me.name}.`, link: `#/projects/${saved.system_id}` },
      );
    }
    return json(toFeature(saved));
  }

  if (featMatch && method === "DELETE") {
    need("manage_features");
    const row = await db.prepare("SELECT * FROM features WHERE id = ?").bind(featMatch[1]).first<FeatureRow>();
    if (!row || !(await seeFeature(row))) throw new HttpError(404, "Feature request not found");
    await deleteItem(itemCtx, (await itemById(itemCtx, row.id))!);
    const sys = await db.prepare("SELECT data FROM systems WHERE id = ?").bind(row.system_id).first<{ data: string }>();
    await audit(db, req, me, "feature_deleted", row.system_id, { name: sys ? JSON.parse(sys.data).name : row.system_id, title: row.title, key: row.item_key });
    return json({ ok: true });
  }

  // ----- users, roles and permissions -----
  const checkProjectLimit = async (projectIds: string[], adding: boolean) => {
    const limit = (await workloadLimits(db)).projects;
    if (adding && projectIds.length > limit) {
      throw new HttpError(400, `A developer can be on at most ${limit} projects; this would give them ${projectIds.length}.`, "developer_full");
    }
  };
  const checkProjects = async (list: unknown): Promise<string[]> => {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw new HttpError(400, "Projects must be a list");
    const ids = [...new Set(list.map(String))];
    for (const id of ids) await getSystem(db, id);
    return ids;
  };
  /** "You were assigned to X", for projects given through the Users page. */
  const projectAlerts = async (userId: string, projectIds: string[]): Promise<Alert[]> =>
    Promise.all(
      projectIds.map(async (p) => ({
        userId,
        kind: "assigned" as const,
        title: `You were assigned to ${(await getSystem(db, p)).name}`,
        body: `${me.name} added you to this project.`,
        link: `#/projects/${p}`,
      })),
    );

  if (path === "/api/users" && method === "POST") {
    need("manage_users");
    const b = await body<Partial<User> & { password?: string }>(req);
    const username = text(b.username, "Username", true)!.toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, "Username: 3–32 letters, numbers, dots, dashes");
    if (await db.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first()) throw new HttpError(409, "That username is taken");
    const role = checkRole(b.role ?? "viewer");
    const projectIds = role === "developer" ? await checkProjects(b.projectIds) : [];
    await checkProjectLimit(projectIds, projectIds.length > 0);
    let id = slug(username);
    for (let n = 2; await db.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first(); n++) id = `${slug(username)}-${n}`;
    await db
      .prepare(
        // An administrator-issued password is temporary: the person chooses their own at first sign-in.
        `INSERT INTO users (id, username, name, title, email, phone, role, password_hash, must_change_password)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        id,
        username,
        text(b.name, "Name", true),
        text(b.title, "Title") ?? "",
        text(b.email, "Email") ?? null,
        text(b.phone, "Phone") ?? null,
        role,
        await hashPassword(checkPassword(b.password, { username, name: text(b.name, "Name", true) })),
      )
      .run();
    if (projectIds.length) {
      await db.batch(projectIds.map((p) => db.prepare("INSERT INTO assignments (user_id, system_id) VALUES (?, ?)").bind(id, p)));
      alert(await projectAlerts(id, projectIds));
    }
    await audit(db, req, me, "user_created", id, { name: text(b.name, "Name", true), username, role });
    return json({ ok: true, id }, 201);
  }

  const resetMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)\/reset-password$/);
  if (resetMatch && method === "POST") {
    need("manage_users");
    if (resetMatch[1] === me.id) throw new HttpError(400, "Change your own password in Settings");
    const row = await db
      .prepare("SELECT id, name, password_hash FROM users WHERE id = ?")
      .bind(resetMatch[1])
      .first<{ id: string; name: string; password_hash: string }>();
    if (!row) throw new HttpError(404, "User not found");
    const temp = tempPassword();
    await db.batch([
      db.prepare("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").bind(await hashPassword(temp), row.id),
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
      // The password being replaced still can't come back when they choose their own.
      ...rememberPassword(db, row.id, row.password_hash, now),
    ]);
    await audit(db, req, me, "user_password_reset", row.id, { name: row.name });
    // Shown once to the administrator; only its hash is stored.
    return json({ password: temp });
  }

  // Lifts a sign-in lock early. The count of wrong passwords starts again from nothing.
  const unlockMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)\/unlock$/);
  if (unlockMatch && method === "POST") {
    need("manage_users");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(unlockMatch[1]).first<UserRow>();
    if (!row) throw new HttpError(404, "User not found");
    if (!isLocked(row)) throw new HttpError(400, `${row.name}'s account isn't locked`);
    await db.batch([
      db.prepare("UPDATE users SET locked_until = NULL, locked_at = NULL WHERE id = ?").bind(row.id),
      db.prepare("DELETE FROM login_failures WHERE user_id = ?").bind(row.id),
    ]);
    await audit(db, req, me, "account_unlocked", row.id, {
      name: row.name,
      username: row.username,
      lockedAt: row.locked_at,
      wasLockedUntil: new Date(row.locked_until!).toISOString(),
    });
    return json({ ok: true });
  }

  const userMatch = path.match(/^\/api\/users\/([a-z0-9._-]+)$/);
  if (userMatch && method === "PATCH") {
    need("manage_users");
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userMatch[1]).first<UserRow>();
    if (!row) throw new HttpError(404, "User not found");
    const b = await body<Partial<User> & { password?: string }>(req);
    const role = b.role !== undefined ? checkRole(b.role) : row.role;
    if (row.role === "admin" && role !== "admin" && (await adminCount(db)) <= 1) {
      throw new HttpError(400, "There must always be at least one administrator");
    }
    const before = await projectsOf(db, row.id);
    const projectIds = role !== "developer" ? [] : b.projectIds !== undefined ? await checkProjects(b.projectIds) : before;
    // Taking projects away is always fine; adding is only allowed up to the limit.
    await checkProjectLimit(projectIds, projectIds.some((p) => !before.includes(p)));
    let newHash: string | null = null;
    if (b.password) {
      const pw = checkPassword(b.password, { username: row.username, name: b.name ?? row.name });
      // Your own password is yours to choose, so the no-reuse rule applies; one set for someone
      // else is temporary and replaced at their next sign-in.
      if (row.id === me.id) await checkNotReused(db, row.id, pw, row.password_hash);
      newHash = await hashPassword(pw);
    }
    await db
      .prepare(
        `UPDATE users SET name = ?, title = ?, email = ?, phone = ?, role = ?,
         password_hash = COALESCE(?, password_hash), must_change_password = ? WHERE id = ?`,
      )
      .bind(
        b.name !== undefined ? text(b.name, "Name", true) : row.name,
        b.title !== undefined ? text(b.title, "Title") ?? "" : row.title,
        b.email !== undefined ? text(b.email, "Email") ?? null : row.email,
        b.phone !== undefined ? text(b.phone, "Phone") ?? null : row.phone,
        role,
        newHash,
        // A password an admin sets for someone else is temporary: they choose their own at sign-in.
        newHash && row.id !== me.id ? 1 : newHash ? 0 : row.must_change_password,
        row.id,
      )
      .run();
    if (newHash) await db.batch(rememberPassword(db, row.id, row.password_hash, now));
    const added = projectIds.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !projectIds.includes(p));
    if (added.length || removed.length) {
      await db.batch([
        ...added.map((p) => db.prepare("INSERT INTO assignments (user_id, system_id) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(row.id, p)),
        ...removed.map((p) => db.prepare("DELETE FROM assignments WHERE user_id = ? AND system_id = ?").bind(row.id, p)),
      ]);
      if (added.length) alert(await projectAlerts(row.id, added));
    }
    // Feature requests can only be assigned to developers, and Standard users can't be assigned work.
    if (role !== "developer" && row.role === "developer") {
      await db.prepare("UPDATE work_items SET assignee = NULL WHERE assignee = ? AND source = 'client_request'").bind(row.id).run();
    }
    if (role === "viewer" && row.role !== "viewer") await db.prepare("UPDATE work_items SET assignee = NULL WHERE assignee = ?").bind(row.id).run();
    // A password reset signs the user out everywhere.
    if (b.password) await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
    const fieldsChanged = (["name", "title", "email", "phone"] as const).filter((f) => {
      const was = row[f] ?? "";
      return b[f] !== undefined && (b[f] ?? "") !== was;
    });
    const changes: Record<string, unknown> = {};
    if (role !== row.role) changes.role = { from: row.role, to: role };
    if (added.length || removed.length) changes.projects = { added, removed };
    if (fieldsChanged.length) changes.fields = fieldsChanged;
    if (b.password) changes.passwordSet = true;
    if (Object.keys(changes).length) await audit(db, req, me, "user_updated", row.id, { name: b.name ?? row.name, ...changes });
    return json({ ok: true });
  }

  if (userMatch && method === "DELETE") {
    need("manage_users");
    if (userMatch[1] === me.id) throw new HttpError(400, "You can't delete your own account");
    const row = await db
      .prepare("SELECT role, name, username FROM users WHERE id = ?")
      .bind(userMatch[1])
      .first<{ role: Role; name: string; username: string }>();
    if (!row) throw new HttpError(404, "User not found");
    if (row.role === "admin" && (await adminCount(db)) <= 1) throw new HttpError(400, "There must always be at least one administrator");
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM mfa_recovery WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM password_history WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM mfa_challenges WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM mfa_help_requests WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM requests WHERE requested_by = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM assignments WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM login_failures WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("UPDATE work_items SET assignee = NULL WHERE assignee = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM work_item_watchers WHERE user_id = ?").bind(userMatch[1]),
      db.prepare("DELETE FROM users WHERE id = ?").bind(userMatch[1]),
    ]);
    await audit(db, req, me, "user_deleted", userMatch[1], { name: row.name, username: row.username, role: row.role });
    return json({ ok: true });
  }

  if (path === "/api/roles" && method === "PUT") {
    need("manage_users");
    const b = await body<Partial<RolePermissions>>(req);
    const valid = new Set(DEFAULT_ROLE_PERMISSIONS.admin);
    const next = { ...matrix };
    for (const role of ROLES) {
      if (role === "admin" || !Array.isArray(b[role])) continue;
      next[role] = b[role]!.filter((p): p is Permission => valid.has(p as Permission));
    }
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('role_permissions', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(next))
      .run();
    const changes: Record<string, { added: Permission[]; removed: Permission[] }> = {};
    for (const role of ROLES) {
      const added = next[role].filter((p) => !matrix[role].includes(p));
      const removed = matrix[role].filter((p) => !next[role].includes(p));
      if (added.length || removed.length) changes[role] = { added, removed };
    }
    if (Object.keys(changes).length) await audit(db, req, me, "roles_updated", null, { changes });
    return json(next);
  }

  // ----- activity log -----
  if (path === "/api/activity" && method === "GET") {
    need("audit_log");
    const q = new URL(req.url).searchParams;
    const limit = Math.min(500, Math.max(1, Number(q.get("limit")) || 100));
    const where: string[] = [];
    const args: unknown[] = [];
    const before = Number(q.get("before"));
    if (before > 0) {
      where.push("id < ?");
      args.push(before);
    }
    const user = q.get("user");
    if (user) {
      where.push("user_id = ?");
      args.push(user);
    }
    const kind = ACTIVITY_KINDS[q.get("kind") ?? ""];
    if (kind) {
      where.push(`action IN (${kind.map(() => "?").join(", ")})`);
      args.push(...kind);
    }
    const search = (q.get("q") ?? "").trim().slice(0, 64);
    if (search) {
      where.push("(actor ILIKE ? OR detail ILIKE ? OR ip ILIKE ?)");
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const rows = await db
      .prepare(`SELECT * FROM activity ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
      .bind(...args, limit + 1)
      .all<{ id: number; at: string; user_id: string | null; actor: string; action: string; target: string | null; detail: string; ip: string | null; agent: string | null }>();
    const page = rows.results.slice(0, limit);
    const items = page.map((r) => ({
      id: r.id,
      at: r.at,
      userId: r.user_id,
      actor: r.actor,
      action: r.action,
      target: r.target,
      detail: JSON.parse(r.detail || "{}"),
      ip: r.ip,
      agent: r.agent,
    }));
    const next = rows.results.length > limit ? page.at(-1)!.id : null;
    let stats: Record<string, number> | undefined;
    if (!before) {
      const day = new Date(Date.now() - 86_400_000).toISOString();
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const s = await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM activity WHERE action = 'login' AND at >= ?) AS signins24h,
             (SELECT COUNT(*) FROM activity WHERE action = 'login_failed' AND at >= ?) AS failed24h,
             (SELECT COUNT(DISTINCT user_id) FROM activity WHERE action = 'login' AND at >= ?) AS active7d,
             (SELECT COUNT(*) FROM activity WHERE action NOT IN ('login', 'logout', 'logout_all', 'login_failed') AND at >= ?) AS changes7d`,
        )
        .bind(day, day, week, week)
        .first<Record<string, number>>();
      stats = s ?? undefined;
    }
    return json({ items, next, ...(stats ? { stats } : {}) });
  }

  throw new HttpError(404, "Not found");
}

/**
 * The database this deploy uses: Postgres (Neon, through Hyperdrive) unless DATABASE is "d1", which
 * switches back to the old D1 database. The rest of the Worker only ever sees env.DB.
 */
function withDatabase(env: Env): Env {
  if (env.DATABASE === "d1") {
    if (!env.D1) throw new Error("DATABASE is d1 but there's no D1 binding");
    return { ...env, DB: env.D1 };
  }
  if (!env.HYPERDRIVE) throw new Error("No database: the HYPERDRIVE binding is missing");
  return { ...env, DB: pgDatabase(env.HYPERDRIVE.connectionString) };
}

export default {
  async fetch(req: Request, rawEnv: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (!path.startsWith("/api/")) return rawEnv.ASSETS.fetch(req);
    try {
      const env = withDatabase(rawEnv);
      return await api(req, env, path, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.extra ?? {}) }, e.status);
      console.error(e);
      return json({ error: "Something went wrong" }, 500);
    }
  },

  // One hourly trigger (wrangler.jsonc); worker/schedule.ts says what's due. Every hour: filter subscriptions
  // and scheduled automation rules. Weekdays at 07:00 Harare: the retention clean-up and daily digests.
  // Mondays at 08:00 Harare: the Monday Briefing.
  async scheduled(event: { cron: string; scheduledTime?: number }, rawEnv: Env) {
    const env = withDatabase(rawEnv);
    const due = dueJobs(event.scheduledTime ?? Date.now());
    if (due.dailyDigest) {
      await purgeExpired(env.DB).catch((e) => console.error("Retention clean-up failed", e));
      await runDailyDigests(env).catch((e) => noteFailure(env.DB, "Daily digest", e));
    }
    if (due.mondayBriefing) await runBriefing(env).catch((e) => noteFailure(env.DB, "Monday Briefing", e));
    await runSubscriptions(env).catch((e) => noteFailure(env.DB, "Filter subscriptions", e));
    await runScheduledRules(env).catch((e) => console.error("Scheduled automation failed", e));
    await runSlaChecks(env).catch((e) => noteFailure(env.DB, "Service desk SLA alerts", e));
    await retryWebhooks(env).catch((e) => console.error("Webhook retries failed", e));
  },
};
