// Workflows and boards, shared by the Worker (which enforces every rule) and the UI (which greys out
// the moves a person can't make, with the reason).
//
// A workflow uses some of Pulse's statuses and says which moves (transitions) are allowed between
// them. Each transition can have conditions (who may make it), validators (what must be true first)
// and post-functions (what happens afterwards).

import { ROLE_LABEL, type Role } from "./roles";
import type { StatusCategory } from "./workitems";

export interface StatusDef {
  id: string;
  name: string;
  category: StatusCategory;
}

export type RuleKind = "condition" | "validator" | "post_function";

export interface Rule {
  kind: RuleKind;
  rule: string;
  value?: string | null;
}

export interface Transition {
  id: string;
  name: string;
  from: string | null; // null: from any status
  to: string;
  rules: Rule[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  statuses: { id: string; initial: boolean }[]; // in board order
  transitions: Transition[];
}

/** Fields a "field must be filled" validator can ask for, and how they read. */
export const FIELD_RULE_LABEL: Record<string, string> = {
  description: "Description",
  dueDate: "Due date",
  startDate: "Start date",
  storyPoints: "Story points",
  originalEstimate: "Original estimate",
  component: "Component",
  labels: "Labels",
};

export const CATEGORY_META: Record<StatusCategory, { label: string; tone: string }> = {
  TODO: { label: "To Do", tone: "slate" },
  IN_PROGRESS: { label: "In Progress", tone: "cyan" },
  DONE: { label: "Done", tone: "green" },
};

/** Every rule, by kind, as the editor offers it. `value` says what the rule needs. */
export const RULES: Record<RuleKind, { rule: string; label: string; value?: "role" | "user" | "field" | "resolution" | "notify" }[]> = {
  condition: [
    { rule: "role", label: "Only people with this role", value: "role" },
    { rule: "assignee_only", label: "Only the assignee" },
    { rule: "reporter_only", label: "Only the reporter" },
  ],
  validator: [
    { rule: "comment_required", label: "A comment is required" },
    { rule: "assignee_set", label: "Someone must be assigned" },
    { rule: "field_filled", label: "A field must be filled", value: "field" },
    { rule: "subtasks_done", label: "All sub-tasks must be done" },
  ],
  post_function: [
    { rule: "assign_user", label: "Assign to a person", value: "user" },
    { rule: "assign_role", label: "Assign to someone with a role", value: "role" },
    { rule: "assign_reporter", label: "Assign to the reporter" },
    { rule: "clear_assignee", label: "Clear the assignee" },
    { rule: "set_resolution", label: "Set the resolution", value: "resolution" },
    { rule: "notify", label: "Notify", value: "notify" },
  ],
};

export const KIND_LABEL: Record<RuleKind, string> = { condition: "Who may", validator: "Needs first", post_function: "Then" };

export const SWIMLANES = ["none", "assignee", "epic", "priority"] as const;
export type Swimlanes = (typeof SWIMLANES)[number];
export const SWIMLANE_LABEL: Record<Swimlanes, string> = { none: "No swimlanes", assignee: "By assignee", epic: "By epic", priority: "By priority" };

/** A rule in plain words, for the transitions table and messages. */
export function describeRule(r: Rule, nameOf: (userId: string) => string = (id) => id): string {
  switch (r.rule) {
    case "role":
      return `Only ${ROLE_LABEL[r.value as Role] ?? r.value}s`;
    case "assignee_only":
      return "Only the assignee";
    case "reporter_only":
      return "Only the reporter";
    case "comment_required":
      return "A comment";
    case "assignee_set":
      return "An assignee";
    case "field_filled":
      return `${FIELD_RULE_LABEL[r.value ?? ""] ?? r.value} filled in`;
    case "subtasks_done":
      return "All sub-tasks done";
    case "assign_user":
      return `Assign to ${nameOf(r.value ?? "")}`;
    case "assign_role":
      return `Assign to a ${ROLE_LABEL[r.value as Role] ?? r.value}`;
    case "assign_reporter":
      return "Assign to the reporter";
    case "clear_assignee":
      return "Clear the assignee";
    case "set_resolution":
      return `Resolution: ${r.value === "WONT_DO" ? "Won't do" : "Done"}`;
    case "notify":
      return `Notify ${r.value?.startsWith("role:") ? `${ROLE_LABEL[r.value.slice(5) as Role] ?? r.value.slice(5)}s` : (r.value ?? "watchers")}`;
    default:
      return r.rule;
  }
}

/** What the item looks like, for checking a move. */
export interface ItemForCheck {
  status: string;
  assignee?: string | null;
  reporter: string;
  description?: string;
  dueDate?: string | null;
  startDate?: string | null;
  storyPoints?: number | null;
  originalEstimate?: number | null;
  component?: string | null;
  labels?: string[];
  openSubtasks?: number; // sub-tasks not done; unknown when absent (the server checks)
}

/** What the person supplies with the move. */
export interface MoveInput {
  comment?: string;
  fields?: Partial<Record<"assignee" | "dueDate" | "startDate" | "storyPoints" | "originalEstimate" | "component" | "description", unknown>> & { labels?: string[] };
}

export interface MoveCheck {
  transition: Transition;
  allowed: boolean; // the conditions let this person make it
  reason?: string; // why not, when not allowed
  needs: { comment: boolean; assignee: boolean; fields: string[] }; // what's still missing
}

const filled = (v: unknown) => !(v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));

