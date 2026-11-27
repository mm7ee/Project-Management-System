// Organisation administration, shared by the Worker (worker/orgadmin.js) and the screens (components/OrgAdmin.jsx).

/** The icons a workspace can have (lucide names). */
export const WORKSPACE_ICONS = /** @type {const} */ (["layers", "code", "megaphone", "users", "briefcase", "wallet", "headset", "folder-kanban", "flask-conical", "building-2"]);
/** @typedef {(typeof WORKSPACE_ICONS)[number]} WorkspaceIcon */

/** ISO weekday numbers (1 = Monday). */
export const WEEKDAYS = /** @type {const} */ ([
  [1, "Mon"],
  [2, "Tue"],
  [3, "Wed"],
  [4, "Thu"],
  [5, "Fri"],
  [6, "Sat"],
  [7, "Sun"],
]);

/** How each audit log action reads. Anything not listed is shown as its code with underscores as spaces. */
/** @type {Record<string, string>} */ export const AUDIT_ACTIONS = {
  organization_profile_updated: "Changed the organisation profile",
  organization_branding_updated: "Changed the organisation's branding",
  organization_theme_published: "Published a theme",
  organization_theme_draft_saved: "Saved a theme draft",
  organization_theme_draft_discarded: "Discarded a theme draft",
  organization_theme_rolled_back: "Went back to an earlier theme",
  organization_theme_turned_off: "Turned the theme off",
  workspace_created: "Made a workspace",
  workspace_updated: "Changed a workspace",
  person_created: "Added a person",
  person_invited: "Invited a person",
  people_imported: "Imported people",
  person_updated: "Changed a person",
  person_removed: "Removed a person",
  person_deactivated: "Deactivated a person",
  person_reactivated: "Reactivated a person",
  member_added: "Added to a workspace",
  member_removed: "Took out of a workspace",
  member_role_changed: "Changed a role",
  member_joined_open_workspace: "Opened an organisation-wide workspace",
  role_permissions_updated: "Changed role permissions",
};

// Logo and icon limits are in src/data/branding.js (IMAGE_BOX, UPLOAD_MAX_BYTES, STORED_MAX_BYTES).
