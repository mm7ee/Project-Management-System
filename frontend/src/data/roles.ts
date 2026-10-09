// Roles and permissions, shared by the Worker (which enforces them) and the UI (which hides
// what you can't do). The administrator can change which permissions each role has; these
// are the defaults a fresh database starts with.

export type Role = "admin" | "manager" | "developer" | "viewer";

export type Permission =
  | "edit_assigned" // update status/progress of the project you're assigned to
  | "edit_any" // update status/progress of any project
  | "manage_systems" // add, delete, edit details, change leads
  | "request_updates" // ask a project's developers for an update
  | "reports" // generate and download reports
  | "manage_users"; // create users, assign roles/projects, change permissions

export const ROLES: Role[] = ["admin", "manager", "developer", "viewer"];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrator",
  manager: "Manager",
  developer: "Developer",
  viewer: "Standard user",
};

export const PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "edit_assigned", label: "Update their assigned project" },
  { key: "edit_any", label: "Update any project" },
  { key: "manage_systems", label: "Add, delete and edit systems" },
  { key: "request_updates", label: "Request updates" },
  { key: "reports", label: "Generate reports" },
  { key: "manage_users", label: "Manage users, roles and permissions" },
];

export type RolePermissions = Record<Role, Permission[]>;

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin: PERMISSIONS.map((p) => p.key),
  manager: ["request_updates", "reports"],
  developer: ["edit_assigned"],
  viewer: [],
};

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
  projectId?: string; // developers are assigned to exactly one project
}

export interface UpdateRequest {
  id: string;
  systemId: string;
  requestedBy: string; // user id
  message: string;
  createdAt: string;
}
