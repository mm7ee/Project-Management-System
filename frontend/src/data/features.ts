// Feature requests: work a client asks for on a project, new or already delivered.
// Shared by the UI and the Worker. Each request is a work item (source "client_request"); the
// `features` database view shows them in the shape below.

export type FeatureKind = "NEW_MODULE" | "CHANGE" | "ENHANCEMENT" | "BUG_FIX";
export type FeatureStatus = "NOT_STARTED" | "IN_PROGRESS" | "ON_HOLD" | "TESTING" | "COMPLETED" | "CANCELLED";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface Feature {
  id: string;
  systemId: string;
  title: string;
  description: string;
  kind: FeatureKind;
  client: string; // who asked for it
  status: FeatureStatus;
  priority: Priority;
  assignee?: string; // a developer's user id
  notes?: string; // the developer's notes: blockers, what's needed
  dueAt?: string; // expected delivery date (YYYY-MM-DD)
  createdBy: string; // user id of whoever logged it
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  key?: string; // the work item it is (INFRA-12): every feature request is a work item
}

export const KIND_META: Record<FeatureKind, string> = {
  NEW_MODULE: "New module",
  CHANGE: "Change",
  ENHANCEMENT: "Enhancement",
  BUG_FIX: "Bug fix",
};

export const FEATURE_STATUS_META: Record<FeatureStatus, { label: string; tone: string }> = {
  NOT_STARTED: { label: "Not started", tone: "slate" },
  IN_PROGRESS: { label: "In progress", tone: "cyan" },
  ON_HOLD: { label: "On hold", tone: "amber" },
  TESTING: { label: "Testing", tone: "violet" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "light" },
};

/** Highest first; the order lists are sorted by. */
export const PRIORITY_META: Record<Priority, { label: string; rank: number }> = {
  CRITICAL: { label: "Critical", rank: 0 },
  HIGH: { label: "High", rank: 1 },
  MEDIUM: { label: "Medium", rank: 2 },
  LOW: { label: "Low", rank: 3 },
};

export const FEATURE_KINDS = Object.keys(KIND_META) as FeatureKind[];
export const FEATURE_STATUSES = Object.keys(FEATURE_STATUS_META) as FeatureStatus[];
export const PRIORITIES = Object.keys(PRIORITY_META) as Priority[];

/** Still to be delivered: not completed and not cancelled. */
export const isOpen = (f: Feature) => f.status !== "COMPLETED" && f.status !== "CANCELLED";

/** Open and past its expected delivery date (the due day itself still counts as on time). */
export function isLate(f: Feature, now: number): boolean {
  if (!isOpen(f) || !f.dueAt) return false;
  return new Date(f.dueAt).setHours(23, 59, 59, 999) < now;
}

/** Priority first, then the earliest due date, then the oldest request. */
export function byUrgency(a: Feature, b: Feature): number {
  return (
    PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank ||
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt)
  );
}
