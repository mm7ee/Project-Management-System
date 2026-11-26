/** @import { CustomField, CustomFieldValue, DevLink } from './admin' */
/** @import { RequestInfo } from './servicedesk' */
export {}; // the type imports above belong to the file, not to the first declaration
/** @type {Record<WorkItemType, { label: string; tone: string }>} */ export const TYPE_META = {
  EPIC: { label: "Epic", tone: "violet" },
  STORY: { label: "Story", tone: "green" },
  TASK: { label: "Task", tone: "cyan" },
  BUG: { label: "Bug", tone: "red" },
  SUBTASK: { label: "Sub-task", tone: "slate" },
};
export const WORK_TYPES = /** @type {WorkItemType[]} */ (Object.keys(TYPE_META));
/** Phase 1's four statuses, for reading old activity log entries. Statuses now live in the database. */
/** @type {Record<string, { label: string; category: StatusCategory; tone: string }>} */ export const STATUS_META = {
  TODO: { label: "To Do", category: "TODO", tone: "slate" },
  IN_PROGRESS: { label: "In Progress", category: "IN_PROGRESS", tone: "cyan" },
  IN_REVIEW: { label: "In Review", category: "IN_PROGRESS", tone: "violet" },
  DONE: { label: "Done", category: "DONE", tone: "green" },
};
/** Each category's colour. */
/** @type {Record<StatusCategory, string>} */ export const CATEGORY_TONE = { TODO: "slate", IN_PROGRESS: "cyan", DONE: "green" };
/** Highest first. */
/** @type {Record<WorkPriority, { label: string; rank: number }>} */ export const WORK_PRIORITY_META = {
  HIGHEST: { label: "Highest", rank: 0 },
  HIGH: { label: "High", rank: 1 },
  MEDIUM: { label: "Medium", rank: 2 },
  LOW: { label: "Low", rank: 3 },
  LOWEST: { label: "Lowest", rank: 4 },
};
export const WORK_PRIORITIES = /** @type {WorkPriority[]} */ (Object.keys(WORK_PRIORITY_META));
/** @type {Record<Resolution, string>} */ export const RESOLUTION_META = { DONE: "Done", WONT_DO: "Won't do" };
/** How each link reads from either end. */
/** @type {Record<LinkType, { outward: string; inward: string }>} */ export const LINK_META = {
  BLOCKS: { outward: "blocks", inward: "is blocked by" },
  RELATES: { outward: "relates to", inward: "relates to" },
  DUPLICATES: { outward: "duplicates", inward: "is duplicated by" },
  CLONES: { outward: "clones", inward: "is cloned by" },
};
export const LINK_TYPES = /** @type {LinkType[]} */ (Object.keys(LINK_META));
/**
 * A feature request's kind is kept as one of these labels on its work item.
 * @type {{ NEW_MODULE: string; CHANGE: string; ENHANCEMENT: string; BUG_FIX: string; }}
 */
export const KIND_LABELS = /** @type {const} */ ({ NEW_MODULE: "new-module", CHANGE: "change", ENHANCEMENT: "enhancement", BUG_FIX: "bug-fix" });
export const MAX_LABELS = 10;
export const MAX_SUMMARY = 255;
export const MAX_DESCRIPTION = 20000;
export const MAX_COMMENT = 10000;
/**
 * Items per page in lists.
 * @type {50}
 */
export const PAGE_SIZE = 50;
export const isDone =
  /** @param {{ statusCategory: StatusCategory }} i
   * @returns {boolean}
   */ (i) => i.statusCategory === "DONE";
/**
 * Which types may sit under which: Epic → Story/Task/Bug → Sub-task.
 * @param {WorkItemType} type
 * @returns {WorkItemType[] | null}
 */
export function allowedParentTypes(type) {
  if (type === "EPIC") return null; // an epic has no parent
  if (type === "SUBTASK") return ["STORY", "TASK", "BUG"];
  return ["EPIC"];
}
/**
 * Why `type` can't sit under a parent of `parentType` (or under nothing), or null when it can.
 * @param {WorkItemType} type
 * @param {WorkItemType | null} parentType
 * @returns {string | null}
 */
