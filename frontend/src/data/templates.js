/** @import { Status } from './systems' */
export {}; // the type imports above belong to the file, not to the first declaration
/**
 * The due date a template suggests for a project starting on `startedAt` (YYYY-MM-DD).
 * @param {Pick<ProjectTemplate, "durationWeeks">} t
 * @param {string} startedAt
 * @returns {string}
 */
export function templateDueDate(t, startedAt) {
  if (!t.durationWeeks) return "";
  const d = new Date(`${startedAt}T12:00:00`);
  d.setDate(d.getDate() + t.durationWeeks * 7);
  return d.toISOString().slice(0, 10);
}
/**
 * @typedef {Object} ProjectTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} summary
 * @property {string} description
 * @property {Status} status
 * @property {number} progress
 * @property {number} [durationWeeks]
 * @property {string} [createdBy]
 * @property {string} createdAt
 */
