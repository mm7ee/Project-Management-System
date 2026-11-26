/** @import { Rule } from './workflows' */
// Workspace blueprints: a workspace's set-up without its work (statuses, workflows, item types, custom fields and,
// for copies of a workspace, its automation rules). The built-in templates are written here; an organisation's own
// templates are blueprints saved from one of its workspaces (worker/blueprints.js). Applying one to a new
// workspace makes its own copy of everything.

/**
 * @typedef {Object} BlueprintStatus
 * @property {string} key       how the blueprint's workflows refer to it
 * @property {string} name      matched (ignoring case) with the organisation's statuses, or added to them
 * @property {import("./workitems").StatusCategory} category
 *
 * @typedef {Object} BlueprintWorkflow
 * @property {string} key
 * @property {string} name
 * @property {string} description
 * @property {{ status: string; initial: boolean }[]} statuses   status keys, in order
 * @property {{ name: string; from: string | null; to: string; rules: Rule[] }[]} transitions
 *
 * @typedef {Object} BlueprintType
 * @property {string} id        EPIC, STORY, TASK, BUG, SUBTASK (built-in) or the workspace's own, such as CAMPAIGN
 * @property {string} name
 * @property {"EPIC" | "STORY" | "TASK" | "BUG" | "SUBTASK"} base
 * @property {string} [description]
 * @property {boolean} [active]   false: kept but not offered for new items
 * @property {string | null} [workflow]   a workflow key; none: the workspace's
 *
 * @typedef {Object} BlueprintField
 * @property {string} name
 * @property {import('./admin').CustomFieldKind} kind
 * @property {string} [description]
 * @property {boolean} [required]
 * @property {string[]} [options]
 * @property {string[] | null} [itemTypes]
 * @property {string | null} [defaultValue]
 * @property {string | null} [currency]
 * @property {boolean} [onBoard]
 *
 * @typedef {Object} Blueprint
 * @property {BlueprintStatus[]} statuses
 * @property {BlueprintWorkflow[]} workflows
 * @property {string} workspaceWorkflow   the key of the workflow the workspace uses
 * @property {BlueprintType[]} itemTypes
 * @property {BlueprintField[]} fields
 * @property {Record<string, unknown>[]} [rules]    automation rules with their actions (copies within an organisation)
 * @property {string | null} [limits]            workload limits (JSON)
 *
 * @typedef {Object} BuiltInTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} icon       a workspace icon (src/data/orgAdmin.js)
 * @property {string} key        a suggested workspace key
 * @property {Blueprint} blueprint
 */

/**
 * A workflow that goes forward one status at a time and back one step, with any status able to return to the
 * first (for re-opening).
 * @param {string} key
 * @param {string} name
 * @param {string[]} order  status keys
 * @param {{ from: string | null; to: string; name?: string; rules?: Rule[] }[]} [extra]
 * @returns {BlueprintWorkflow}
 */
function linear(key, name, order, extra = []) {
  /** @type {BlueprintWorkflow["transitions"]} */ const transitions = [];
  for (let i = 1; i < order.length; i++) {
    transitions.push({ name: "Move on", from: order[i - 1], to: order[i], rules: [] });
    if (i > 1) transitions.push({ name: "Send back", from: order[i], to: order[i - 1], rules: [] });
  }
  // An extra move between two statuses the chain already joins replaces that move (its name and rules).
  for (const e of extra) {
    const same = transitions.findIndex((t) => t.from === e.from && t.to === e.to);
    const move = { name: e.name ?? "Move", from: e.from, to: e.to, rules: e.rules ?? [] };
    if (same >= 0) transitions[same] = move;
    else transitions.push(move);
  }
  return { key, name, description: `${order.length} statuses, one step at a time.`, statuses: order.map((s, i) => ({ status: s, initial: i === 0 })), transitions };
}

const BUILT_IN_TYPES = /** @type {BlueprintType[]} */ ([
  { id: "EPIC", name: "Epic", base: "EPIC" },
  { id: "STORY", name: "Story", base: "STORY" },
  { id: "TASK", name: "Task", base: "TASK" },
  { id: "BUG", name: "Bug", base: "BUG" },
  { id: "SUBTASK", name: "Sub-task", base: "SUBTASK" },
]);
/** The built-in types, switched off, for templates with their own types (Sub-task stays for checklists). */
const hiddenBuiltIns = () => BUILT_IN_TYPES.map((t) => ({ ...t, active: t.id === "SUBTASK" }));

