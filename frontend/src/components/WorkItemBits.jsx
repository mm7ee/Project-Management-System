/** @import { StatusCategory, WorkItemType, WorkPriority } from '../data/workitems' */
import { useId, useState } from "react";
import { Bookmark, Bug, CheckSquare, Layers, ListTree } from "lucide-react";
import { CATEGORY_TONE, TYPE_META, WORK_PRIORITY_META } from "../data/workitems";
import Markdown from "./Markdown";
/** The address of a work item's page. */
export const itemHref =
  /** @param {string} systemId
   * @param {string} key
   * @returns {string}
   */ (systemId, key) => `#/projects/${systemId}/items/${key}`;
/** @type {Record<WorkItemType, typeof Bug>} */ const TYPE_ICON = { EPIC: Layers, STORY: Bookmark, TASK: CheckSquare, BUG: Bug, SUBTASK: ListTree };
/**
 * A work item's type as a small coloured icon, named for screen readers.
 * @param {{ type: WorkItemType; size?: number }} arg2
 */
export function TypeIcon({ type, size = 15 }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={`wi-type wi-type-${type.toLowerCase()}`} title={TYPE_META[type].label} role="img" aria-label={TYPE_META[type].label}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
/**
 * An item's status, coloured by its category (To Do grey, In Progress blue, Done green).
 * @param {{ item: { statusName: string; statusCategory: StatusCategory; onHold?: boolean; resolution?: string } }} props
 */
export function ItemStatusPill({ item }) {
  return (
    <span className="wi-status-wrap">
      <span className={`pill sm fill-${CATEGORY_TONE[item.statusCategory]}`}>{item.resolution === "WONT_DO" ? `${item.statusName} · won't do` : item.statusName}</span>
      {item.onHold && <span className="pill sm fill-amber">On hold</span>}
    </span>
  );
}
/**
 * @param {{ priority: WorkPriority }} props
 */
export function ItemPriority({ priority }) {
  return <span className={`prio prio-${priority.toLowerCase()}`}>{WORK_PRIORITY_META[priority].label}</span>;
}
/**
 * Children done of total, as a thin bar with the percentage.
 * @param {{ done: number; total: number }} props
 */
export function Rollup({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="wi-rollup" title={`${done} of ${total} done`}>
      <span className="wi-rollup-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <small>{total ? `${pct}%` : "no items"}</small>
    </span>
  );
}
/**
 * A Markdown text box with Write and Preview tabs.
 * @param {{
 *   label: string;
 *   value: string;
 *   onChange: (v: string) => void;
 *   rows?: number;
 *   placeholder?: string;
 *   usernames?: string[];
 *   autoFocus?: boolean;
 * }} props
 */
export function MarkdownField({ label, value, onChange, rows = 6, placeholder, usernames, autoFocus }) {
  const [preview, setPreview] = useState(false);
  const id = useId();
  return (
    <div className="md-field">
      <div className="md-field-head">
        <label htmlFor={id}>{label}</label>
        <div className="seg sm" role="tablist" aria-label={`${label}: write or preview`}>
          <button type="button" role="tab" aria-selected={!preview} className={!preview ? "on" : ""} onClick={() => setPreview(false)}>
            Write
          </button>
          <button type="button" role="tab" aria-selected={preview} className={preview ? "on" : ""} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <div className="md-preview" role="tabpanel" aria-label={`${label} preview`}>
          {value.trim() ? <Markdown text={value} usernames={usernames} /> : <p className="lead-none">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea id={id} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      )}
      <small className="field-hint">Markdown: **bold**, *italic*, `code`, - lists, [links](https://…) and @username to mention someone.</small>
    </div>
  );
}
