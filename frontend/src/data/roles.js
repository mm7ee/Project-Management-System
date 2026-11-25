// Roles and permissions, shared by the Worker (which enforces them) and the UI (which hides
// what you can't do). The administrator can change which permissions each role has; these
// are the defaults a fresh database starts with.
/** @type {Role[]} */ export const ROLES = ["admin", "manager", "team_lead", "assistant", "developer", "viewer"];
/** @type {Record<Role, string>} */ export const ROLE_LABEL = {
  admin: "Administrator",
  manager: "Manager",
  team_lead: "Team Leader",
  assistant: "Projects Assistant",
  developer: "Developer",
  viewer: "Standard user",
};
/** @type {{ key: Permission; label: string }[]} */ export const PERMISSIONS = [
  { key: "edit_assigned", label: "Update their assigned projects" },
  { key: "edit_any", label: "Update any project" },
  { key: "manage_systems", label: "Add, delete and edit systems" },
  { key: "assign_developers", label: "Add and remove developers on projects" },
  { key: "request_updates", label: "Request updates" },
  { key: "propose_projects", label: "Propose new projects with a Concept Note" },
  { key: "log_features", label: "Log feature requests" },
  { key: "manage_features", label: "Log and assign feature requests" },
  { key: "create_work_items", label: "Create work items" },
  { key: "edit_work_items", label: "Edit and assign any work item" },
  { key: "delete_work_items", label: "Delete work items" },
  { key: "log_time", label: "Log time on work items" },
  { key: "manage_workflows", label: "Edit workflows" },
  { key: "manage_sprints", label: "Plan and run sprints" },
  { key: "share_searches", label: "Share filters and dashboards" },
  { key: "manage_automation", label: "Manage automation rules" },
  { key: "manage_integrations", label: "Connect GitHub and manage webhooks" },
  { key: "use_api", label: "Use personal API tokens" },
  { key: "manage_schemes", label: "Manage notification schemes, security levels and custom fields" },
  { key: "work_service_desk", label: "Work the service desk and reply to customers" },
  { key: "manage_service_desk", label: "Set up the service desk" },
  { key: "reports", label: "Generate reports" },
  { key: "manage_users", label: "Manage users, roles and permissions" },
  { key: "audit_log", label: "View the activity log" },
];
/** @type {RolePermissions} */ export const DEFAULT_ROLE_PERMISSIONS = {
  admin: PERMISSIONS.map((p) => p.key),
  manager: ["request_updates", "propose_projects", "manage_features", "assign_developers", "reports", "create_work_items", "edit_work_items", "delete_work_items", "log_time", "manage_sprints", "share_searches", "use_api", "work_service_desk", "manage_service_desk"],
  team_lead: [
    "manage_systems",
    "assign_developers",
    "request_updates",
    "propose_projects",
    "manage_features",
    "reports",
    "create_work_items",
    "edit_work_items",
    "delete_work_items",
    "log_time",
    "manage_workflows",
    "manage_sprints",
    "share_searches",
    "manage_automation",
    "use_api",
    "work_service_desk",
  ],
  assistant: ["request_updates", "propose_projects", "reports", "create_work_items", "share_searches", "use_api", "work_service_desk"],
  developer: ["edit_assigned", "propose_projects", "log_features", "create_work_items", "log_time", "use_api", "work_service_desk"],
  viewer: [],
};
/**
 * The one account two-step verification is never required for: the default administrator.
 * @type {"admin"}
 */
export const MFA_EXEMPT_USER = "admin";
/**
 * Whether the policy requires two-step for this account: its role is listed and it isn't exempt.
 * @param {{ id: string; role: Role }} user
 * @param {{ roles: Role[] }} policy
 * @returns {boolean}
 */
export function mfaRequiredFor(user, policy) {
  return policy.roles.includes(user.role) && !(user.id === MFA_EXEMPT_USER && user.role === "admin");
}
/**
 * Admins always keep every permission, so nobody can lock the system out of user management.
 * @param {Role} role
 * @param {RolePermissions} matrix
 * @returns {Permission[]}
 */
export function permissionsFor(role, matrix) {
  return role === "admin" ? PERMISSIONS.map((p) => p.key) : (matrix[role] ?? []);
}
/**
 * A developer on the project, or its lead: what "Assigned to me" shows.
 * @param {User} user
 * @param {{ id: string; lead?: string }} system
 * @returns {boolean}
 */
export function isAssigned(user, system) {
  return system.lead === user.id || !!user.projectIds?.includes(system.id);
}
/** @type {Prefs} */ export const DEFAULT_PREFS = { theme: "light", motion: "full", density: "comfortable", start: "DASHBOARD", projectsView: "grid", glass: "2", emailAlerts: "on", emailSummaries: "on" };
/** @type {{ [K in keyof Prefs]: readonly string[] | null }} */ const PREF_CHOICES = {
  theme: ["light", "futuristic", "system"],
  motion: ["full", "reduced"],
  density: ["comfortable", "compact"],
  start: null, // checked against the known sections by the caller
  projectsView: ["grid", "list"],
  glass: ["1", "2", "3", "4", "5"],
  emailAlerts: ["on", "off"],
  emailSummaries: ["on", "off"],
};
/**
 * Keeps only known keys with allowed values; anything else falls back to the default.
 * @param {unknown} raw
 * @param {readonly string[]} startKeys
 * @returns {Prefs}
 */
