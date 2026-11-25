/** @import { Role } from './roles' */
// Saved filters, dashboards and automation rules: shapes and labels shared by the Worker and the UI.
import { ROLE_LABEL } from "./roles";
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/**
 * @param {ShareScope} scope
 * @param {string} [value]
 * @returns {string}
 */
export function shareLabel(scope, value) {
  if (scope === "everyone") return "Everyone";
  if (scope === "role") return `${ROLE_LABEL[/** @type {Role} */ (value)] ?? value}s`;
  if (scope === "workspace") return `${value} workspace`;
  return "Only me";
}
/** @type {Record<GadgetKind, { label: string; description: string; field?: boolean; field2?: boolean }>} */ export const GADGETS = {
  filter_results: { label: "Filter results", description: "The filter's work items, as a list" },
  pie: { label: "Pie chart", description: "The filter's items, grouped by a field", field: true },
  created_resolved: { label: "Created vs resolved", description: "Items created and resolved each day, last 30 days" },
  sprint_health: { label: "Sprint health", description: "Running sprints with the filter's items: days left, points done" },
  workload: { label: "Workload by assignee", description: "Open items and points per person" },
  overdue: { label: "Overdue", description: "Open items past their due date, oldest first" },
  two_d: { label: "Two-dimensional statistics", description: "A count for each pair, such as status × assignee", field: true, field2: true },
  activity: { label: "Recent activity", description: "The latest changes to the filter's items" },
};
export const GADGET_KINDS = /** @type {GadgetKind[]} */ (Object.keys(GADGETS));
/** Fields a pie chart or a two-dimensional table can group by. */
/** @type {Record<string, string>} */ export const GROUP_FIELDS = {
  status: "Status",
  statusCategory: "Status category",
  priority: "Priority",
  type: "Type",
  assignee: "Assignee",
  reporter: "Reporter",
  project: "Project",
  component: "Component",
  resolution: "Resolution",
  sprint: "Sprint",
};
/** @type {Record<Trigger, { label: string; value?: "status" | "field" }>} */ export const TRIGGERS = {
  item_created: { label: "A work item is created" },
  item_transitioned: { label: "A work item moves status", value: "status" },
  field_changed: { label: "A field changes", value: "field" },
  comment_added: { label: "A comment is added" },
  subtasks_done: { label: "All its sub-tasks are done" },
  sprint_started: { label: "A sprint starts" },
  sprint_completed: { label: "A sprint is completed" },
  schedule: { label: "On a schedule" },
};
export const TRIGGER_KINDS = /** @type {Trigger[]} */ (Object.keys(TRIGGERS));
/** @type {Record<ActionKind, string>} */ export const ACTIONS = {
  transition: "Move it to a status",
  assign: "Assign it",
  set_field: "Set a field",
  comment: "Add a comment",
  notify: "Notify people",
  create_subtask: "Create a sub-task",
  link: "Link it to another item",
};
export const ACTION_KINDS = /** @type {ActionKind[]} */ (Object.keys(ACTIONS));
/** Fields "Set a field" can change. */
/** @type {Record<string, string>} */ export const SETTABLE_FIELDS = {
  priority: "Priority",
  component: "Component",
  storyPoints: "Story points",
  dueDate: "Due date (a date, or +3d from today)",
  labels: "Add a label",
  onHold: "On hold (yes or no)",
};
/**
 * Placeholders a comment or notification can use.
 * @type {string[]}
 */
export const PLACEHOLDERS = ["{key}", "{summary}", "{status}", "{priority}", "{assignee}", "{project}"];
/**
 * Actions done by a rule can set off other rules this many levels deep, and no further.
 * @type {3}
 */
export const MAX_AUTOMATION_DEPTH = 3;
/** @typedef {"private" | "role" | "workspace" | "everyone"} ShareScope */
/** @typedef {"filter_results" | "pie" | "created_resolved" | "sprint_health" | "workload" | "overdue" | "two_d" | "activity"} GadgetKind */
/** @typedef {"item_created" | "item_transitioned" | "field_changed" | "comment_added" | "subtasks_done" | "sprint_started" | "sprint_completed" | "schedule"} Trigger */
/** @typedef {"transition" | "assign" | "set_field" | "comment" | "notify" | "create_subtask" | "link"} ActionKind */
/**
 * @typedef {Object} SavedFilter
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} pql
 * @property {string} ownerId
 * @property {string} ownerName
 * @property {ShareScope} shareScope
 * @property {string} [shareValue]
 * @property {boolean} favourite
 * @property {boolean} mine
 * @property {FilterSubscription[]} subscriptions
 * @property {string} updatedAt
 */
/**
 * @typedef {Object} FilterSubscription
 * @property {string} id
 * @property {"daily" | "weekly"} frequency
 * @property {number} [weekday]
 * @property {number} hour
 * @property {string} [lastSentAt]
 */
/**
 * @typedef {Object} Gadget
 * @property {string} id
 * @property {GadgetKind} kind
 * @property {string} [filterId]
 * @property {string} [filterName]
 * @property {string} title
 * @property {number} column
 * @property {number} position
 * @property {string} [field]
 * @property {string} [field2]
 * @property {number} maxRows
 */
/**
 * @typedef {Object} Dashboard
 * @property {string} id
 * @property {string} name
 * @property {string} ownerId
 * @property {string} ownerName
 * @property {ShareScope} shareScope
 * @property {string} [shareValue]
 * @property {"one" | "two" | "three"} layout
 * @property {boolean} mine
 * @property {Gadget[]} gadgets
 */
/**
 * @typedef {Object} AutomationAction
 * @property {string} [id]
 * @property {ActionKind} kind
 * @property {string} [field]
 * @property {string} [value]
 * @property {string} [value2]
 */
/**
 * @typedef {Object} AutomationRule
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} enabled
 * @property {"global" | "workspace" | "project"} scope
 * @property {string} [scopeValue]
 * @property {Trigger} trigger
 * @property {string} [triggerValue]
 * @property {number} [scheduleWeekday]
 * @property {number} [scheduleHour]
 * @property {string} conditionPql
 * @property {number} maxPerMinute
 * @property {AutomationAction[]} actions
 * @property {string} [lastRunAt]
 * @property {"success" | "error" | "skipped"} [lastStatus]
 */
/**
 * @typedef {Object} AutomationRun
 * @property {number} id
 * @property {string} at
 * @property {string} triggerEvent
 * @property {string} [itemKey]
 * @property {"success" | "error" | "skipped"} status
 * @property {string} message
 * @property {string[]} touched
 * @property {number} depth
 */
