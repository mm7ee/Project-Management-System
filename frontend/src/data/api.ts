import { useCallback, useEffect, useState } from "react";
import type { System } from "./systems";
import type { Feature } from "./features";
import type { Permission, Prefs, RolePermissions, UpdateRequest, User } from "./roles";

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

export interface AppData {
  me: User;
  prefs: Prefs;
  permissions: Permission[];
  roleMatrix: RolePermissions;
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
  features: Feature[];
}

/**
 * Loads everything the signed-in user can see. `data` is null when signed out.
 * `mustChange` is set when an administrator reset the password: the server refuses all data
 * until a new password is chosen.
 */
export function useAppData() {
  const [data, setData] = useState<AppData | null>(null);
  const [mustChange, setMustChange] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api<AppData>("/data"));
      setMustChange(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setData(null);
        setMustChange(null);
      } else if (e instanceof ApiError && e.code === "password_change_required") {
        setData(null);
        setMustChange(e.message);
      } else throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, mustChange, loading, reload };
}
