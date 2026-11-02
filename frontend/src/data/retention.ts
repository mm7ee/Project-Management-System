// Data retention policy (ISO 27001 A.5.33, A.8.10): how long Pulse keeps each kind of record. The
// Worker's weekday-morning clean-up (worker/retention.ts) enforces these numbers; Settings shows them to everyone.

/** The activity log: sign-ins, failed sign-ins and every change. */
export const AUDIT_DAYS = 365;
/** Notifications under the bell, read or not. */
export const NOTIFICATION_DAYS = 90;
/** Share links, once they have expired or been revoked (the activity log keeps their history). */
export const SHARE_LINK_DAYS = 90;
/** Requests for two-step verification help, once handled. They hold the requester's IP address. */
export const MFA_HELP_DAYS = 90;
/** Sign-in sessions last this long, then are removed. */
export const SESSION_DAYS = 7;

export interface RetentionRule {
  what: string;
  kept: string;
}

export const RETENTION: RetentionRule[] = [
  { what: "Projects, features, documents, blockers and concept notes", kept: "For the life of the project, until someone with permission deletes it" },
  { what: "User accounts", kept: "Until an administrator removes the person; their sessions, codes, passkeys and notifications go with them" },
  { what: "Activity log (sign-ins, failed sign-ins, changes, IP addresses)", kept: "12 months" },
  { what: "Notifications and digests", kept: `${NOTIFICATION_DAYS} days` },
  { what: "Expired or revoked share links", kept: `${SHARE_LINK_DAYS} days` },
  { what: "Handled two-step verification help requests", kept: `${MFA_HELP_DAYS} days` },
  { what: "Sign-in sessions", kept: `${SESSION_DAYS} days, or until you sign out` },
  { what: "Used recovery codes, expired sign-in and passkey challenges", kept: "Removed the next weekday morning" },
  { what: "Previous passwords (hashed, to stop reuse)", kept: "The four most recent" },
];