export function parentProblem(type, parentType) {
  const allowed = allowedParentTypes(type);
  if (!parentType) return type === "SUBTASK" ? "A sub-task needs a parent story, task or bug" : null;
  if (!allowed) return "An epic can't have a parent";
  if (!allowed.includes(parentType)) {
    return type === "SUBTASK" ? "A sub-task's parent must be a story, task or bug" : `A ${TYPE_META[type].label.toLowerCase()}'s parent must be an epic`;
  }
  return null;
}
/** The types an item's children may have. */
export const childTypesOf =
  /**
   * @param {WorkItemType} type
   * @returns {WorkItemType[]}
   */ (type) => (type === "EPIC" ? ["STORY", "TASK", "BUG"] : type === "SUBTASK" ? [] : ["SUBTASK"]);
/** Percentage of children done, or null with none. */
export const rollup =
  /** @param {{ total: number; done: number }} [c]
   * @returns {number | null}
   */ (c) => (c && c.total ? Math.round((c.done / c.total) * 100) : null);
export const KEY_PATTERN = /^[A-Z]{2,10}$/;
export const ITEM_KEY_PATTERN = /^([A-Z]{2,10})-(\d{1,7})$/;
const STOP_WORDS = new Set(["A", "AN", "AND", "FOR", "IN", "OF", "ON", "THE", "TO", "WITH"]);
/**
 * A project key from its name: the initials of a name of several words ("Leave Planner" → LP),
 * or the first five letters of a one-word name ("Infrastructure" → INFRA). When `taken` holds it,
 * a letter is added (LPA, LPB…). The database migration uses the same rule for existing projects.
 * @param {string} name
 * @param {Iterable<string>} [taken=[]]
 * @returns {string}
 */
export function suggestKey(name, taken = []) {
  const used = new Set(taken);
  let words = name
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const kept = words.filter((w) => !STOP_WORDS.has(w));
  if (kept.length >= 2) words = kept;
  const base =
    words.length >= 2
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 10)
      : words.length === 1
        ? words[0].slice(0, 5).padEnd(2, "X")
        : "PRJ";
  let cand = base;
  for (let n = 1; used.has(cand); n++) {
    cand = n <= 26 ? base.slice(0, 9) + String.fromCharCode(64 + n) : base.slice(0, 8) + String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));
  }
  return cand;
}
/**
 * Labels are short lower-case words: spaces become hyphens; anything else is dropped.
 * @param {string} raw
 * @returns {string}
 */
export function cleanLabel(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}
/**
 * "1h 30m", "2d 4h": time in a working day of 8 hours, as Jira shows it.
 * @param {number | null} [min]
 * @returns {string}
 */
export function formatMinutes(min) {
  if (min == null) return "—";
  if (min <= 0) return "0m";
  const d = Math.floor(min / 480);
  const h = Math.floor((min % 480) / 60);
  const m = min % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}
/**
 * Reads "1d 2h 30m", "3h", "45m" or a plain number of hours ("1.5"); null when it can't.
 * @param {string} text
 * @returns {number | null}
 */
export function parseDuration(text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
  let total = 0;
  let matched = "";
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*([dhm])/g)) {
    total += Number(m[1]) * (m[2] === "d" ? 480 : m[2] === "h" ? 60 : 1);
    matched += m[0];
  }
  if (!matched || t.replace(/\s+/g, "") !== matched.replace(/\s+/g, "")) return null;
  return Math.round(total);
}
/** Usernames mentioned as @username in Markdown text.
 * @param {string} text
 * @returns {string[]}
 */
export function mentionsIn(text) {
  return [...new Set([...text.matchAll(/(?:^|[^\w@])@([a-z0-9._-]{2,40})/gi)].map((m) => m[1].toLowerCase()))];
}
/**
 * Most urgent first: priority, then the earliest due date, then the oldest.
 * @param {WorkItemSummary} a
 * @param {WorkItemSummary} b
 * @returns {number}
 */
export function byWorkUrgency(a, b) {
  return WORK_PRIORITY_META[a.priority].rank - WORK_PRIORITY_META[b.priority].rank || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt);
}
/** @typedef {"EPIC" | "STORY" | "TASK" | "BUG" | "SUBTASK"} WorkItemType */
/** @typedef {"HIGHEST" | "HIGH" | "MEDIUM" | "LOW" | "LOWEST"} WorkPriority */
/** @typedef {"TODO" | "IN_PROGRESS" | "DONE"} StatusCategory */
/**
 * A status id: Phase 1's four (TODO, IN_PROGRESS, IN_REVIEW, DONE) and any added in Settings → Workflows.
 * @typedef {string} WorkStatus
 */
