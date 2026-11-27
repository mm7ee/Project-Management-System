// Notifications and digests, shared by the Worker (which writes them) and the bell in the app.
export {};
/** @typedef {"assigned" | "update_requested" | "signature" | "daily_digest" | "monday_briefing" | "account_locked" | "mentioned" | "watching" | "sprint" | "subscription" | "automation" | "service_desk" | "sla" | "chat" | "approval"} NotificationKind */
/**
 * @typedef {Object} DigestItem
 * @property {string} text
 * @property {string} [link]
 */
/**
 * @typedef {Object} DigestSection
 * @property {string} title
 * @property {DigestItem[]} items
 */
/**
 * A daily digest or Monday Briefing. The sections come straight from the data; only `summary` may be AI-written.
 * @typedef {Object} Digest
 * @property {string} title
 * @property {string} period
 * @property {string} [writtenAt]
 * @property {string} summary
 * @property {boolean} aiWritten
 * @property {DigestSection[]} sections
 */
/**
 * @typedef {Object} AppNotification
 * @property {string} id
 * @property {NotificationKind} kind
 * @property {string} title
 * @property {string} body
 * @property {string} [link]
 * @property {Digest} [digest]
 * @property {string} createdAt
 * @property {string} [readAt]
 */
/**
 * @typedef {Object} NotificationFeed
 * @property {AppNotification[]} items
 * @property {number} unread
 */
/**
 * Administrators: how alerts and digests leave Pulse. Secrets are never sent back, only whether they're set.
 * @typedef {Object} DeliveryStatus
 * @property {Object} email
 * @property {boolean} email.configured
 * @property {string} email.from
 * @property {Object} teams
 * @property {boolean} teams.configured
 * @property {string[]} briefingEmails
 * @property {{ channel: string; message: string; at: string }} [lastError]
 * @property {number} demoProjects
 */
