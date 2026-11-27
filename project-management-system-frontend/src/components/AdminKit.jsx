/** @import { ReactNode } from 'react' */
// Small pieces the administration screens share: toasts (short messages that confirm or explain what happened,
// read out by screen readers) and a confirmation dialog for anything that can't be undone easily.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

/** @typedef {{ id: number; text: string; ok: boolean }} Toast */
const ToastContext = createContext(/** @type {(text: string, ok?: boolean) => void} */ (() => undefined));

/** Wraps the admin screens; `useToast()` inside shows a message for a few seconds. @param {{ children: ReactNode }} p */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState(/** @type {Toast[]} */ ([]));
  const next = useRef(1);
  const show = useCallback(
    /** @param {string} text @param {boolean} [ok=true] */ (text, ok = true) => {
      const id = next.current++;
      setToasts((t) => [...t.slice(-2), { id, text, ok }]);
      // Problems stay longer, so there's time to read them.
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ok ? 4000 : 8000);
    },
    [],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? "ok" : "bad"}`}>
            {t.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
            <span>{t.text}</span>
            <button className="toast-x" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/**
 * A modal question. Esc or Cancel says no; focus goes to Cancel first so Enter doesn't confirm by accident, and
 * returns to where it was afterwards. With `typed`, the confirm button waits until that text is typed.
 * @param {{ open: boolean; title: string; children?: ReactNode; confirm: string; danger?: boolean; typed?: string; onConfirm: () => void; onCancel: () => void }} p
 */
export function ConfirmDialog({ open, title, children, confirm, danger = false, typed, onConfirm, onCancel }) {
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));
  const cancelRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const [text, setText] = useState("");
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setText("");
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      {children && <div className="confirm-dialog-body">{children}</div>}
      {typed && (
        <label className="field">
          Type <b>{typed}</b> to confirm
          <input value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
      <div className="org-row">
        <button ref={cancelRef} className="btn btn-ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className={`btn sm ${danger ? "btn-danger" : "btn-navy"}`} disabled={!!typed && text.trim() !== typed} onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}

/**
 * A ConfirmDialog driven by a promise: `const [dialog, ask] = useConfirm()`, render `dialog`, then
 * `if (await ask({ title, confirm, ... })) …`.
 * @returns {[ReactNode, (o: { title: string; body?: ReactNode; confirm: string; danger?: boolean; typed?: string }) => Promise<boolean>]}
 */
export function useConfirm() {
  const [q, setQ] = useState(/** @type {{ title: string; body?: ReactNode; confirm: string; danger?: boolean; typed?: string; resolve: (v: boolean) => void } | null} */ (null));
  const ask = useCallback(
    /** @param {{ title: string; body?: ReactNode; confirm: string; danger?: boolean; typed?: string }} o */ (o) => new Promise((resolve) => setQ({ ...o, resolve })),
    [],
  );
  const done = /** @param {boolean} v */ (v) => {
    q?.resolve(v);
    setQ(null);
  };
  return [
    <ConfirmDialog key="confirm" open={!!q} title={q?.title ?? ""} confirm={q?.confirm ?? "OK"} danger={q?.danger} typed={q?.typed} onConfirm={() => done(true)} onCancel={() => done(false)}>
      {q?.body}
    </ConfirmDialog>,
    ask,
  ];
}

/** A short line of help under a heading or field. @param {{ children: ReactNode }} p */
export const Help = ({ children }) => <p className="admin-help">{children}</p>;

/** What to show when a list is empty, with what to do about it. @param {{ title: string; children?: ReactNode }} p */
export const Empty = ({ title, children }) => (
  <div className="admin-empty">
    <b>{title}</b>
    {children && <span>{children}</span>}
  </div>
);
