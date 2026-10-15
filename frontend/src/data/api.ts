import { useCallback, useEffect, useState } from "react";
import type { System } from "./systems";
import type { Feature } from "./features";
import type { Blocker, Limits, ProjectDocument } from "./project";
import type { ProjectTemplate } from "./templates";
import type { MfaPolicy, Permission, Prefs, RolePermissions, UpdateRequest, User } from "./roles";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, method = "GET", data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: data !== undefined ? { "content-type": "application/json" } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Request failed (${res.status})`, payload.code);
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
  mfaPolicy: MfaPolicy;
  recoveryCodesLeft: number; // your unused two-step recovery codes
  templates: ProjectTemplate[];
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
  const [mfaSetup, setMfaSetup] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api<AppData>("/data"));
      setMustChange(null);
      setMfaSetup(null);
    } catch (e) {
      setMustChange(null);
      setMfaSetup(null);
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
      } else if (e instanceof ApiError && e.code === "password_change_required") {
        setData(null);
        setMustChange(e.message);
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

  return { data, mustChange, mfaSetup, loading, reload };
}
