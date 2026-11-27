// Data retention policy (ISO 27001 A.5.33, A.8.10): how long PMS keeps each kind of record. The
// Worker's weekday-morning clean-up (worker/retention.ts) enforces these numbers; Settings shows them to everyone.
/**
 * The activity log: sign-ins, failed sign-ins and every change.
 * @type {365}
 */
export const AUDIT_DAYS = 365;
/**
 * Notifications under the bell, read or not.
 * @type {90}
 */
export const NOTIFICATION_DAYS = 90;
/**
 * Share links, once they have expired or been revoked (the activity log keeps their history).
 * @type {90}
 */
export const SHARE_LINK_DAYS = 90;
/**
 * Requests for two-step verification help, once handled. They hold the requester's IP address.
 * @type {90}
 */
export const MFA_HELP_DAYS = 90;
/**
 * Sign-in sessions last this long, then are removed.
 * @type {7}
 */
export const SESSION_DAYS = 7;
/**
 * Automation rules' run logs.
 * @type {90}
 */
export const AUTOMATION_RUN_DAYS = 90;
/**
 * Outbound webhook deliveries (their payloads) and GitHub delivery ids.
 * @type {30}
 */
export const WEBHOOK_DELIVERY_DAYS = 30;
/**
 * Personal API tokens, once expired or revoked; service desk portal links, once expired or revoked.
 * @type {90}
 */
export const EXPIRED_TOKEN_DAYS = 90;
/**
 * Per-minute API request counters behind the rate limit.
 * @type {24}
 */
export const API_USAGE_HOURS = 24;
/**
 * Failed sign-in counters (the username tried and the IP address), used for the lockout.
 * @type {24}
 */
export const SIGNIN_FAILURE_HOURS = 24;
/** @type {RetentionRule[]} */ export const RETENTION = [
  { what: "Projects, features, documents, blockers and concept notes", kept: "For the life of the project, until someone with permission deletes it" },
  {
    what: "Work items, with their comments, attachments, links, time logs and status history",
    kept: "For the life of the project, until someone with permission deletes the item (its sub-tasks go with it)",
  },
  { what: "Watchers of a work item", kept: "Until they stop watching, or are removed from the organisation" },
  { what: "Statuses, workflows and which workspace or project uses each", kept: "Until someone allowed to edit workflows changes or deletes them" },
  { what: "Boards, their columns and work-in-progress limits", kept: "For the life of the project or workspace" },
  { what: "Sprints, which work items were in them, and their completed-sprint snapshots", kept: "For the life of the project; a sprint that never started can be deleted" },
  { what: "Saved filters, their favourites and email subscriptions, and dashboards", kept: "Until whoever made them deletes them; a removed person's favourites and subscriptions go with them" },
  { what: "Automation rules", kept: "Until someone who manages automation deletes them" },
  { what: "Automation run logs", kept: `${AUTOMATION_RUN_DAYS} days` },
  { what: "Notification schemes, security levels and custom field definitions", kept: "Until someone who manages schemes changes or deletes them" },
  { what: "Custom field values, security levels on items, and commits, branches and pull requests linked from GitHub", kept: "With the work item" },
  { what: "Your notification opt-outs", kept: "Until you change them, or are removed from the organisation" },
  { what: "Service desk requests, the customer's name and email, their answers and SLA pauses", kept: "With the work item, until someone with permission deletes it" },
  { what: "Service desk request types, SLA targets and public holidays", kept: "Until someone who sets up the service desk changes them" },
  { what: "Expired or revoked service desk portal links", kept: `${EXPIRED_TOKEN_DAYS} days` },
  { what: "Personal API tokens (stored as a hash)", kept: `Until they expire or are revoked, then ${EXPIRED_TOKEN_DAYS} days; a removed person's tokens go with them` },
  { what: "API request counters (for the rate limit)", kept: `${API_USAGE_HOURS} hours` },
  { what: "Outbound webhooks and the GitHub secret (sealed)", kept: "Until an administrator deletes or disconnects them" },
  { what: "Webhook deliveries (what was sent) and GitHub delivery records", kept: `${WEBHOOK_DELIVERY_DAYS} days` },
  { what: "User accounts", kept: "Until an administrator removes the person; their sessions, codes, passkeys and notifications go with them" },
  { what: "Activity log (sign-ins, failed sign-ins, changes, IP addresses)", kept: "12 months" },
  { what: "Notifications and digests", kept: `${NOTIFICATION_DAYS} days` },
  { what: "Expired or revoked share links", kept: `${SHARE_LINK_DAYS} days` },
  { what: "Handled two-step verification help requests", kept: `${MFA_HELP_DAYS} days` },
  { what: "Forgot-password requests (what was typed, the IP address, and the reset link's hash)", kept: "24 hours" },
  { what: "Sign-in sessions", kept: `${SESSION_DAYS} days, or until you sign out` },
  { what: "Failed sign-in counters (username tried, IP address) behind the lockout", kept: `${SIGNIN_FAILURE_HOURS} hours` },
  { what: "Used recovery codes, expired sign-in and passkey challenges", kept: "Removed the next weekday morning" },
  { what: "Previous passwords (hashed, to stop reuse)", kept: "The four most recent" },
];
/**
 * @typedef {Object} RetentionRule
 * @property {string} what
 * @property {string} kept
 */