/** @typedef {"DONE" | "WONT_DO"} Resolution */
/** @typedef {"internal" | "client_request" | "service_desk"} WorkSource */
/** @typedef {"BLOCKS" | "RELATES" | "DUPLICATES" | "CLONES"} LinkType */
/** @typedef {WorkItemSummary & WorkItemOwn} WorkItem */
/**
 * One row in a list: enough to show it, without its description or collaboration.
 * @typedef {Object} WorkItemSummary
 * @property {string} id
 * @property {string} key
 * @property {string} systemId
 * @property {number} number
 * @property {WorkItemType} type  the kind: where it sits in the hierarchy
 * @property {string} itemType  the workspace's item type (CAMPAIGN, or the kind itself)
 * @property {string} itemTypeName
 * @property {string} summary
 * @property {WorkStatus} status
 * @property {string} statusName
 * @property {StatusCategory} statusCategory
 * @property {Resolution} [resolution]
 * @property {boolean} onHold
 * @property {WorkPriority} priority
 * @property {string} [assignee]
 * @property {string} reporter
 * @property {string[]} labels
 * @property {string} [component]
 * @property {number} [storyPoints]
 * @property {string} [dueDate]
 * @property {string} [parentId]
 * @property {string} [parentKey]
 * @property {WorkSource} source
 * @property {string} [sprintId]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [resolvedAt]
 * @property {{ total: number; done: number }} [children]
 * @property {string} [securityLevel]
 * @property {CustomFieldValue[]} [customFields]
 */
/**
 * @typedef {Object} WorkItemOwn
 * @property {string} description
 * @property {string} [startDate]
 * @property {number} [originalEstimate]
 * @property {number} [remainingEstimate]
 * @property {number} loggedMinutes
 * @property {string} [client]
 * @property {string} [notes]
 * @property {WorkItemSummary} [parent]
 * @property {WorkItemSummary[]} childItems
 * @property {WorkItemLink[]} links
 * @property {string[]} watchers
 * @property {boolean} watching
 * @property {Attachment[]} attachments
 * @property {WorkLog[]} workLogs
 * @property {StatusChange[]} history
 * @property {number} commentCount
 * @property {Object} can
 * @property {boolean} can.edit
 * @property {boolean} can.delete
 * @property {boolean} can.comment
 * @property {boolean} can.logTime
 * @property {boolean} can.assignOthers
 * @property {boolean} can.replyToCustomer
 * @property {string} workflowId
 * @property {ItemMove[]} moves
 * @property {string} [securityLevelName]
 * @property {{ id: string; name: string }[]} securityLevels The levels you may give it (you belong to them), for the security level menu.
 * @property {CustomField[]} fieldDefs Its workspace's custom fields, and its values.
 * @property {CustomFieldValue[]} fieldValues
 * @property {DevLink[]} devLinks Commits, branches and pull requests that mention its key.
 * @property {RequestInfo} [request] For a service desk request: who asked, what they said, and its SLA clock.
 */
/**
 * A move a person may (or may not) make from an item's status.
 * @typedef {Object} ItemMove
 * @property {string} transitionId
 * @property {string} name
 * @property {string} to
 * @property {string} toName
 * @property {StatusCategory} toCategory
 * @property {boolean} allowed
 * @property {string} [reason]
 * @property {Object} needs
 * @property {boolean} needs.comment
 * @property {boolean} needs.assignee
 * @property {string[]} needs.fields
 */
/**
 * @typedef {Object} WorkItemLink
 * @property {string} id
 * @property {LinkType} type
 * @property {"outward" | "inward"} direction
 * @property {WorkItemSummary} item
 */
/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {string} name
 * @property {string} mime
 * @property {number} size
 * @property {string} uploadedBy
 * @property {string} uploadedAt
 */
/**
 * @typedef {Object} WorkLog
 * @property {string} id
 * @property {string} userId
 * @property {number} minutes
 * @property {string} note
 * @property {string} workDate
 * @property {string} createdAt
 */
/**
 * @typedef {Object} StatusChange
 * @property {WorkStatus} [from]
 * @property {string} [fromName]
 * @property {WorkStatus} to
 * @property {string} toName
 * @property {string} [by]
 * @property {string} at
 */
/**
 * @typedef {Object} WorkComment
 * @property {string} id
 * @property {string} authorId
 * @property {string} body
 * @property {string} createdAt
 * @property {string} [updatedAt]
 * @property {boolean} [public] Service desk: a reply the customer sees.
 * @property {string} [customerName] Written by the customer through the service desk portal.
 */
/**
 * A page of a list, with the total that match.
 * @typedef {Object} WorkItemPage
 * @property {WorkItemSummary[]} items
 * @property {number} total
 * @property {number} offset
 */
