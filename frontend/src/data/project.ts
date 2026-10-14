// Project documents, blockers, stall detection and developer workload.
// Shared by the UI and the Worker.

import type { System } from "./systems";
import type { User } from "./roles";
import { isOpen, type Feature } from "./features";

export interface ProjectDocument {
  id: string;
  systemId: string;
  name: string;
  kind: "file" | "link";
  url?: string; // links only
  mime?: string; // files only
  size?: number; // files only, bytes
  uploadedBy: string;
  uploadedAt: string;
}

export interface Blocker {
  id: string;
  systemId: string;
  text: string;
  raisedBy: string;
  raisedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
}

/** When a developer counts as overloaded, and when a project counts as stalled. Set by an admin. */
export interface Limits {
  projects: number; // most active (not yet delivered) projects per developer
  features: number; // most open feature requests per developer
  stallDays: number; // days without a progress update before an active project is flagged
}

export const DEFAULT_LIMITS: Limits = { projects: 3, features: 5, stallDays: 14 };

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const DAY = 86_400_000;

/** Being built right now: started, not delivered, not a mere idea. */
export function isActive(s: System, now: number): boolean {
  if (s.finishedAt || s.status === "LIVE" || s.status === "COMPLETED" || s.status === "IDEA") return false;
  return new Date(s.startedAt).getTime() <= now;
}

/** Days since the last progress update on an active project, once that reaches the limit; else null. */
export function stalledDays(s: System, now: number, limits: Limits): number | null {
  if (!isActive(s, now)) return null;
  const last = new Date(s.updatedAt ?? s.startedAt).getTime();
  const days = Math.floor((now - last) / DAY);
  return days >= limits.stallDays ? days : null;
}

export interface Workload {
  active: number; // active projects assigned
  openFeatures: number;
  overloaded: boolean;
  reasons: string[]; // why, in words, for tooltips and flags
}

export function workloadOf(user: User, systems: System[], features: Feature[], limits: Limits, now: number): Workload {
  const active = systems.filter((s) => user.projectIds?.includes(s.id) && isActive(s, now)).length;
  const openFeatures = features.filter((f) => f.assignee === user.id && isOpen(f)).length;
  const reasons = [
    ...(active > limits.projects ? [`${active} active projects (limit ${limits.projects})`] : []),
    ...(openFeatures > limits.features ? [`${openFeatures} open feature requests (limit ${limits.features})`] : []),
  ];
  return { active, openFeatures, overloaded: reasons.length > 0, reasons };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
