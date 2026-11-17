import { useId, useState } from "react";
import { Bookmark, Bug, CheckSquare, Layers, ListTree } from "lucide-react";
import { STATUS_META, TYPE_META, WORK_PRIORITY_META, type WorkItemType, type WorkPriority, type WorkStatus } from "../data/workitems";
import Markdown from "./Markdown";

/** The address of a work item's page. */
export const itemHref = (systemId: string, key: string) => `#/projects/${systemId}/items/${key}`;

const TYPE_ICON: Record<WorkItemType, typeof Bug> = { EPIC: Layers, STORY: Bookmark, TASK: CheckSquare, BUG: Bug, SUBTASK: ListTree };

/** A work item's type as a small coloured icon, named for screen readers. */
export function TypeIcon({ type, size = 15 }: { type: WorkItemType; size?: number }) {
  const Icon = TYPE_ICON[type];
  return (
    <span className={`wi-type wi-type-${type.toLowerCase()}`} title={TYPE_META[type].label} role="img" aria-label={TYPE_META[type].label}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

export function ItemStatusPill({ status, onHold, wontDo }: { status: WorkStatus; onHold?: boolean; wontDo?: boolean }) {
  const m = STATUS_META[status];
  return (
    <span className="wi-status-wrap">
      <span className={`pill sm fill-${m.tone}`}>{wontDo ? "Won't do" : m.label}</span>
      {onHold && <span className="pill sm fill-amber">On hold</span>}
    </span>
  );
}

export function ItemPriority({ priority }: { priority: WorkPriority }) {
  return <span className={`prio prio-${priority.toLowerCase()}`}>{WORK_PRIORITY_META[priority].label}</span>;
}

/** Children done of total, as a thin bar with the percentage. */
export function Rollup({ done, total }: { done: number; total: number }) {
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

/** A Markdown text box with Write and Preview tabs. */
export function MarkdownField({
  label,
  value,
  onChange,
  rows = 6,
  placeholder,
  usernames,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  usernames?: string[];
  autoFocus?: boolean;
}) {
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
