/** @import { Role } from './roles' */
/** @import { StatusCategory } from './workitems' */
// Workflows and boards, shared by the Worker (which enforces every rule) and the UI (which greys out
// the moves a person can't make, with the reason).
//
// A workflow uses some of Pulse's statuses and says which moves (transitions) are allowed between
// them. Each transition can have conditions (who may make it), validators (what must be true first)
// and post-functions (what happens afterwards).
import { ROLE_LABEL } from "./roles";
/** Fields a "field must be filled" validator can ask for, and how they read. */
/** @type {Record<string, string>} */ export const FIELD_RULE_LABEL = {
  description: "Description",
  dueDate: "Due date",
  startDate: "Start date",
  storyPoints: "Story points",
  originalEstimate: "Original estimate",
  component: "Component",
  labels: "Labels",
};
/** @type {Record<StatusCategory, { label: string; tone: string }>} */ export const CATEGORY_META = {
  TODO: { label: "To Do", tone: "slate" },
  IN_PROGRESS: { label: "In Progress", tone: "cyan" },
  DONE: { label: "Done", tone: "green" },
};
/** Every rule, by kind, as the editor offers it. `value` says what the rule needs. */
/** @type {Record<RuleKind, { rule: string; label: string; value?: "role" | "user" | "field" | "resolution" | "notify" }[]>} */ export const RULES = {
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
/** @type {Record<RuleKind, string>} */ export const KIND_LABEL = { condition: "Who may", validator: "Needs first", post_function: "Then" };
export const SWIMLANES = /** @type {const} */ (["none", "assignee", "epic", "priority"]);
/** @type {Record<Swimlanes, string>} */ export const SWIMLANE_LABEL = { none: "No swimlanes", assignee: "By assignee", epic: "By epic", priority: "By priority" };
/**
 * A rule in plain words, for the transitions table and messages.
 * @param {Rule} r
 * @param {(userId: string) => string} [nameOf=(id) => id]
 * @returns {string}
 */
export function describeRule(r, nameOf = (id) => id) {
  switch (r.rule) {
    case "role":
      return `Only ${ROLE_LABEL[/** @type {Role} */ (r.value)] ?? r.value}s`;
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
      return `Assign to a ${ROLE_LABEL[/** @type {Role} */ (r.value)] ?? r.value}`;
    case "assign_reporter":
      return "Assign to the reporter";
    case "clear_assignee":
      return "Clear the assignee";
    case "set_resolution":
      return `Resolution: ${r.value === "WONT_DO" ? "Won't do" : "Done"}`;
    case "notify":
      return `Notify ${r.value?.startsWith("role:") ? `${ROLE_LABEL[/** @type {Role} */ (r.value.slice(5))] ?? r.value.slice(5)}s` : (r.value ?? "watchers")}`;
    default:
      return r.rule;
  }
}
const filled =
  /** @param {unknown} v
   * @returns {boolean}
   */ (v) => !(v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));
/**
 * Checks one transition for one person and item. Admins pass role conditions, as they keep every
 * permission elsewhere in Pulse. Validators report what is still needed, given `input`.
 * @param {Transition} t
 * @param {ItemForCheck} item
 * @param {{ id: string; role: Role }} me
 * @param {MoveInput} [input={}]
 * @returns {MoveCheck}
 */