export function cleanPrefs(raw, startKeys) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === "object" ? raw : {});
  const out = { ...DEFAULT_PREFS };
  for (const k of /** @type {(keyof Prefs)[]} */ (Object.keys(PREF_CHOICES))) {
    // The old plain dark theme was retired; its users move to the one now called Dark.
    const v = k === "theme" && r[k] === "dark" ? "futuristic" : r[k];
    const allowed = PREF_CHOICES[k] ?? startKeys;
    if (typeof v === "string" && allowed.includes(v)) /** @type {Record<string, string>} */ (out)[k] = v;
  }
  return out;
}
export const START_KEYS = /** @type {const} */ (["DASHBOARD", "ALL", "MINE", "BLOCKED", "LIVE", "WIP", "TESTING", "TO_DEPLOY", "UPCOMING", "COMPLETED", "IDEA", "MAINTENANCE", "OVERDUE", "REQUESTED"]);
/** @typedef {"admin" | "manager" | "team_lead" | "assistant" | "developer" | "viewer"} Role */
/**
 * @typedef {| "edit_assigned" // update status/progress of the projects you're assigned to
 *   | "edit_any" // update status/progress of any project
 *   | "manage_systems" // add, delete, edit details, change leads
 *   | "assign_developers" // add and remove developers on a project, e.g. to rebalance workload
 *   | "request_updates" // ask a project's developers for an update
 *   | "propose_projects" // propose a new project with a Project Concept Note (starts as an Idea)
 *   | "log_features" // log feature requests (assigned to yourself or no one) and edit the ones you logged
 *   | "manage_features" // log client feature requests, set their priority and assign developers
 *   | "create_work_items" // create work items (assigned to yourself or no one, unless you may edit any)
 *   | "edit_work_items" // edit and assign any work item; without it you edit the items assigned to you or that you reported
 *   | "delete_work_items" // delete work items
 *   | "log_time" // log time spent on the work items you can see
 *   | "manage_workflows" // edit statuses and workflows, and choose which workflow each workspace and project uses
 *   | "manage_sprints" // plan sprints from the backlog, start and complete them
 *   | "share_searches" // share saved filters and dashboards with a role, a workspace or everyone
 *   | "manage_automation" // create and change automation rules
 *   | "manage_integrations" // connect GitHub and manage outbound webhooks
 *   | "use_api" // create personal API tokens for other systems
 *   | "manage_schemes" // notification schemes, security levels and custom fields
 *   | "work_service_desk" // work the service desk queues and reply to customers
 *   | "manage_service_desk" // request types, SLA targets, holidays and portal links
 *   | "reports" // generate and download reports
 *   | "manage_users" // create users, assign roles/projects, change permissions
 *   | "audit_log"} Permission
 */
/** @typedef {Record<Role, Permission[]>} RolePermissions */
/**
 * Public profile of a user, as everyone signed in sees it.
 * @typedef {Object} User
 * @property {string} id
 * @property {string} username
 * @property {string} name
 * @property {string} title
 * @property {string} [email]
 * @property {string} [phone]
 * @property {Role} role
 * @property {string[]} [projectIds]
 * @property {boolean} [mustChangePassword]
 * @property {boolean} [mfaEnabled]
 * @property {("app" | "passkey")[]} [mfaMethods]
 * @property {string} [lastLogin]
 * @property {string} [lockedUntil]
 * @property {string} [lockedAt]
 */
/**
 * Roles that must use two-step verification. Set by an administrator.
 * @typedef {Object} MfaPolicy
 * @property {Role[]} roles
 */
/**
 * One line of the activity log. `detail` holds names and before/after values for display.
 * @typedef {Object} ActivityEntry
 * @property {number} id
 * @property {string} at
 * @property {string | null} userId
 * @property {string} actor
 * @property {string} action
 * @property {string | null} target
 * @property {Record<string, unknown>} detail
 * @property {string | null} ip
 * @property {string | null} agent
 */
/**
 * Personal display preferences, saved to the account so they follow the user.
 * @typedef {Object} Prefs
 * @property {"light" | "futuristic" | "system"} theme
 * @property {"full" | "reduced"} motion
 * @property {"comfortable" | "compact"} density
 * @property {string} start
 * @property {"grid" | "list"} projectsView
 * @property {"1" | "2" | "3" | "4" | "5"} glass
 * @property {"on" | "off"} emailAlerts
 * @property {"on" | "off"} emailSummaries
 */
/**
 * @typedef {Object} UpdateRequest
 * @property {string} id
 * @property {string} systemId
 * @property {string} requestedBy
 * @property {string} [requestedByName]
 * @property {string} message
 * @property {string} createdAt
 * @property {import("./updateRequests").RequestChannel[]} [via]
 */
