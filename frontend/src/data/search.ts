// Saved filters, dashboards and automation rules: shapes and labels shared by the Worker and the UI.

import { ROLE_LABEL, type Role } from "./roles";

export type ShareScope = "private" | "role" | "workspace" | "everyone";

export interface SavedFilter {
  id: string;
  name: string;
  description: string;
  pql: string;
  ownerId: string;
  ownerName: string;
  shareScope: ShareScope;
  shareValue?: string;
  favourite: boolean;
  mine: boolean;
  subscriptions: FilterSubscription[]; // your own
  updatedAt: string;
}

export interface FilterSubscription {
  id: string;
  frequency: "daily" | "weekly";
  weekday?: number; // 1 Monday … 7 Sunday
  hour: number; // Harare time
  lastSentAt?: string;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function shareLabel(scope: ShareScope, value?: string): string {
  if (scope === "everyone") return "Everyone";
  if (scope === "role") return `${ROLE_LABEL[value as Role] ?? value}s`;
  if (scope === "workspace") return `${value} workspace`;
  return "Only me";
}

export type GadgetKind = "filter_results" | "pie" | "created_resolved" | "sprint_health" | "workload" | "overdue" | "two_d" | "activity";

export const GADGETS: Record<GadgetKind, { label: string; description: string; field?: boolean; field2?: boolean }> = {
  filter_results: { label: "Filter results", description: "The filter's work items, as a list" },
  pie: { label: "Pie chart", description: "The filter's items, grouped by a field", field: true },
  created_resolved: { label: "Created vs resolved", description: "Items created and resolved each day, last 30 days" },
  sprint_health: { label: "Sprint health", description: "Running sprints with the filter's items: days left, points done" },
  workload: { label: "Workload by assignee", description: "Open items and points per person" },
  overdue: { label: "Overdue", description: "Open items past their due date, oldest first" },
  two_d: { label: "Two-dimensional statistics", description: "A count for each pair, such as status × assignee", field: true, field2: true },
  activity: { label: "Recent activity", description: "The latest changes to the filter's items" },
};
export const GADGET_KINDS = Object.keys(GADGETS) as GadgetKind[];

/** Fields a pie chart or a two-dimensional table can group by. */
export const GROUP_FIELDS: Record<string, string> = {
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

export interface Gadget {
  id: string;
  kind: GadgetKind;
  filterId?: string;
  filterName?: string;
  title: string;
  column: number;
  position: number;
  field?: string;
  field2?: string;
  maxRows: number;
}

export interface Dashboard {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  shareScope: ShareScope;
  shareValue?: string;
  layout: "one" | "two" | "three";
  mine: boolean;
  gadgets: Gadget[];
}

export type Trigger = "item_created" | "item_transitioned" | "field_changed" | "comment_added" | "subtasks_done" | "sprint_started" | "sprint_completed" | "schedule";

export const TRIGGERS: Record<Trigger, { label: string; value?: "status" | "field" }> = {
  item_created: { label: "A work item is created" },
  item_transitioned: { label: "A work item moves status", value: "status" },
  field_changed: { label: "A field changes", value: "field" },
  comment_added: { label: "A comment is added" },
  subtasks_done: { label: "All its sub-tasks are done" },
  sprint_started: { label: "A sprint starts" },
  sprint_completed: { label: "A sprint is completed" },
  schedule: { label: "On a schedule" },
};
export const TRIGGER_KINDS = Object.keys(TRIGGERS) as Trigger[];

export type ActionKind = "transition" | "assign" | "set_field" | "comment" | "notify" | "create_subtask" | "link";

export const ACTIONS: Record<ActionKind, string> = {
  transition: "Move it to a status",
  assign: "Assign it",
  set_field: "Set a field",
  comment: "Add a comment",
  notify: "Notify people",
  create_subtask: "Create a sub-task",
  link: "Link it to another item",
};
export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

/** Fields "Set a field" can change. */
export const SETTABLE_FIELDS: Record<string, string> = {
  priority: "Priority",
  component: "Component",
  storyPoints: "Story points",
  dueDate: "Due date (a date, or +3d from today)",
  labels: "Add a label",
  onHold: "On hold (yes or no)",
};

export interface AutomationAction {
  id?: string;
  kind: ActionKind;
  field?: string;
  value?: string;
  value2?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: "global" | "workspace" | "project";
  scopeValue?: string;
  trigger: Trigger;
  triggerValue?: string;
  scheduleWeekday?: number;
  scheduleHour?: number;
  conditionPql: string;
  maxPerMinute: number;
  actions: AutomationAction[];
  lastRunAt?: string;
  lastStatus?: "success" | "error" | "skipped";
}

export interface AutomationRun {
  id: number;
  at: string;
  triggerEvent: string;
  itemKey?: string;
  status: "success" | "error" | "skipped";
  message: string;
  touched: string[];
  depth: number;
}

/** Placeholders a comment or notification can use. */
export const PLACEHOLDERS = ["{key}", "{summary}", "{status}", "{priority}", "{assignee}", "{project}"];

/** Actions done by a rule can set off other rules this many levels deep, and no further. */
export const MAX_AUTOMATION_DEPTH = 3;
