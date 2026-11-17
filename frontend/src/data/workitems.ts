// Work items: the things a project's team does, numbered per project (INFRA-1, INFRA-2…).
// Shared by the UI and the Worker, which enforces every rule here. They live in the work_items
// table and its companions (labels, comments, watchers, links, work logs, status history);
// client feature requests are work items too, with source "client_request".

export type WorkItemType = "EPIC" | "STORY" | "TASK" | "BUG" | "SUBTASK";
export type WorkPriority = "HIGHEST" | "HIGH" | "MEDIUM" | "LOW" | "LOWEST";
export type StatusCategory = "TODO" | "IN_PROGRESS" | "DONE";
export type WorkStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type Resolution = "DONE" | "WONT_DO";
export type WorkSource = "internal" | "client_request";
export type LinkType = "BLOCKS" | "RELATES" | "DUPLICATES" | "CLONES";

export const TYPE_META: Record<WorkItemType, { label: string; tone: string }> = {
  EPIC: { label: "Epic", tone: "violet" },
  STORY: { label: "Story", tone: "green" },
  TASK: { label: "Task", tone: "cyan" },
  BUG: { label: "Bug", tone: "red" },
  SUBTASK: { label: "Sub-task", tone: "slate" },
};
export const WORK_TYPES = Object.keys(TYPE_META) as WorkItemType[];

/** Statuses in board order. Phase 2 makes them configurable; each keeps a category. */
export const STATUS_META: Record<WorkStatus, { label: string; category: StatusCategory; tone: string }> = {
  TODO: { label: "To Do", category: "TODO", tone: "slate" },
  IN_PROGRESS: { label: "In Progress", category: "IN_PROGRESS", tone: "cyan" },
  IN_REVIEW: { label: "In Review", category: "IN_PROGRESS", tone: "violet" },
  DONE: { label: "Done", category: "DONE", tone: "green" },
};
export const WORK_STATUSES = Object.keys(STATUS_META) as WorkStatus[];

/** Highest first. */
export const WORK_PRIORITY_META: Record<WorkPriority, { label: string; rank: number }> = {
  HIGHEST: { label: "Highest", rank: 0 },
  HIGH: { label: "High", rank: 1 },
  MEDIUM: { label: "Medium", rank: 2 },
  LOW: { label: "Low", rank: 3 },
  LOWEST: { label: "Lowest", rank: 4 },
};
export const WORK_PRIORITIES = Object.keys(WORK_PRIORITY_META) as WorkPriority[];

export const RESOLUTION_META: Record<Resolution, string> = { DONE: "Done", WONT_DO: "Won't do" };

/** How each link reads from either end. */
export const LINK_META: Record<LinkType, { outward: string; inward: string }> = {
  BLOCKS: { outward: "blocks", inward: "is blocked by" },
  RELATES: { outward: "relates to", inward: "relates to" },
  DUPLICATES: { outward: "duplicates", inward: "is duplicated by" },
  CLONES: { outward: "clones", inward: "is cloned by" },
};
export const LINK_TYPES = Object.keys(LINK_META) as LinkType[];

/** A feature request's kind is kept as one of these labels on its work item. */
export const KIND_LABELS = { NEW_MODULE: "new-module", CHANGE: "change", ENHANCEMENT: "enhancement", BUG_FIX: "bug-fix" } as const;

export const MAX_LABELS = 10;
export const MAX_SUMMARY = 255;
export const MAX_DESCRIPTION = 20_000;
export const MAX_COMMENT = 10_000;
/** Items per page in lists. */
export const PAGE_SIZE = 50;

/** One row in a list: enough to show it, without its description or collaboration. */
export interface WorkItemSummary {
  id: string;
  key: string; // INFRA-12
  systemId: string;
  number: number;
  type: WorkItemType;
  summary: string;
  status: WorkStatus;
  resolution?: Resolution;
  onHold: boolean;
  priority: WorkPriority;
  assignee?: string;
  reporter: string;
  labels: string[];
  component?: string;
  storyPoints?: number;
  dueDate?: string;
  parentId?: string;
  parentKey?: string;
  source: WorkSource;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  children?: { total: number; done: number }; // epics and anything with sub-tasks
}

export interface WorkItem extends WorkItemSummary {
  description: string;
  startDate?: string;
  originalEstimate?: number; // minutes
  remainingEstimate?: number; // minutes
  loggedMinutes: number;
  client?: string; // client requests: who asked
  notes?: string; // client requests: the developer's notes
  parent?: WorkItemSummary;
  childItems: WorkItemSummary[];
  links: WorkItemLink[];
  watchers: string[]; // user ids
  watching: boolean; // you
  attachments: Attachment[];
  workLogs: WorkLog[];
  history: StatusChange[];
  commentCount: number;
  can: { edit: boolean; delete: boolean; comment: boolean; logTime: boolean; assignOthers: boolean };
}

