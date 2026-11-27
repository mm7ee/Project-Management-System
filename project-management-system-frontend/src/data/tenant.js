// Which organisation and workspace, as this browser remembers them (multi-tenancy). Only conveniences: the
// server decides everything. The organisation code is remembered so the sign-in page needn't ask again; the last
// workspace per organisation is offered first when choosing. Things a page remembers inside a workspace (the last
// dashboard or board) are kept per workspace, so one workspace's choices never appear in another.

const ORG_KEY = "pms:org";
const LAST_WS_KEY = "pms:last-workspace";
/** The open workspace's id and the organisation's name, set by the app once its data has loaded. */
let openWorkspace = "";
let openOrganisation = "";

/**
 * An organisation code as typed: lower case, letters, digits and dashes, or "" if it can't be one.
 * (The server applies the same rule.)
 * @param {unknown} v
 * @returns {string}
 */
export function cleanCode(v) {
  const code = String(v ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 32);
  return /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(code) ? code : "";
}
/** The code in a sign-in link (#/o/<code>), if any. */
export function codeInLink() {
  const m = window.location.hash.match(/^#\/o\/([^/?#]+)/);
  return m ? cleanCode(decodeURIComponent(m[1])) : "";
}
/** The organisation to sign in to: a link's, else the one remembered on this device, else none (ask). */
export function initialOrgCode() {
  const linked = codeInLink();
  if (linked) return linked;
  try {
    return cleanCode(localStorage.getItem(ORG_KEY));
  } catch {
    return "";
  }
}
/** @param {string} code */
export function rememberOrg(code) {
  try {
    if (code) localStorage.setItem(ORG_KEY, code);
  } catch {
    // Only a convenience.
  }
  // A sign-in link has done its job; don't leave the code in the address.
  if (codeInLink()) history.replaceState(null, "", window.location.pathname + window.location.search);
}
export function forgetOrg() {
  try {
    localStorage.removeItem(ORG_KEY);
  } catch {
    // Only a convenience.
  }
}
/**
 * @param {string} orgId
 * @returns {string}
 */
export function lastWorkspace(orgId) {
  try {
    return /** @type {Record<string, string>} */ (JSON.parse(localStorage.getItem(LAST_WS_KEY) ?? "{}"))[orgId] ?? "";
  } catch {
    return "";
  }
}
/**
 * @param {string} orgId
 * @param {string} workspaceId
 */
export function rememberWorkspace(orgId, workspaceId) {
  try {
    const all = /** @type {Record<string, string>} */ (JSON.parse(localStorage.getItem(LAST_WS_KEY) ?? "{}"));
    localStorage.setItem(LAST_WS_KEY, JSON.stringify({ ...all, [orgId]: workspaceId }));
  } catch {
    // Only a convenience.
  }
}
/** @param {string} workspaceId @param {string} [organisation] its name */
export function setOpenWorkspace(workspaceId, organisation = "") {
  openWorkspace = workspaceId;
  openOrganisation = organisation;
}
/** The open organisation's name (for printed covers), or "". */
export const organisationName = () => openOrganisation;
/**
 * A browser storage key for something remembered inside the open workspace.
 * @param {string} key
 * @returns {string}
 */
export function workspaceKey(key) {
  return openWorkspace ? `${key}@${openWorkspace}` : key;
}
