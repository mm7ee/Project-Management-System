/** @import { StatusCategory, WorkItemType, WorkPriority } from '../data/workitems' */
import { useId, useLayoutEffect, useRef, useState } from "react";
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
 * A Markdown text box with Write and Preview tabs. Typing @ and a letter suggests people to mention.
 * @param {{
 *   label: string;
 *   value: string;
 *   onChange: (v: string) => void;
 *   rows?: number;
 *   placeholder?: string;
 *   usernames?: string[];
 *   people?: { username: string; name: string }[];
 *   autoFocus?: boolean;
 * }} props
 */
export function MarkdownField({ label, value, onChange, rows = 6, placeholder, usernames, people, autoFocus }) {
  const [preview, setPreview] = useState(false);
  const id = useId();
  const listId = useId();
  const box = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [closed, setClosed] = useState(false);
  // Who can be suggested: the people given, or just the usernames.
  const who = people ?? (usernames ?? []).map((u) => ({ username: u, name: "" }));
  // The @word being typed at the caret (at least one letter), if any.
  const mention = value.slice(0, caret).match(/(?:^|[^\w@])@([a-z0-9._-]{1,40})$/i);
  const q = mention?.[1].toLowerCase() ?? "";
  const suggestions =
    mention && !closed
      ? who
          .filter((u) => u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
          .sort((a, b) => Number(!a.username.toLowerCase().startsWith(q)) - Number(!b.username.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
          .slice(0, 6)
      : [];
  const at = Math.min(pick, Math.max(0, suggestions.length - 1));
  // Put @username in place of the letters typed, followed by a space.
  const insert = /** @param {{ username: string }} u */ (u) => {
    const start = caret - q.length;
    onChange(`${value.slice(0, start)}${u.username} ${value.slice(caret)}`);
    const next = start + u.username.length + 1;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next, next);
      setCaret(next);
    });
  };
  useLayoutEffect(() => setPick(0), [q]);
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
        <div className="md-input">
          <textarea
            ref={box}
            id={id}
            rows={rows}
            value={value}
            placeholder={placeholder}
            autoFocus={autoFocus}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={suggestions.length ? `${listId}-${at}` : undefined}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart);
              setClosed(false);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={(e) => {
              if (!suggestions.length) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (Math.min(p, suggestions.length - 1) + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
              } else if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insert(suggestions[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setClosed(true);
              }
            }}
            onBlur={() => setTimeout(() => setClosed(true), 150)}
            onFocus={() => setClosed(false)}
          />
          {suggestions.length > 0 && (
            <ul className="md-mentions" id={listId} role="listbox" aria-label="People to mention">
              {suggestions.map((u, i) => (
                <li key={u.username} id={`${listId}-${i}`} role="option" aria-selected={i === at}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className={i === at ? "on" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(u);
                    }}
                  >
                    {u.name && <b>{u.name}</b>} <span>@{u.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <small className="field-hint">Markdown: **bold**, *italic*, `code`, - lists, [links](https://…) and @username to mention someone.</small>
    </div>
  );
}
