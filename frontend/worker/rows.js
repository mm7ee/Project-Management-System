/** @import { Feature, FeatureKind, FeatureStatus, Priority } from '../src/data/features' */
export const toFeature =
  /**
   * @param {FeatureRow} r
   * @returns {Feature}
   */ (r) => ({
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
/**
 * @typedef {Object} FeatureRow
 * @property {string} id
 * @property {string | null} [security_level]
 * @property {string} system_id
 * @property {string} title
 * @property {string} description
 * @property {FeatureKind} kind
 * @property {string} client
 * @property {FeatureStatus} status
 * @property {Priority} priority
 * @property {string | null} assignee
 * @property {string | null} notes
 * @property {string | null} due_at
 * @property {string} created_by
 * @property {string} created_at
 * @property {string} updated_at
 * @property {string | null} completed_at
 * @property {string | null} [item_key]
 */
