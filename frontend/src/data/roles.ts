// Roles and permissions, shared by the Worker (which enforces them) and the UI (which hides
// what you can't do). The administrator can change which permissions each role has; these
// are the defaults a fresh database starts with.

export type Role = "admin" | "manager" | "team_lead" | "assistant" | "developer" | "viewer";

export type Permission =
  | "edit_assigned" // update status/progress of the projects you're assigned to
  | "edit_any" // update status/progress of any project
  | "manage_systems" // add, delete, edit details, change leads
  | "assign_developers" // add and remove developers on a project, e.g. to rebalance workload
  | "request_updates" // ask a project's developers for an update
  | "propose_projects" // propose a new project with a Project Concept Note (starts as an Idea)
  | "log_features" // log feature requests (assigned to yourself or no one) and edit the ones you logged
  | "manage_features" // log client feature requests, set their priority and assign developers
  | "create_work_items" // create work items (assigned to yourself or no one, unless you may edit any)
  | "edit_work_items" // edit and assign any work item; without it you edit the items assigned to you or that you reported
  | "delete_work_items" // delete work items
  | "log_time" // log time spent on the work items you can see
  | "manage_workflows" // edit statuses and workflows, and choose which workflow each workspace and project uses
  | "manage_sprints" // plan sprints from the backlog, start and complete them
  | "reports" // generate and download reports
  | "manage_users" // create users, assign roles/projects, change permissions
  | "audit_log"; // view the activity log: sign-ins, failed sign-ins and every change

export const ROLES: Role[] = ["admin", "manager", "team_lead", "assistant", "developer", "viewer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  team_lead: "Team Leader",
  assistant: "Projects Assistant",
  developer: "Developer",
  viewer: "Standard user",
};

export const PERMISSIONS: { key: Permission; label: string }[] = [
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
  { key: "reports", label: "Generate reports" },
  { key: "manage_users", label: "Manage users, roles and permissions" },
  { key: "audit_log", label: "View the activity log" },
];

export type RolePermissions = Record<Role, Permission[]>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin: PERMISSIONS.map((p) => p.key),
  manager: ["request_updates", "propose_projects", "manage_features", "assign_developers", "reports", "create_work_items", "edit_work_items", "delete_work_items", "log_time", "manage_sprints"],
  team_lead: ["manage_systems", "assign_developers", "request_updates", "propose_projects", "manage_features", "reports", "create_work_items", "edit_work_items", "delete_work_items", "log_time", "manage_workflows", "manage_sprints"],
  assistant: ["request_updates", "propose_projects", "reports", "create_work_items"],
  developer: ["edit_assigned", "propose_projects", "log_features", "create_work_items", "log_time"],
  viewer: [],
};

/** The one account two-step verification is never required for: the default administrator. */
export const MFA_EXEMPT_USER = "admin";

/** Whether the policy requires two-step for this account: its role is listed and it isn't exempt. */
export function mfaRequiredFor(user: { id: string; role: Role }, policy: { roles: Role[] }): boolean {
  return policy.roles.includes(user.role) && !(user.id === MFA_EXEMPT_USER && user.role === "admin");
}

/** Admins always keep every permission, so nobody can lock the system out of user management. */
export function permissionsFor(role: Role, matrix: RolePermissions): Permission[] {
  return role === "admin" ? PERMISSIONS.map((p) => p.key) : matrix[role] ?? [];
}

/** Public profile of a user, as everyone signed in sees it. */
export interface User {
  id: string;
  username: string;
  name: string;
  title: string;
  email?: string;
  phone?: string;
  role: Role;
  projectIds?: string[]; // developers only: the projects they're assigned to
  mustChangePassword?: boolean; // reset by an admin; must choose a new password at sign-in
  mfaEnabled?: boolean; // two-step verification is on: an authenticator app and/or a passkey
  mfaMethods?: ("app" | "passkey")[]; // which ones (shown to administrators)
  lastLogin?: string; // ISO; only sent to people who can view the activity log
  lockedUntil?: string; // ISO; the account is locked after too many wrong passwords (sent to administrators only)
  lockedAt?: string; // ISO; when it locked
}

/** A developer on the project, or its lead: what "Assigned to me" shows. */
export function isAssigned(user: User, system: { id: string; lead?: string }): boolean {
  return system.lead === user.id || !!user.projectIds?.includes(system.id);
}

/** Roles that must use two-step verification. Set by an administrator. */
export interface MfaPolicy {
  roles: Role[];
}

/** One line of the activity log. `detail` holds names and before/after values for display. */
export interface ActivityEntry {
  id: number;
  at: string;
  userId: string | null;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
  ip: string | null;
  agent: string | null;
}

/** Personal display preferences, saved to the account so they follow the user. */
export interface Prefs {
  theme: "light" | "futuristic" | "system"; // "futuristic" is shown as "Dark"
  motion: "full" | "reduced";
  density: "comfortable" | "compact";
  start: string; // page to open on sign-in: "DASHBOARD", or a Projects tab (a Filter key)
  projectsView: "grid" | "list"; // how the Projects page lays out projects
  glass: "1" | "2" | "3" | "4" | "5"; // pop-up transparency: 1 see-through … 5 solid
  emailAlerts: "on" | "off"; // email "you were assigned" and the like, once email is connected
  emailSummaries: "on" | "off"; // email the daily digest and Monday Briefing
}

export const DEFAULT_PREFS: Prefs = { theme: "light", motion: "full", density: "comfortable", start: "DASHBOARD", projectsView: "grid", glass: "2", emailAlerts: "on", emailSummaries: "on" };

const PREF_CHOICES: { [K in keyof Prefs]: readonly string[] | null } = {
  theme: ["light", "futuristic", "system"],
  motion: ["full", "reduced"],
  density: ["comfortable", "compact"],
  start: null, // checked against the known sections by the caller
  projectsView: ["grid", "list"],
  glass: ["1", "2", "3", "4", "5"],
  emailAlerts: ["on", "off"],
  emailSummaries: ["on", "off"],
};

/** Keeps only known keys with allowed values; anything else falls back to the default. */
export function cleanPrefs(raw: unknown, startKeys: readonly string[]): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(PREF_CHOICES) as (keyof Prefs)[]) {
    // The old plain dark theme was retired; its users move to the one now called Dark.
    const v = k === "theme" && r[k] === "dark" ? "futuristic" : r[k];
    const allowed = PREF_CHOICES[k] ?? startKeys;
    if (typeof v === "string" && allowed.includes(v)) (out as Record<string, string>)[k] = v;
  }
  return out;
}

export const START_KEYS = ["DASHBOARD", "ALL", "MINE", "BLOCKED", "LIVE", "WIP", "TESTING", "TO_DEPLOY", "UPCOMING", "COMPLETED", "IDEA", "MAINTENANCE", "OVERDUE", "REQUESTED"] as const;

export interface UpdateRequest {
  id: string;
  systemId: string;
  requestedBy: string; // user id (or "share-…" for a view-only link)
  requestedByName?: string; // set for requests made through a view-only link
  message: string;
  createdAt: string;
}
