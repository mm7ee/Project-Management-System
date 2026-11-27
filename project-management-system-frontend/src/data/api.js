/** @import { System } from './systems' */
/** @import { Feature } from './features' */
/** @import { Blocker, Limits, ProjectDocument } from './project' */
/** @import { ProjectTemplate } from './templates' */
/** @import { MfaPolicy, Permission, Prefs, RolePermissions, UpdateRequest, User } from './roles' */
/** @import { SigninRules } from './signin' */
import { useCallback, useEffect, useState } from "react";
/** @extends Error */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [payload={}]
   */
  constructor(status, message, code, payload = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}
/** The secret of a view-only share link, when the page was opened at /view/<secret>. */
/** @type {string | null} */ export const shareToken = typeof window !== "undefined" ? (window.location.pathname.match(/^\/view\/([A-Za-z0-9_-]{20,})\/?$/)?.[1] ?? null) : null;
/**
 * @template [T=unknown]
 * @param {string} path
 * @param {string} [method="GET"]
 * @param {unknown} [data]
 * @returns {Promise<T>}
 */
export async function api(path, method = "GET", data) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(data !== undefined ? { "content-type": "application/json" } : {}),
      ...(shareToken ? { "x-share-token": shareToken } : {}),
    },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Request failed (${res.status})`, payload.code, payload);
  return /** @type {T} */ (payload);
}
/**
 * Uploads one file to a chat conversation, ready to be sent with the next message.
 * @template T
 * @param {string} conversationId
 * @param {File} file
 * @returns {Promise<T>}
 */
export async function uploadChatFile(conversationId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/chat/${conversationId}/files`, { method: "POST", credentials: "same-origin", body: form });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Upload failed (${res.status})`, payload.code);
  return /** @type {T} */ (payload);
}
/**
 * Uploads one file to a project's documents (multipart, so it can't go through `api`).
 * @param {string} systemId
 * @param {File} file
 * @returns {Promise<{ id?: string }>} the new document's id
 */
export async function uploadDocument(systemId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/systems/${systemId}/documents`, { method: "POST", credentials: "same-origin", body: form });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Upload failed (${res.status})`, payload.code);
  return { id: typeof payload.id === "string" ? payload.id : undefined };
}
/**
 * Loads everything the signed-in user can see. `data` is null when signed out.
 * `mfaSetup` is set when the user's role requires two-step verification and it isn't on yet.
 * `mustChange` is set when an administrator reset the password: the server refuses all data
 * until a new password is chosen.
 */
export function useAppData() {
  const [data, setData] = useState(/** @type {AppData | null | (() => AppData | null)} */ (null));
  const [mustChange, setMustChange] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [changeFor, setChangeFor] = useState(/** @type {{ username?: string; name?: string } | undefined | undefined} */ (undefined)); // whose password it is
  const [mfaSetup, setMfaSetup] = useState(/** @type {string | null | (() => string | null)} */ (null));
  const [shareError, setShareError] = useState(/** @type {string | null | (() => string | null)} */ (null)); // a view-only link that no longer works
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setData(await /** @type {Promise<AppData>} */ (/** @type {unknown} */ (api("/data"))));
      setMustChange(null);
      setMfaSetup(null);
    } catch (e) {
      setMustChange(null);
      setMfaSetup(null);
      if (e instanceof ApiError && e.code === "share_invalid") {
        setData(null);
        setShareError(e.message);
      } else if (e instanceof ApiError && e.status === 401) {
        setData(null);
      } else if (e instanceof ApiError && e.code === "password_change_required") {
        setData(null);
        setMustChange(e.message);
        setChangeFor(/** @type {{ username?: string; name?: string } | undefined} */ (e.payload.who));
      } else if (e instanceof ApiError && e.code === "mfa_setup_required") {
        setData(null);
        setMfaSetup(e.message);
      } else throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, mustChange, changeFor, mfaSetup, shareError, loading, reload };
}
/**
 * @typedef {Object} Passkey
 * @property {string} id
 * @property {string} name
 * @property {string} createdAt
 * @property {string} [lastUsedAt]
 */
/**
 * @typedef {Object} TwoStep
 * @property {boolean} app
 * @property {Passkey[]} passkeys
 */
/**
 * "I've lost every way to verify", raised at sign-in after the right password.
 * @typedef {Object} MfaHelpRequest
 * @property {string} id
 * @property {string} userId
 * @property {string} name
 * @property {string} message
 * @property {string} createdAt
 * @property {string} [ip]
 */
/**
 * Where you are: one organisation, one open workspace (multi-tenancy, DECISIONS.md).
 * @typedef {Object} Tenant
 * @property {{ id: string; name: string; code: string; branding?: import("./branding").BrandingView | null } | null} organization  with its branding (logo, accent), shown inside its own space
 * @property {{ id: string; name: string; key: string; icon?: string; colour?: string | null } | null} workspace
 * @property {{ id: string; name: string; key: string; role: string; icon?: string; colour?: string; open?: boolean }[]} workspaces yours to switch between, and (`open`) the organisation-wide ones you'd open as a Viewer (none on a view-only link)
 * @property {boolean} orgAdmin
 */
/**
 * @typedef {Object} AppData
 * @property {User} me
 * @property {Prefs} prefs
 * @property {Permission[]} permissions
 * @property {RolePermissions} roleMatrix
 * @property {System[]} systems
 * @property {User[]} users
 * @property {UpdateRequest[]} requests
 * @property {Feature[]} features
 * @property {ProjectDocument[]} documents
 * @property {Blocker[]} blockers
 * @property {Limits} limits
 * @property {string[]} workspaces the open workspace's name (pickers that choose a workspace see only it)
 * @property {Tenant} [tenant] the organisation, the open workspace, and the workspaces you can switch to
 * @property {import("./updateRequests").ChannelAvailability} [requestChannels]
 * @property {MfaPolicy} mfaPolicy
 * @property {SigninRules} [signinRules]
 * @property {number} recoveryCodesLeft
 * @property {TwoStep} twoStep
 * @property {MfaHelpRequest[]} mfaHelp
 * @property {ProjectTemplate[]} templates
 * @property {{ label: string; expiresAt: string }} [viewOnly]
 */
