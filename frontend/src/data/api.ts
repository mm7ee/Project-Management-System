import { useCallback, useEffect, useState } from "react";
import type { System } from "./systems";
import type { Feature } from "./features";
import type { Blocker, Limits, ProjectDocument } from "./project";
import type { ProjectTemplate } from "./templates";
import type { MfaPolicy, Permission, Prefs, RolePermissions, UpdateRequest, User } from "./roles";
import type { SigninRules } from "./signin";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public payload: Record<string, unknown> = {}) {
    super(message);
  }
}

/** The secret of a view-only share link, when the page was opened at /view/<secret>. */
export const shareToken: string | null = typeof window !== "undefined" ? (window.location.pathname.match(/^\/view\/([A-Za-z0-9_-]{20,})\/?$/)?.[1] ?? null) : null;

export async function api<T = unknown>(path: string, method = "GET", data?: unknown): Promise<T> {
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
  return payload as T;
}

/** Uploads one file to a project's documents (multipart, so it can't go through `api`). */
export async function uploadDocument(systemId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/systems/${systemId}/documents`, { method: "POST", credentials: "same-origin", body: form });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Upload failed (${res.status})`, payload.code);
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface TwoStep {
  app: boolean; // an authenticator app is linked
  passkeys: Passkey[];
}

/** "I've lost every way to verify", raised at sign-in after the right password. */
export interface MfaHelpRequest {
  id: string;
  userId: string;
  name: string;
  message: string;
  createdAt: string;
  ip?: string;
}

export interface AppData {
  me: User;
  prefs: Prefs;
  permissions: Permission[];
  roleMatrix: RolePermissions;
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  features: Feature[];
  documents: ProjectDocument[];
  blockers: Blocker[];
  limits: Limits;
  workspaces: string[]; // the workspace list projects are grouped by
  mfaPolicy: MfaPolicy;
  signinRules?: SigninRules; // the lockout rules (administrators only)
  recoveryCodesLeft: number; // your unused two-step recovery codes
  twoStep: TwoStep; // your own second-step methods
  mfaHelp: MfaHelpRequest[]; // people locked out of two-step verification (administrators only)
  templates: ProjectTemplate[];
  viewOnly?: { label: string; expiresAt: string }; // opened through a view-only share link
}

/**
 * Loads everything the signed-in user can see. `data` is null when signed out.
 * `mfaSetup` is set when the user's role requires two-step verification and it isn't on yet.
 * `mustChange` is set when an administrator reset the password: the server refuses all data
 * until a new password is chosen.
 */
export function useAppData() {
  const [data, setData] = useState<AppData | null>(null);
  const [mustChange, setMustChange] = useState<string | null>(null);
  const [changeFor, setChangeFor] = useState<{ username?: string; name?: string } | undefined>(); // whose password it is
  const [mfaSetup, setMfaSetup] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null); // a view-only link that no longer works
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api<AppData>("/data"));
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
        setChangeFor(e.payload.who as { username?: string; name?: string } | undefined);
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
