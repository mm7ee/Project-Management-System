/** @import { System } from '../data/systems' */
// The project page's keyboard: the shortcuts (src/data/shortcuts.js), the list of them (?), and search within the
// project (/ or Ctrl/Cmd+K): its sections, its actions and its work items, chosen with the arrow keys and Enter.
// Also the small "Done. Undo" notice inline edits use.
import { useCallback, useEffect, useRef, useState } from "react";
import { Command, CornerDownLeft, Search, X } from "lucide-react";
import { api } from "../data/api";
import { SEQUENCE_MS, SHORTCUTS, isTyping, nextShortcut } from "../data/shortcuts";

const SECTION_PATH = { overview: "", items: "/items", lifecycle: "/lifecycle", timeline: "/timeline", risks: "/risks", docs: "/docs", team: "/team", activity: "/activity", chat: "/chat", testing: "/testing", board: "/board" };
const SECTION_LABEL = { overview: "Overview", items: "Work list", board: "Board", lifecycle: "Lifecycle", timeline: "Timeline", risks: "Risks & Security", testing: "Testing", docs: "Documents", team: "Team", activity: "Activity", chat: "Chat" };

/**
 * The shortcuts, while a project is open.
 * @param {{ system: System; readOnly: boolean; canCreate: boolean }} p
 */
export default function ProjectKeys({ system, readOnly, canCreate }) {
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState(false);
  const pending = useRef(/** @type {{ key: string; at: number } | null} */ (null));
  const base = `#/projects/${system.id}`;
  const add = useCallback(() => {
    try {
      sessionStorage.setItem("pms:quick-create", system.id);
    } catch {
      // The list still opens.
    }
    window.location.hash = `${base}/items`;
  }, [base, system.id]);
  useEffect(() => {
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector(".modal-backdrop, .ck-drawer-back")) return;
      const was = pending.current && Date.now() - pending.current.at < SEQUENCE_MS ? pending.current.key : null;
      const { pending: next, action } = nextShortcut(was, e.key);
      pending.current = next ? { key: next, at: Date.now() } : null;
      if (!action) return;
      e.preventDefault();
      if ("go" in action) window.location.hash = `${base}${SECTION_PATH[/** @type {keyof typeof SECTION_PATH} */ (action.go)] ?? ""}`;
      else if (action.do === "help") setHelp(true);
      else if (action.do === "search") setSearch(true);
      else if (action.do === "add" && canCreate && !readOnly) add();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [base, canCreate, readOnly, add]);
  return (
    <>
      <button className="ck-keys-hint no-print" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
        <Command size={13} aria-hidden="true" /> Shortcuts <kbd>?</kbd>
      </button>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {search && <ProjectSearch system={system} canCreate={canCreate && !readOnly} onAdd={add} onClose={() => setSearch(false)} />}
    </>
  );
}