/**
 * Checks one transition for one person and item. Admins pass role conditions, as they keep every
 * permission elsewhere in Pulse. Validators report what is still needed, given `input`.
 */
export function checkTransition(t: Transition, item: ItemForCheck, me: { id: string; role: Role }, input: MoveInput = {}): MoveCheck {
  const conditions = t.rules.filter((r) => r.kind === "condition");
  const roles = conditions.filter((r) => r.rule === "role").map((r) => r.value as Role);
  let reason: string | undefined;
  if (roles.length && me.role !== "admin" && !roles.includes(me.role)) {
    reason = `Only ${roles.map((r) => `${ROLE_LABEL[r] ?? r}s`).join(" or ")} can ${t.name.toLowerCase()}`;
  } else if (conditions.some((r) => r.rule === "assignee_only") && item.assignee !== me.id) {
    reason = `Only the assignee can ${t.name.toLowerCase()}`;
  } else if (conditions.some((r) => r.rule === "reporter_only") && item.reporter !== me.id) {
    reason = `Only the reporter can ${t.name.toLowerCase()}`;
  }
  const value = (field: string) =>
    input.fields && field in input.fields ? (input.fields as Record<string, unknown>)[field] : (item as unknown as Record<string, unknown>)[field];
  const validators = t.rules.filter((r) => r.kind === "validator");
  const needs = {
    comment: validators.some((r) => r.rule === "comment_required") && !input.comment?.trim(),
    // A post-function that assigns someone satisfies "an assignee is set".
    assignee:
      validators.some((r) => r.rule === "assignee_set") &&
      !filled(value("assignee")) &&
      !t.rules.some((r) => r.kind === "post_function" && ["assign_user", "assign_role", "assign_reporter"].includes(r.rule)),
    fields: validators.filter((r) => r.rule === "field_filled" && r.value && !filled(value(r.value))).map((r) => r.value!),
  };
  if (!reason && validators.some((r) => r.rule === "subtasks_done") && (item.openSubtasks ?? 0) > 0) {
    reason = `Finish its ${item.openSubtasks} open sub-task${item.openSubtasks === 1 ? "" : "s"} first`;
  }
  return { transition: t, allowed: !reason, reason, needs };
}

/** The moves out of `status`: specific ones first, then the "from any status" ones (never to itself). */
export function transitionsFrom(wf: Workflow, status: string): Transition[] {
  const specific = wf.transitions.filter((t) => t.from === status && t.to !== status);
  const any = wf.transitions.filter((t) => t.from === null && t.to !== status && !specific.some((s) => s.to === t.to));
  return [...specific, ...any];
}

export const needsInput = (c: MoveCheck) => c.needs.comment || c.needs.assignee || c.needs.fields.length > 0;
