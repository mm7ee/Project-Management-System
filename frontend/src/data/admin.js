/** @import { Role } from './roles' */
export {}; // the type imports above belong to the file, not to the first declaration
/** @type {{ key: NotificationEvent; label: string; help: string }[]} */ export const NOTIFICATION_EVENTS = [
  { key: "item_created", label: "A work item is created", help: "Someone creates a work item." },
  { key: "item_assigned", label: "A work item is assigned", help: "Someone becomes the assignee." },
  { key: "item_updated", label: "A work item is changed", help: "Its fields, links or attachments change." },
  { key: "item_transitioned", label: "A work item moves status", help: "It moves to another status." },
  { key: "item_commented", label: "A comment is added", help: "Someone comments on it." },
];
/** @type {{ key: "assignee" | "reporter" | "watchers" | "lead" | "mentioned"; label: string }[]} */ export const RECIPIENTS = [
  { key: "assignee", label: "Assignee" },
  { key: "reporter", label: "Reporter" },
  { key: "watchers", label: "Watchers" },
  { key: "lead", label: "Project lead" },
  { key: "mentioned", label: "@mentioned people" },
];
/** @type {Record<CustomFieldKind, string>} */ export const CUSTOM_FIELD_KINDS = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Single select",
  multiselect: "Multi select",
  user: "Person",
};
export const MAX_CUSTOM_FIELDS = 30;
export const MAX_FIELD_OPTIONS = 50;
export const TOKEN_PREFIX = "pulse_";
export const TOKEN_DAYS = [7, 30, 90, 180, 365];
export const MAX_TOKENS_PER_PERSON = 10;
/**
 * Requests per token per minute.
 * @type {120}
 */
export const API_RATE_LIMIT = 120;
/** @type {{ key: WebhookEvent; label: string; header: string }[]} */ export const WEBHOOK_EVENTS = [
  { key: "created", label: "Work item created", header: "work_item.created" },
  { key: "updated", label: "Work item updated", header: "work_item.updated" },
  { key: "transitioned", label: "Work item moved status", header: "work_item.transitioned" },
  { key: "commented", label: "Comment added", header: "work_item.commented" },
];
/**
 * How long to wait before each retry (attempts 2 to 6), in minutes.
 * @type {number[]}
 */
export const WEBHOOK_BACKOFF_MINUTES = [0.25, 60, 120, 240, 480];
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** @typedef {"item_created" | "item_assigned" | "item_updated" | "item_transitioned" | "item_commented"} NotificationEvent */
/** @typedef {"text" | "number" | "date" | "select" | "multiselect" | "user"} CustomFieldKind */
/**
 * A value as the API sends and takes it: text, a number, a date, a user id, or option ids.
 * @typedef {string | number | string[] | null} CustomValue
 */
/** @typedef {"commit" | "branch" | "pull_request"} DevLinkKind */
/** @typedef {"read" | "write"} TokenScope */
/** @typedef {"created" | "updated" | "transitioned" | "commented"} WebhookEvent */
/**
 * @typedef {Object} NotificationScheme
 * @property {NotificationEvent} event
 * @property {boolean} assignee
 * @property {boolean} reporter
 * @property {boolean} watchers
 * @property {boolean} lead
 * @property {boolean} mentioned
 * @property {Role} [role]
 * @property {boolean} bell
 * @property {boolean} email
 * @property {boolean} teams
 */
/**
 * @typedef {Object} SecurityLevel
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {Role[]} roles
 * @property {string[]} people
 * @property {number} items
 */
/**
 * @typedef {Object} CustomFieldOption
 * @property {string} id
 * @property {string} label
 */
/**
 * @typedef {Object} CustomField
 * @property {string} id
 * @property {string} workspace
 * @property {string} name
 * @property {CustomFieldKind} kind
 * @property {string} description
 * @property {boolean} required
 * @property {boolean} onCreate
 * @property {boolean} onEdit
 * @property {boolean} onView
 * @property {boolean} onBoard
 * @property {CustomFieldOption[]} options
 */
/**
 * @typedef {Object} CustomFieldValue
 * @property {string} fieldId
 * @property {string} name
 * @property {CustomFieldKind} kind
 * @property {CustomValue} value
 * @property {string} display
 */
/**
 * @typedef {Object} DevLink
 * @property {string} id
 * @property {DevLinkKind} kind
 * @property {string} repo
 * @property {string} ref
 * @property {string} title
 * @property {string} url
 * @property {string} author
 * @property {"open" | "merged" | "closed"} [state]
 * @property {string} at
 */
/**
 * @typedef {Object} ApiToken
 * @property {string} id
 * @property {string} userId
 * @property {string} [userName]
 * @property {string} name
 * @property {string} prefix
 * @property {TokenScope} scope
 * @property {string} createdAt
 * @property {string} expiresAt
 * @property {string} [lastUsedAt]
 * @property {string} [revokedAt]
 */
/**
 * @typedef {Object} Webhook
 * @property {string} id
 * @property {string} name
 * @property {string} url
 * @property {string} [systemId]
 * @property {WebhookEvent[]} events
 * @property {boolean} enabled
 * @property {string} createdAt
 * @property {{ status: "pending" | "delivered" | "failed"; at: string; code?: number; error?: string }} [lastDelivery]
 */
/**
 * @typedef {Object} WebhookDelivery
 * @property {number} id
 * @property {string} event
 * @property {string} [itemKey]
 * @property {"pending" | "delivered" | "failed"} status
 * @property {number} attempts
 * @property {string} [nextAttemptAt]
 * @property {number} [lastStatus]
 * @property {string} [lastError]
 * @property {string} createdAt
 * @property {string} [deliveredAt]
 */