/** @type {BuiltInTemplate[]} */
export const BUILT_IN_TEMPLATES = [
  {
    id: "software",
    name: "Software Development",
    description: "Backlog to release, with code review and QA. Epics, stories, tasks and bugs; environment, severity and repository fields.",
    icon: "code",
    key: "DEV",
    blueprint: {
      statuses: [
        { key: "BACKLOG", name: "Backlog", category: "TODO" },
        { key: "SELECTED", name: "Selected for Development", category: "TODO" },
        { key: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS" },
        { key: "CODE_REVIEW", name: "Code Review", category: "IN_PROGRESS" },
        { key: "QA", name: "QA/Testing", category: "IN_PROGRESS" },
        { key: "READY", name: "Ready for Release", category: "IN_PROGRESS" },
        { key: "DONE", name: "Done", category: "DONE" },
      ],
      workflows: [
        linear("dev", "Software Development", ["BACKLOG", "SELECTED", "IN_PROGRESS", "CODE_REVIEW", "QA", "READY", "DONE"], [
          { from: null, to: "BACKLOG", name: "Back to the backlog" },
          { from: "QA", to: "IN_PROGRESS", name: "Failed QA", rules: [{ kind: "validator", rule: "comment_required" }] },
        ]),
      ],
      workspaceWorkflow: "dev",
      itemTypes: BUILT_IN_TYPES,
      fields: [
        { name: "Environment", kind: "select", options: ["Development", "Staging", "Production"] },
        { name: "Severity", kind: "select", options: ["Critical", "High", "Medium", "Low"], itemTypes: ["BUG"], onBoard: true },
        { name: "Repository link", kind: "url" },
      ],
    },
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "From idea and brief through production, review and approval to publishing and reporting. Campaigns, content pieces, social posts and events.",
    icon: "megaphone",
    key: "MKT",
    blueprint: {
      statuses: [
        { key: "IDEA", name: "Idea", category: "TODO" },
        { key: "BRIEF", name: "Brief", category: "TODO" },
        { key: "PRODUCTION", name: "In Production", category: "IN_PROGRESS" },
        { key: "INTERNAL_REVIEW", name: "Internal Review", category: "IN_PROGRESS" },
        { key: "APPROVAL", name: "Client/Manager Approval", category: "IN_PROGRESS" },
        { key: "SCHEDULED", name: "Scheduled", category: "IN_PROGRESS" },
        { key: "PUBLISHED", name: "Published", category: "IN_PROGRESS" },
        { key: "REPORTING", name: "Reporting", category: "DONE" },
      ],
      workflows: [
        linear("mkt", "Marketing", ["IDEA", "BRIEF", "PRODUCTION", "INTERNAL_REVIEW", "APPROVAL", "SCHEDULED", "PUBLISHED", "REPORTING"], [
          { from: "APPROVAL", to: "PRODUCTION", name: "Changes requested", rules: [{ kind: "validator", rule: "comment_required" }] },
          { from: "BRIEF", to: "PRODUCTION", name: "Start production", rules: [{ kind: "validator", rule: "assignee_set" }] },
        ]),
      ],
      workspaceWorkflow: "mkt",
      itemTypes: [
        ...hiddenBuiltIns(),
        { id: "CAMPAIGN", name: "Campaign", base: "EPIC", description: "Groups the content and events of one campaign." },
        { id: "CONTENT", name: "Content Piece", base: "STORY" },
        { id: "SOCIAL_POST", name: "Social Post", base: "TASK" },
        { id: "EVENT", name: "Event", base: "TASK" },
      ],
      fields: [
        { name: "Channel", kind: "multiselect", options: ["Website", "Email", "Facebook", "Instagram", "LinkedIn", "X", "Print", "Radio"], onBoard: true },
        { name: "Target audience", kind: "text" },
        { name: "Budget", kind: "currency", currency: "USD", itemTypes: ["CAMPAIGN", "EVENT"] },
        { name: "Publish date", kind: "date", itemTypes: ["CONTENT", "SOCIAL_POST"] },
        { name: "Campaign link", kind: "url", itemTypes: ["CAMPAIGN"] },
        { name: "Asset files", kind: "url", description: "A link to the folder with the artwork and copy." },
      ],
    },
  },
  {
    id: "hr",
    name: "HR",
    description: "Requests received, reviewed and approved or rejected. Recruitment, onboarding, leave requests and policy tasks.",
    icon: "users",
    key: "HR",
    blueprint: {
      statuses: [
        { key: "RECEIVED", name: "Request Received", category: "TODO" },
        { key: "REVIEW", name: "Under Review", category: "IN_PROGRESS" },
        { key: "AWAITING", name: "Awaiting Approval", category: "IN_PROGRESS" },
        { key: "APPROVED", name: "Approved", category: "IN_PROGRESS" },
        { key: "REJECTED", name: "Rejected", category: "DONE" },
        { key: "COMPLETED", name: "Completed", category: "DONE" },
      ],
      workflows: [
        {
          key: "hr",
          name: "HR requests",
          description: "Received, reviewed, approved or rejected, then completed.",
          statuses: ["RECEIVED", "REVIEW", "AWAITING", "APPROVED", "REJECTED", "COMPLETED"].map((s, i) => ({ status: s, initial: i === 0 })),
          transitions: [
            { name: "Review", from: "RECEIVED", to: "REVIEW", rules: [{ kind: "validator", rule: "assignee_set" }] },
            { name: "Ask for approval", from: "REVIEW", to: "AWAITING", rules: [] },
            { name: "Approve", from: "AWAITING", to: "APPROVED", rules: [{ kind: "condition", rule: "role", value: "manager" }] },
            { name: "Reject", from: "AWAITING", to: "REJECTED", rules: [{ kind: "condition", rule: "role", value: "manager" }, { kind: "validator", rule: "comment_required" }, { kind: "post_function", rule: "set_resolution", value: "WONT_DO" }] },
            { name: "Complete", from: "APPROVED", to: "COMPLETED", rules: [] },
            { name: "Reopen", from: null, to: "RECEIVED", rules: [] },
          ],
        },
      ],
      workspaceWorkflow: "hr",
      itemTypes: [
        ...hiddenBuiltIns(),
        { id: "RECRUITMENT", name: "Recruitment", base: "TASK" },
        { id: "ONBOARDING", name: "Onboarding", base: "TASK" },
        { id: "LEAVE", name: "Leave Request", base: "TASK" },
        { id: "POLICY", name: "Policy Task", base: "TASK" },
      ],
      fields: [
        { name: "Employee", kind: "user", itemTypes: ["ONBOARDING", "LEAVE"] },
        { name: "Leave from", kind: "date", itemTypes: ["LEAVE"], required: true },
        { name: "Leave to", kind: "date", itemTypes: ["LEAVE"], required: true },
        { name: "Position", kind: "text", itemTypes: ["RECRUITMENT"] },
      ],
    },
  },
  {
    id: "projects",
    name: "Projects (general)",
    description: "To Do, In Progress, Blocked, In Review, Done. Epics, stories, tasks and bugs.",
    icon: "folder-kanban",
    key: "PRJ",
    blueprint: {
      statuses: [
        { key: "TODO", name: "To Do", category: "TODO" },
        { key: "IN_PROGRESS", name: "In Progress", category: "IN_PROGRESS" },
        { key: "BLOCKED", name: "Blocked", category: "IN_PROGRESS" },
        { key: "IN_REVIEW", name: "In Review", category: "IN_PROGRESS" },
        { key: "DONE", name: "Done", category: "DONE" },
      ],
      workflows: [
        {
          ...linear("prj", "Projects", ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"], [
            { from: "IN_PROGRESS", to: "BLOCKED", name: "Blocked", rules: [{ kind: "validator", rule: "comment_required" }] },
            { from: "BLOCKED", to: "IN_PROGRESS", name: "Unblocked" },
            { from: null, to: "TODO", name: "Reopen" },
          ]),
          statuses: ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE"].map((s, i) => ({ status: s, initial: i === 0 })),
        },
      ],
      workspaceWorkflow: "prj",
      itemTypes: BUILT_IN_TYPES,
      fields: [],
    },
  },
];

/** The kinds an item type can be, and what each means. */
/** @type {Record<"EPIC" | "STORY" | "TASK" | "BUG" | "SUBTASK", string>} */ export const ITEM_KINDS = {
  EPIC: "Epic: groups other items",
  STORY: "Story: a piece of work, can have sub-tasks",
  TASK: "Task: a piece of work, can have sub-tasks",
  BUG: "Bug: a problem to fix, can have sub-tasks",
  SUBTASK: "Sub-task: a step under another item",
};