export interface WorkItemLink {
  id: string;
  type: LinkType;
  direction: "outward" | "inward"; // outward: this item blocks/duplicates/clones the other
  item: WorkItemSummary;
}

export interface Attachment {
  id: string; // a document id: download at /api/documents/<id>
  name: string;
  mime: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface WorkLog {
  id: string;
  userId: string;
  minutes: number;
  note: string;
  workDate: string;
  createdAt: string;
}

export interface StatusChange {
  from?: WorkStatus;
  to: WorkStatus;
  by?: string;
  at: string;
}

export interface WorkComment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

/** A page of a list, with the total that match. */
export interface WorkItemPage {
  items: WorkItemSummary[];
  total: number;
  offset: number;
}

export const isDone = (i: { status: WorkStatus }) => STATUS_META[i.status].category === "DONE";

/** Which types may sit under which: Epic → Story/Task/Bug → Sub-task. */
export function allowedParentTypes(type: WorkItemType): WorkItemType[] | null {
  if (type === "EPIC") return null; // an epic has no parent
  if (type === "SUBTASK") return ["STORY", "TASK", "BUG"];
  return ["EPIC"];
}

/** Why `type` can't sit under a parent of `parentType` (or under nothing), or null when it can. */
export function parentProblem(type: WorkItemType, parentType: WorkItemType | null): string | null {
  const allowed = allowedParentTypes(type);
  if (!parentType) return type === "SUBTASK" ? "A sub-task needs a parent story, task or bug" : null;
  if (!allowed) return "An epic can't have a parent";
  if (!allowed.includes(parentType)) {
    return type === "SUBTASK"
      ? "A sub-task's parent must be a story, task or bug"
      : `A ${TYPE_META[type].label.toLowerCase()}'s parent must be an epic`;
  }
  return null;
}

/** The types an item's children may have. */
export const childTypesOf = (type: WorkItemType): WorkItemType[] =>
  type === "EPIC" ? ["STORY", "TASK", "BUG"] : type === "SUBTASK" ? [] : ["SUBTASK"];

/** Percentage of children done, or null with none. */
export const rollup = (c?: { total: number; done: number }) => (c && c.total ? Math.round((c.done / c.total) * 100) : null);

export const KEY_PATTERN = /^[A-Z]{2,10}$/;
export const ITEM_KEY_PATTERN = /^([A-Z]{2,10})-(\d{1,7})$/;

const STOP_WORDS = new Set(["A", "AN", "AND", "FOR", "IN", "OF", "ON", "THE", "TO", "WITH"]);

/**
 * A project key from its name: the initials of a name of several words ("Leave Planner" → LP),
 * or the first five letters of a one-word name ("Infrastructure" → INFRA). When `taken` holds it,
 * a letter is added (LPA, LPB…). The database migration uses the same rule for existing projects.
 */
export function suggestKey(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  let words = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const kept = words.filter((w) => !STOP_WORDS.has(w));
  if (kept.length >= 2) words = kept;
  const base =
    words.length >= 2 ? words.map((w) => w[0]).join("").slice(0, 10) : words.length === 1 ? words[0].slice(0, 5).padEnd(2, "X") : "PRJ";
  let cand = base;
  for (let n = 1; used.has(cand); n++) {
    cand = n <= 26 ? base.slice(0, 9) + String.fromCharCode(64 + n) : base.slice(0, 8) + String.fromCharCode(64 + Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26));
  }
  return cand;
}

/** Labels are short lower-case words: spaces become hyphens; anything else is dropped. */
export function cleanLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}

/** "1h 30m", "2d 4h": time in a working day of 8 hours, as Jira shows it. */
export function formatMinutes(min?: number | null): string {
  if (min == null) return "—";
  if (min <= 0) return "0m";
  const d = Math.floor(min / 480);
  const h = Math.floor((min % 480) / 60);
  const m = min % 60;
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(" ");
}

/** Reads "1d 2h 30m", "3h", "45m" or a plain number of hours ("1.5"); null when it can't. */
export function parseDuration(text: string): number | null {
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

/** Usernames mentioned as @username in Markdown text. */
export function mentionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|[^\w@])@([a-z0-9._-]{2,40})/gi)].map((m) => m[1].toLowerCase()))];
}

/** Most urgent first: priority, then the earliest due date, then the oldest. */
export function byWorkUrgency(a: WorkItemSummary, b: WorkItemSummary): number {
  return (
    WORK_PRIORITY_META[a.priority].rank - WORK_PRIORITY_META[b.priority].rank ||
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt)
  );
}
