/** @import { Tenant } from '../data/api' */
/** @import { WorkspaceIcon } from '../data/orgAdmin' */
// The top of the sidebar, under the organisation's logo: "You're in" the open workspace, unmistakably. Its icon on a
// tile of its own colour with a slow "you are here" beacon, its name large, its key and your role in it, and one dot
// per workspace you have (the lit one is this one). With more than one, it opens a list to switch, right there.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Eye, Layers } from "lucide-react";
import { contrast, cleanHex } from "../data/branding";
import { ROLE_LABEL } from "../data/roles";
import { WORKSPACE_ICON } from "./OrgAdmin";
import { switchWorkspace } from "./WorkspaceSwitcher";

/** @param {string | undefined} icon */
const iconOf = (icon) => WORKSPACE_ICON[/** @type {WorkspaceIcon} */ (icon)] ?? Layers;
/** White or dark ink on a workspace's colour, whichever reads. @param {string} c */
const inkOn = (c) => (contrast("#ffffff", c) >= 3 ? "#ffffff" : "#0b0c22");
/** @param {string} role */
const roleLabel = (role) => /** @type {Record<string, string>} */ (ROLE_LABEL)[role] ?? role;

/**
 * @param {{ tenant?: Tenant; viewOnly?: boolean }} p
 */
export default function WorkspaceCard({ tenant, viewOnly = false }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState("");
  const box = useRef(/** @type {HTMLDivElement | null} */ (null));
  useEffect(() => {
    if (!open) return;
    const away = (/** @type {MouseEvent} */ e) => box.current && !box.current.contains(/** @type {Node} */ (e.target)) && setOpen(false);
    const esc = (/** @type {KeyboardEvent} */ e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const ws = tenant?.workspace;
  if (!tenant || !ws) return null;
  const all = tenant.workspaces;
  const mine = all.find((w) => w.id === ws.id);
  const role = viewOnly ? "View-only link" : mine ? roleLabel(mine.role) : "Viewer";
  const colour = cleanHex(ws.colour);
  const Icon = iconOf(ws.icon);
  const canSwitch = !viewOnly && all.length > 1;
  const at = Math.max(0, all.findIndex((w) => w.id === ws.id));
  const style = /** @type {import("react").CSSProperties} */ (colour ? { "--ws": colour, "--ws-ink": inkOn(colour) } : {});

  const face = (
    <>
      <span className="wsc-tile" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="wsc-text">
        <span className="wsc-eyebrow">
          <span className="wsc-live" aria-hidden="true" />
          You're in
        </span>
        <span className="wsc-name">{ws.name}</span>
        <span className="wsc-meta">
          {/* The key only when it says something the name doesn't ("PRJ" for Projects, not "PROJECTS"). */}
          {ws.key.toLowerCase() !== ws.name.toLowerCase().replace(/\s+/g, "") && <span className="wsc-key">{ws.key}</span>}
          {role}
        </span>
      </span>
      {canSwitch && <ChevronsUpDown size={16} className="wsc-chev" aria-hidden="true" />}
    </>
  );

  return (
    <div className={`wsc ${open ? "open" : ""}`} style={style} ref={box}>
      {canSwitch ? (
        <button type="button" className="wsc-card" aria-haspopup="listbox" aria-expanded={open} aria-label={`Workspace: ${ws.name}, ${role}. Switch workspace`} onClick={() => setOpen((o) => !o)}>
          {face}
        </button>
      ) : (
        <div className="wsc-card" role="status" aria-label={`Workspace: ${ws.name}, ${role}`}>
          {face}
        </div>
      )}
      {all.length > 1 && (
        <span className="wsc-dots" aria-label={`Workspace ${at + 1} of ${all.length}`}>
          {all.map((w) => (
            <i key={w.id} className={w.id === ws.id ? "on" : ""} style={w.colour && w.id === ws.id ? undefined : w.colour ? { background: w.colour } : undefined} />
          ))}
          <small>
            {at + 1} of {all.length}
          </small>
        </span>
      )}
      {open && (
        <ul className="wsc-menu" role="listbox" aria-label="Switch workspace">
          {all.map((w) => {
            const WIcon = iconOf(w.icon);
            const c = cleanHex(w.colour);
            const here = w.id === ws.id;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={here}
                  disabled={!!busy}
                  className={here ? "here" : ""}
                  onClick={async () => {
                    if (here) return setOpen(false);
                    setBusy(w.id);
                    setError("");
                    try {
                      await switchWorkspace(tenant, w.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Couldn't switch workspace");
                      setBusy(null);
                    }
                  }}
                >
                  <span className="wsc-mini" style={c ? { background: c, color: inkOn(c) } : undefined} aria-hidden="true">
                    <WIcon size={13} />
                  </span>
                  <span className="wsc-opt">
                    <b>{w.name}</b>
                    <small>{w.open ? "Open to everyone · view only" : roleLabel(w.role)}</small>
                  </span>
                  {here ? <Check size={15} aria-label="You're here" /> : w.open ? <Eye size={14} aria-hidden="true" /> : null}
                  {busy === w.id && <span className="wsc-spin" aria-label="Switching…" />}
                </button>
              </li>
            );
          })}
          {error && (
            <li role="alert" className="wsc-error">
              {error}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