/** @param {{ onClose: () => void }} p */
function ShortcutHelp({ onClose }) {
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    box.current?.focus();
    const esc = (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="backdrop modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ck-help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} ref={box}>
        <button className="close-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Keyboard shortcuts</h2>
        <p className="ck-insight">On a project's page, when you're not typing in a box.</p>
        <dl className="ck-keys">
          {SHORTCUTS.map((s) => (
            <div key={s.keys.join(" ")}>
              <dt>
                {s.keys.map((k, i) => (
                  <span key={i}>
                    {i > 0 && <span className="ck-then"> then </span>}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
          <div>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Close a panel or this list</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/**
 * Search within the project: sections, actions and work items.
 * @param {{ system: System; canCreate: boolean; onAdd: () => void; onClose: () => void }} p
 */
function ProjectSearch({ system, canCreate, onAdd, onClose }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState(/** @type {{ key: string; summary: string; statusName?: string }[]} */ ([]));
  const [at, setAt] = useState(0);
  const base = `#/projects/${system.id}`;
  useEffect(() => {
    const t = setTimeout(() => {
      const text = q.trim();
      if (text.length < 2) {
        setItems([]);
        return;
      }
      api(`/items?system=${encodeURIComponent(system.id)}&q=${encodeURIComponent(text)}&state=all&sort=updated&dir=desc&limit=8`)
        .then((r) => setItems(/** @type {any} */ (r).items))
        .catch(() => setItems([]));
    }, 220);
    return () => clearTimeout(t);
  }, [q, system.id]);
  const needle = q.trim().toLowerCase();
  /** @type {{ id: string; label: string; hint: string; run: () => void }[]} */ const options = [
    ...Object.entries(SECTION_LABEL)
      .filter(([, label]) => !needle || label.toLowerCase().includes(needle))
      .map(([k, label]) => ({ id: `go:${k}`, label: `Go to ${label}`, hint: "Section", run: () => (window.location.hash = `${base}${SECTION_PATH[/** @type {keyof typeof SECTION_PATH} */ (k)] ?? ""}`) })),
    ...(canCreate && (!needle || "add a work item".includes(needle)) ? [{ id: "add", label: "Add a work item", hint: "Action", run: onAdd }] : []),
    ...items.map((i) => ({ id: `item:${i.key}`, label: `${i.key} ${i.summary}`, hint: i.statusName ?? "Work item", run: () => (window.location.hash = `${base}/items/${i.key}`) })),
  ];
  const pick = Math.min(at, Math.max(0, options.length - 1));
  const choose = (/** @type {number} */ i) => {
    const o = options[i];
    if (!o) return;
    onClose();
    o.run();
  };
  return (
    <div className="backdrop modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ck-palette" role="dialog" aria-modal="true" aria-label={`Search ${system.name}`}>
        <label className="ck-palette-input">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search this project</span>
          <input
            autoFocus
            value={q}
            placeholder={`Search ${system.name}: work items, sections, actions…`}
            role="combobox"
            aria-expanded="true"
            aria-controls="ck-palette-list"
            aria-activedescendant={options[pick] ? `ck-opt-${pick}` : undefined}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((v) => Math.min(options.length - 1, v + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((v) => Math.max(0, v - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(pick);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <ul id="ck-palette-list" role="listbox" className="ck-palette-list">
          {options.map((o, i) => (
            <li key={o.id} id={`ck-opt-${i}`} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseEnter={() => setAt(i)} onMouseDown={(e) => (e.preventDefault(), choose(i))}>
              <span>{o.label}</span>
              <small>{o.hint}</small>
              {i === pick && <CornerDownLeft size={13} aria-hidden="true" />}
            </li>
          ))}
          {!options.length && <li className="ck-palette-none">{needle.length < 2 ? "Type to search" : "Nothing matches."}</li>}
        </ul>
      </div>
    </div>
  );
}

/**
 * A small "Saved. Undo" notice, gone after a few seconds.
 * @returns {[import("react").ReactNode, (text: string, undo?: () => Promise<void>) => void]}
 */
export function useUndo() {
  const [note, setNote] = useState(/** @type {{ text: string; undo?: () => Promise<void>; n: number } | null} */ (null));
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);
  const show = useCallback((/** @type {string} */ text, /** @type {(() => Promise<void>) | undefined} */ undo) => setNote((n) => ({ text, undo, n: (n?.n ?? 0) + 1 })), []);
  const el = note ? (
    <div className="ck-undo" role="status" key={note.n}>
      <span>{note.text}</span>
      {note.undo && (
        <button
          className="link-btn"
          onClick={async () => {
            const u = note.undo;
            setNote(null);
            try {
              await u?.();
              show("Undone.");
            } catch (e) {
              show(e instanceof Error ? `Couldn't undo: ${e.message}` : "Couldn't undo that");
            }
          }}
        >
          Undo
        </button>
      )}
      <button className="icon-link" onClick={() => setNote(null)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  ) : null;
  return [el, show];
}