export function checkTransition(t, item, me, input = {}) {
  const conditions = t.rules.filter((r) => r.kind === "condition");
  const roles = conditions.filter((r) => r.rule === "role").map((r) => /** @type {Role} */ (r.value));
  /** @type {string | undefined} */ let reason;
  if (roles.length && me.role !== "admin" && !roles.includes(me.role)) {
    reason = `Only ${roles.map((r) => `${ROLE_LABEL[r] ?? r}s`).join(" or ")} can ${t.name.toLowerCase()}`;
  } else if (conditions.some((r) => r.rule === "assignee_only") && item.assignee !== me.id) {
    reason = `Only the assignee can ${t.name.toLowerCase()}`;
  } else if (conditions.some((r) => r.rule === "reporter_only") && item.reporter !== me.id) {
    reason = `Only the reporter can ${t.name.toLowerCase()}`;
  }
  const value = /** @param {string} field */ (field) => (input.fields && field in input.fields ? /** @type {Record<string, unknown>} */ (input.fields)[field] : /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (item))[field]);
  const validators = t.rules.filter((r) => r.kind === "validator");
  const needs = {
    comment: validators.some((r) => r.rule === "comment_required") && !input.comment?.trim(),
    // A post-function that assigns someone satisfies "an assignee is set".
    assignee: validators.some((r) => r.rule === "assignee_set") && !filled(value("assignee")) && !t.rules.some((r) => r.kind === "post_function" && ["assign_user", "assign_role", "assign_reporter"].includes(r.rule)),
    fields: validators.filter((r) => r.rule === "field_filled" && r.value && !filled(value(r.value))).map((r) => /** @type {NonNullable<typeof r.value>} */ (r.value)),
  };
  if (!reason && validators.some((r) => r.rule === "subtasks_done") && (item.openSubtasks ?? 0) > 0) {
    reason = `Finish its ${item.openSubtasks} open sub-task${item.openSubtasks === 1 ? "" : "s"} first`;
  }
  return { transition: t, allowed: !reason, reason, needs };
}
/**
 * The moves out of `status`: specific ones first, then the "from any status" ones (never to itself).
 * @param {Workflow} wf
 * @param {string} status
 * @returns {Transition[]}
 */
export function transitionsFrom(wf, status) {
  const specific = wf.transitions.filter((t) => t.from === status && t.to !== status);
  const any = wf.transitions.filter((t) => t.from === null && t.to !== status && !specific.some((s) => s.to === t.to));
  return [...specific, ...any];
}
export const needsInput =
  /** @param {MoveCheck} c
   * @returns {boolean}
   */ (c) => c.needs.comment || c.needs.assignee || c.needs.fields.length > 0;
/** @typedef {"condition" | "validator" | "post_function"} RuleKind */
/** @typedef {(typeof SWIMLANES)[number]} Swimlanes */
/**
 * @typedef {Object} StatusDef
 * @property {string} id
 * @property {string} name
 * @property {StatusCategory} category
 */
/**
 * @typedef {Object} Rule
 * @property {RuleKind} kind
 * @property {string} rule
 * @property {string | null} [value]
 */
/**
 * @typedef {Object} Transition
 * @property {string} id
 * @property {string} name
 * @property {string | null} from
 * @property {string} to
 * @property {Rule[]} rules
 */
/**
 * @typedef {Object} Workflow
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} isDefault
 * @property {{ id: string; initial: boolean }[]} statuses
 * @property {Transition[]} transitions
 */
/**
 * What the item looks like, for checking a move.
 * @typedef {Object} ItemForCheck
 * @property {string} status
 * @property {string | null} [assignee]
 * @property {string} reporter
 * @property {string} [description]
 * @property {string | null} [dueDate]
 * @property {string | null} [startDate]
 * @property {number | null} [storyPoints]
 * @property {number | null} [originalEstimate]
 * @property {string | null} [component]
 * @property {string[]} [labels]
 * @property {number} [openSubtasks]
 */
/**
 * What the person supplies with the move.
 * @typedef {Object} MoveInput
 * @property {string} [comment]
 * @property {Partial<Record<"assignee" | "dueDate" | "startDate" | "storyPoints" | "originalEstimate" | "component" | "description", unknown>> & { labels?: string[] }} [fields]
 */
/**
 * @typedef {Object} MoveCheck
 * @property {Transition} transition
 * @property {boolean} allowed
 * @property {string} [reason]
 * @property {Object} needs
 * @property {boolean} needs.comment
 * @property {boolean} needs.assignee
 * @property {string[]} needs.fields
 */
