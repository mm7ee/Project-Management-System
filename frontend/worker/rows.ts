// Database rows used by more than one part of the Worker.

import type { Feature, FeatureKind, FeatureStatus, Priority } from "../src/data/features";

export interface FeatureRow {
  id: string;
  system_id: string;
  title: string;
  description: string;
  kind: FeatureKind;
  client: string;
  status: FeatureStatus;
  priority: Priority;
  assignee: string | null;
  notes: string | null;
  due_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  item_key?: string | null; // its work item's key (INFRA-12); from the features view
}

export const toFeature = (r: FeatureRow): Feature => ({
  id: r.id,
  systemId: r.system_id,
  title: r.title,
  description: r.description,
  kind: r.kind,
  client: r.client,
  status: r.status,
  priority: r.priority,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  ...(r.assignee ? { assignee: r.assignee } : {}),
  ...(r.notes ? { notes: r.notes } : {}),
  ...(r.due_at ? { dueAt: r.due_at } : {}),
  ...(r.completed_at ? { completedAt: r.completed_at } : {}),
  ...(r.item_key ? { key: r.item_key } : {}),
});
