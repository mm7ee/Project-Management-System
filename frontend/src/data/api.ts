import { useCallback, useEffect, useState } from "react";
import type { System } from "./systems";
import type { Permission, RolePermissions, UpdateRequest, User } from "./roles";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
  if (!res.ok) throw new ApiError(res.status, payload.error ?? `Request failed (${res.status})`);
  return payload as T;
}

export interface AppData {
  me: User;
  permissions: Permission[];
  roleMatrix: RolePermissions;
  systems: System[];
  users: User[];
  requests: UpdateRequest[];
}

/** Loads everything the signed-in user can see. `data` is null when signed out. */
export function useAppData() {
  const [data, setData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setData(await api<AppData>("/data"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, reload };
}
