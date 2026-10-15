// Project templates: starting points for "Add system". A template prefills the form; everything
// can still be changed before saving. Stored in the D1 `templates` table.

import type { Status } from "./systems";

export interface ProjectTemplate {
  id: string;
  name: string; // "Web application"
  summary: string; // what kind of project it suits, shown when choosing
  description: string; // prefilled project description, often a structure to fill in
  status: Status;
  progress: number;
  durationWeeks?: number; // due date = start + this; none for open-ended ones like ideas
  createdBy?: string; // user id; unset for the built-in starters
  createdAt: string;
}

/** The due date a template suggests for a project starting on `startedAt` (YYYY-MM-DD). */
export function templateDueDate(t: Pick<ProjectTemplate, "durationWeeks">, startedAt: string): string {
  if (!t.durationWeeks) return "";
  const d = new Date(`${startedAt}T12:00:00`);
  d.setDate(d.getDate() + t.durationWeeks * 7);
  return d.toISOString().slice(0, 10);
}
